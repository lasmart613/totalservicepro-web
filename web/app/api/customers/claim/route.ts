import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { isOwnerOrgType } from '@/lib/org-types';
import { verifyCustomerInvite } from '@/lib/customer-invite';
import { fetchDirectoryContactSources, pickCrmReachEmail } from '@/lib/customer-contacts';

/**
 * POST /api/customers/claim
 * Body: { token }
 *
 * Links the signed-in user to the invited customer org (owner role).
 * Does not create a second organization. Refuses if another owner already
 * claims the org, or if this user already belongs to a different org.
 * A member already in this clinic becomes owner only when the owner slot is
 * empty and their signed-in email matches the invite. An existing owner blocks that.
 *
 * The owner slot is role owner, plus customer. customer is the legacy clinic
 * holder (isOwnerish, and onboarding promotes it to owner). Claim writes owner.
 * admin and company_admin are staff roles and can repeat inside one org, so
 * they do not occupy this slot. A partial unique index on role = owner is the
 * race backstop; a unique violation is 409.
 */
export const CLINIC_OWNER_SLOT_ROLES = ['owner', 'customer'] as const;

function holdsClinicOwnerSlot(role: unknown): boolean {
  return (CLINIC_OWNER_SLOT_ROLES as readonly string[]).includes(String(role || '').trim().toLowerCase());
}

function isUniqueOwnerViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (String(error.code || '') === '23505') return true;
  return /duplicate key|unique constraint/i.test(String(error.message || ''));
}

function isOwnerRole(role: unknown): boolean {
  return String(role || '').trim().toLowerCase() === 'owner';
}

