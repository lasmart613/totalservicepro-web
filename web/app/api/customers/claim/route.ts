import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { emailsMatch } from '@/lib/email-match';
import { isOwnerOrgType } from '@/lib/org-types';
import { openCustomerInvite } from '@/lib/customer-invite';
import { CLAIM_REFUSED_MESSAGE, type ClaimErrorCode } from '@/lib/claim-error';
import { fetchDirectoryContactSources, pickCrmReachEmail } from '@/lib/customer-contacts';
import { asClaimSignupMeta, claimSignupMetadataClearPatch } from '@/lib/claim-signup-metadata';

/**
 * POST /api/customers/claim
 * Body: { token }
 *
 * Links the signed-in user to the invited customer org as its owner. Does not
 * create a second organization.
 *
 * 000923: the claim is the database's decision. The token carries the id of a
 * public.clinic_owner_invites row that a shop admin issued
 * (issue_clinic_owner_invite); claim_clinic_owner_invite then, in one locked
 * transaction, refuses unless the invite is open, its email is the clinic's
 * email of record and the user's confirmed login email, the clinic has no owner
 * (organization_memberships OR user_profiles, owner or legacy customer), the
 * user is not linked to another org, and the user is not the clinic's creator,
 * the inviter, or a current or recent (30 days) member of the shop that added
 * or serves the clinic. It then writes the profile and the owner home
 * membership. This route keeps its own checks (session, token email, the
 * clinic's current reach email) in front of that, and never writes
 * user_profiles or organization_memberships itself.
 *
 * The owner slot is role owner, plus customer (legacy clinic holder). admin
 * and company_admin are staff roles and can repeat inside one org.
 */
export const CLINIC_OWNER_SLOT_ROLES = ['owner', 'customer'] as const;

function isUniqueOwnerViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (String(error.code || '') === '23505') return true;
  return /duplicate key|unique constraint|already has an owner/i.test(String(error.message || ''));
}

const CLAIM_TOKEN_INVALID_MESSAGE = 'This clinic invite is not valid. Ask the shop that invited you to send a new one.';

/** claim_clinic_owner_invite refusal codes -> HTTP status, claim code and message. */
const CLAIM_RPC_REFUSALS: Record<string, { status: number; code: ClaimErrorCode; error: string }> = {
  invite_invalid: { status: 400, code: 'token_invalid', error: CLAIM_TOKEN_INVALID_MESSAGE },
  invite_revoked: { status: 400, code: 'token_invalid', error: CLAIM_TOKEN_INVALID_MESSAGE },
  invite_used: { status: 400, code: 'token_invalid', error: CLAIM_TOKEN_INVALID_MESSAGE },
  invite_expired: {
    status: 400,
    code: 'token_expired',
    error: 'This clinic invite has expired. Ask the shop that invited you to send a new one.',
  },
  invite_not_email_of_record: {
    status: 403,
    code: 'email_mismatch',
    error: 'This invite was issued for an email that is no longer on this clinic.',
  },
  email_mismatch: { status: 403, code: 'email_mismatch', error: 'Sign in with the email this invite was sent to.' },
  email_unconfirmed: {
    status: 403,
    code: 'claim_refused',
    error: 'Confirm your email address first, then open the invite link again.',
  },
  owner_exists: { status: 409, code: 'owner_exists', error: 'This company profile already has an owner account.' },
  other_org: { status: 409, code: 'claim_refused', error: 'This account is already linked to another organization.' },
  shop_staff: {
    status: 403,
    code: 'claim_refused',
    error: 'A member of the service company that added this clinic cannot claim it.',
  },
  not_clinic: { status: 400, code: 'claim_refused', error: 'This invite is not for a clinic profile.' },
};

type ClaimUserClient = {
  auth: {
    getUser: (accessToken: string) => Promise<{
      data: { user: { id: string; email?: string | null; user_metadata?: unknown } | null };
      error: { message?: string } | null;
    }>;
  };
};

export async function POST(req: NextRequest) {
  return runCustomerClaim(req);
}

