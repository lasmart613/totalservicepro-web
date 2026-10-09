import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { isOwnerOrgType } from '@/lib/org-types';
import { verifyCustomerInvite } from '@/lib/customer-invite';

/**
 * POST /api/customers/claim
 * Body: { token }
 *
 * Links the signed-in user to the invited customer org (owner role).
 * Does not create a second organization. Refuses if another owner already
 * claims the org, or if this user already belongs to a different org.
 * A member who is already in the clinic is not promoted to owner.
 */
const CLINIC_OWNER_SLOT_ROLES = new Set(['owner', 'customer', 'admin', 'company_admin']);

function holdsClinicOwnerSlot(role: unknown): boolean {
  return CLINIC_OWNER_SLOT_ROLES.has(String(role || '').trim().toLowerCase());
}

function isOwnerRole(role: unknown): boolean {
  return String(role || '').trim().toLowerCase() === 'owner';
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
      await writer
        .from('user_profiles')
        .update({ role: 'owner', onboarding_completed: true })
        .eq('id', user.id);
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

    const { data: otherOwners } = await writer
      .from('user_profiles')
      .select('id, email, role')
      .eq('organization_id', org.id)
      .limit(20);

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

    // Already on this clinic, but not its owner. Do not promote, even when the
    // owner slot is empty — claim is how an unlinked user becomes the first owner.
    if (alreadyInThisOrg) {
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
    if (upErr) {
      const slim = {
        organization_id: org.id,
        role: 'owner',
        onboarding_completed: true,
        email: userEmail,
      };
      const retry = await writer.from('user_profiles').update(slim).eq('id', user.id);
      upErr = retry.error;
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

    return NextResponse.json({ ok: true, claimed: true, organizationId: org.id });
  } catch (e: any) {
    console.error('customer claim', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