async function setClinicHome(
  writer: SupabaseClient,
  userId: string,
  orgId: string | number
): Promise<NextResponse | null> {
  const organizationId = Number(orgId);
  if (!Number.isFinite(organizationId)) {
    return NextResponse.json(
      { ok: false, claimed: false, error: 'Could not set this clinic as your home organization.' },
      { status: 500 }
    );
  }
  const { error } = await writer.rpc('set_home_membership', {
    p_user_id: userId,
    p_organization_id: organizationId,
    p_role: 'owner',
    p_sync_profile: true,
  });
  if (error) {
    return NextResponse.json(
      { ok: false, claimed: false, error: 'Could not set this clinic as your home organization.' },
      { status: 503 }
    );
  }
  return null;
}

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
  } = {}
) {
  const serviceRoleReady = deps.hasServiceRole ?? hasServiceRole;
  const writerFor = deps.getWriter ?? getSupabaseAdmin;
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
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const supabase = createUserClient(url, anon, accessToken);

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(accessToken);
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const payload = verifyCustomerInvite(String(body.token || ''));
    if (!payload) {
      return NextResponse.json({ ok: false, claimed: false, error: 'Invite is invalid or expired.' }, { status: 400 });
    }

    const userEmail = String(user.email || '').trim().toLowerCase();
    if (!userEmail || userEmail !== payload.email) {
      return NextResponse.json(
        { ok: false, claimed: false, error: 'Sign in with the email this invite was sent to.' },
        { status: 403 }
      );
    }

    if (!serviceRoleReady()) {
      return NextResponse.json(
        { ok: false, claimed: false, error: 'Server cannot link this clinic profile (missing service role).' },
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
      return NextResponse.json({ ok: false, claimed: false, error: 'Company profile was not found.' }, { status: 404 });
    }

    const orgType = String(org.type || '').toLowerCase();
    if (orgType && !isOwnerOrgType(orgType) && orgType !== 'customer') {
      return NextResponse.json({ ok: false, claimed: false, error: 'This invite is not for a clinic profile.' }, { status: 400 });
    }

    const sources = await fetchDirectoryContactSources(writer, org.id);
    const currentEmail = pickCrmReachEmail({
      directoryContacts: sources.directoryContacts,
      contactRows: sources.contactRows,
      officeEmail: sources.officeEmail ?? (org as { email?: string | null }).email,
    }).email.trim().toLowerCase();
    if (!currentEmail || currentEmail !== payload.email) {
      return NextResponse.json(
        {
          ok: false,
          claimed: false,
          error: 'This invite was issued for an email that is no longer on this clinic.',
        },
        { status: 403 }
      );
    }

    const saveOwnerRole = async (userId: string) => {
      const updated = await writer
        .from('user_profiles')
        .update({ role: 'owner', onboarding_completed: true })
        .eq('id', userId)
        .select('id, role, organization_id')
        .maybeSingle();
      if (isUniqueOwnerViolation(updated.error)) {
        return NextResponse.json(
          {
            ok: false,
            claimed: false,
            error: 'This company profile already has an owner account.',
          },
          { status: 409 }
        );
      }
      if (updated.error) {
        return NextResponse.json(
          { ok: false, claimed: false, error: 'Could not update the clinic owner role.' },
          { status: 503 }
        );
      }
      const row = updated.data as { role?: string | null; organization_id?: string | number | null } | null;
      if (!row || !isOwnerRole(row.role) || String(row.organization_id) !== String(org.id)) {
        return NextResponse.json(
          { ok: false, claimed: false, error: 'Clinic owner role was not saved.' },
          { status: 500 }
        );
      }
      return null;
    };

    const { data: existingProf } = await writer
      .from('user_profiles')
      .select('id, organization_id, role, email')
      .eq('id', user.id)
      .maybeSingle();

    const alreadyInThisOrg =
      existingProf?.organization_id != null &&
      String(existingProf.organization_id) === String(org.id);

    // Re-claim by the person who is already owner stays a success and does not
    // look for a second owner. Writing role=owner here does not change the role.
    if (alreadyInThisOrg && isOwnerRole(existingProf?.role)) {
      const failed = await saveOwnerRole(user.id);
      if (failed) return failed;
      const homeError = await setClinicHome(writer, user.id, org.id);
      if (homeError) return homeError;
      return NextResponse.json({ ok: true, claimed: true, organizationId: org.id, alreadyLinked: true });
    }

    if (existingProf?.organization_id != null && !alreadyInThisOrg) {
      return NextResponse.json(
        {
          ok: false,
          claimed: false,
          error: 'This account is already linked to another organization.',
        },
        { status: 409 }
      );
    }

    const ownerLookup = await writer
      .from('user_profiles')
      .select('id, email, role')
      .eq('organization_id', org.id)
      .in('role', [...CLINIC_OWNER_SLOT_ROLES]);

    if (ownerLookup.error) {
      return NextResponse.json(
        {
          ok: false,
          claimed: false,
          error: 'Could not check who owns this clinic. Nothing was changed.',
        },
        { status: 503 }
      );
    }

    const otherOwners = ownerLookup.data;

    const takenByOther = (otherOwners || []).some((row: { id?: string; email?: string | null; role?: string | null }) => {
      if (!row?.id || String(row.id) === String(user.id)) return false;
      return holdsClinicOwnerSlot(row.role);
    });

    if (takenByOther) {
      return NextResponse.json(
        {
          ok: false,
          claimed: false,
          error: 'This company profile already has an owner account.',
        },
        { status: 409 }
      );
    }

    // Already linked, and nobody else holds the owner slot. Email was matched
    // above, same as a first claim. Promote this member; do not skip the check.
    if (alreadyInThisOrg) {
      const failed = await saveOwnerRole(user.id);
      if (failed) return failed;
      const homeError = await setClinicHome(writer, user.id, org.id);
      if (homeError) return homeError;
      return NextResponse.json({ ok: true, claimed: true, organizationId: org.id, alreadyLinked: true });
    }

    const first = (user.user_metadata as { first_name?: string } | undefined)?.first_name || null;
    const last = (user.user_metadata as { last_name?: string } | undefined)?.last_name || null;

    const upsert = {
      id: user.id,
      email: userEmail,
      first_name: first,
      last_name: last,
      role: 'owner',
      organization_id: org.id,
      onboarding_completed: true,
    };

    let { error: upErr } = await writer.from('user_profiles').upsert(upsert, { onConflict: 'id' });
    if (isUniqueOwnerViolation(upErr)) {
      return NextResponse.json(
        {
          ok: false,
          claimed: false,
          error: 'This company profile already has an owner account.',
        },
        { status: 409 }
      );
    }
    if (upErr) {
      const slim = {
        organization_id: org.id,
        role: 'owner',
        onboarding_completed: true,
        email: userEmail,
      };
      const retry = await writer.from('user_profiles').update(slim).eq('id', user.id);
      upErr = retry.error;
      if (isUniqueOwnerViolation(upErr)) {
        return NextResponse.json(
          {
            ok: false,
            claimed: false,
            error: 'This company profile already has an owner account.',
          },
          { status: 409 }
        );
      }
    }
    if (upErr) {
      return NextResponse.json({ ok: false, claimed: false, error: upErr.message || 'Could not link profile.' }, { status: 500 });
    }

    const { data: check } = await writer
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!check?.organization_id || String(check.organization_id) !== String(org.id)) {
      return NextResponse.json({ ok: false, claimed: false, error: 'Profile did not link to the company.' }, { status: 500 });
    }

    const homeError = await setClinicHome(writer, user.id, org.id);
    if (homeError) return homeError;

    return NextResponse.json({ ok: true, claimed: true, organizationId: org.id });
  } catch (e: any) {
    console.error('customer claim', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