export async function runCustomerClaim(
  req: NextRequest,
  deps: {
    createUserClient?: (url: string, anonKey: string, accessToken: string) => ClaimUserClient;
    hasServiceRole?: () => boolean;
    getWriter?: () => ReturnType<typeof getSupabaseAdmin>;
    clearClaimSignupMetadata?: (userId: string, patch: Record<string, null>) => Promise<void>;
  } = {}
) {
  const serviceRoleReady = deps.hasServiceRole ?? hasServiceRole;
  const writerFor = deps.getWriter ?? getSupabaseAdmin;
  const clearClaimSignupMetadata =
    deps.clearClaimSignupMetadata ??
    (async (userId: string, patch: Record<string, null>) => {
      if (!serviceRoleReady()) return;
      try {
        const admin = getSupabaseAdmin();
        const { error } = await admin.auth.admin.updateUserById(userId, {
          user_metadata: patch,
        });
        if (error) console.error('clear claim signup metadata', error);
      } catch (err) {
        console.error('clear claim signup metadata', err);
      }
    });
  const createUserClient: (url: string, anonKey: string, accessToken: string) => ClaimUserClient =
    deps.createUserClient ??
    ((url, anonKey, accessToken) =>
      createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }) as ClaimUserClient);
  try {
    const auth = req.headers.get('authorization') || '';
    const accessToken = auth.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) {
      return NextResponse.json({ error: 'Sign in required', code: 'claim_refused' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured', code: 'server_error' }, { status: 500 });
    }

    const supabase = createUserClient(url, anon, accessToken);

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(accessToken);
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session', code: 'claim_refused' }, { status: 401 });
    }

    const claimMeta = asClaimSignupMeta(user.user_metadata);
    const reply = async (body: Record<string, unknown>, status: number) => {
      if (status >= 400 && status < 500) {
        const patch = claimSignupMetadataClearPatch(claimMeta);
        if (patch) {
          try {
            await clearClaimSignupMetadata(user.id, patch);
          } catch (err) {
            console.error('clear claim signup metadata', err);
          }
        }
      }
      return NextResponse.json(body, { status });
    };
    const replyFrom = async (response: NextResponse) => {
      if (response.status >= 400 && response.status < 500) {
        const patch = claimSignupMetadataClearPatch(claimMeta);
        if (patch) {
          try {
            await clearClaimSignupMetadata(user.id, patch);
          } catch (err) {
            console.error('clear claim signup metadata', err);
          }
        }
      }
      return response;
    };

    const body = await req.json().catch(() => ({}));
    const opened = openCustomerInvite(String(body.token || ''));
    if (!opened.ok) {
      return reply(
        {
          ok: false,
          claimed: false,
          error:
            opened.reason === 'token_expired'
              ? 'This clinic invite has expired. Ask the shop that invited you to send a new one.'
              : 'Invite is invalid or expired.',
          code: opened.reason,
        },
        400
      );
    }
    const payload = opened.payload;
    if (!payload.inv) {
      // Signed before 000923: not bound to an issued invite row.
      return reply({ ok: false, claimed: false, error: CLAIM_TOKEN_INVALID_MESSAGE, code: 'token_invalid' }, 400);
    }

    if (!emailsMatch(user.email, payload.email)) {
      return reply(
        {
          ok: false,
          claimed: false,
          error: 'Sign in with the email this invite was sent to.',
          code: 'email_mismatch',
        },
        403
      );
    }

    if (!serviceRoleReady()) {
      return NextResponse.json(
        {
          ok: false,
          claimed: false,
          error: 'Server cannot link this clinic profile (missing service role).',
          code: 'server_error',
        },
        { status: 503 }
      );
    }

    const writer = writerFor();

    const { data: org } = await writer
      .from('organizations')
      .select('id, name, email, type')
      .eq('id', payload.orgId)
      .maybeSingle();

    if (!org) {
      return reply(
        { ok: false, claimed: false, error: 'Company profile was not found.', code: 'claim_refused' },
        404
      );
    }

    const orgType = String(org.type || '').toLowerCase();
    if (orgType && !isOwnerOrgType(orgType) && orgType !== 'customer') {
      return reply(
        { ok: false, claimed: false, error: 'This invite is not for a clinic profile.', code: 'claim_refused' },
        400
      );
    }

    const sources = await fetchDirectoryContactSources(writer, org.id);
    const currentEmail = pickCrmReachEmail({
      directoryContacts: sources.directoryContacts,
      contactRows: sources.contactRows,
      officeEmail: sources.officeEmail ?? (org as { email?: string | null }).email,
    }).email.trim().toLowerCase();
    if (!emailsMatch(currentEmail, payload.email)) {
      return reply(
        {
          ok: false,
          claimed: false,
          error: 'This invite was issued for an email that is no longer on this clinic.',
          code: 'email_mismatch',
        },
        403
      );
    }

    const first = (user.user_metadata as { first_name?: string } | undefined)?.first_name || null;
    const last = (user.user_metadata as { last_name?: string } | undefined)?.last_name || null;

    const { data: claimed, error: claimErr } = await writer.rpc('claim_clinic_owner_invite', {
      p_invite_id: payload.inv,
      p_user_id: user.id,
      p_first_name: first,
      p_last_name: last,
    });
    if (claimErr) {
      if (isUniqueOwnerViolation(claimErr)) {
        return reply(
          { ok: false, claimed: false, error: 'This company profile already has an owner account.', code: 'owner_exists' },
          409
        );
      }
      console.error('customer claim rpc', claimErr.message || claimErr);
      return NextResponse.json(
        {
          ok: false,
          claimed: false,
          error: 'Could not link this clinic profile. Nothing was changed.',
          code: 'server_error' satisfies ClaimErrorCode,
        },
        { status: 503 }
      );
    }

    const result = (claimed || {}) as { ok?: boolean; code?: string; organization_id?: number | string; already_linked?: boolean };
    if (result.ok !== true) {
      const refusal = CLAIM_RPC_REFUSALS[String(result.code || '')] ?? {
        status: 403,
        code: 'claim_refused' as ClaimErrorCode,
        error: CLAIM_REFUSED_MESSAGE,
      };
      return reply({ ok: false, claimed: false, error: refusal.error, code: refusal.code }, refusal.status);
    }
    if (String(result.organization_id) !== String(org.id)) {
      return NextResponse.json(
        { ok: false, claimed: false, error: 'Profile did not link to the company.', code: 'server_error' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      claimed: true,
      organizationId: org.id,
      ...(result.already_linked ? { alreadyLinked: true } : {}),
    });
  } catch (e: any) {
    console.error('customer claim', e);
    return NextResponse.json({ error: e?.message || 'Server error', code: 'server_error' }, { status: 500 });
  }
}
