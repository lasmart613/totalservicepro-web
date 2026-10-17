import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { setActiveOrganization, upsertMembership } from '@/lib/org-membership-server';
import { loadFounderClaimState } from '@/lib/founder-claim';
import { refuseClaimOrgAutoCreate } from '@/lib/claim-signup-metadata';
import {
  organizationInsertFromPending,
  type PendingSignup,
} from '@/lib/pending-signup';
import { decideFounderLink, founderClaimAllowed } from '@/lib/tenant-lockdown';
import {
  grantSignupTrialIfEligible,
  isTrialGrantedAtMissing,
  loadFounderOrg,
  markTrialOnInsert,
  type FounderOrgRow,
} from '@/lib/signup-trial';

/**
 * POST /api/org/founder
 * Create the caller's organization and/or link their profile to an org
 * they created. Role is derived from organizations.type. Service role write.
 * Body.role is ignored.
 */

const EXTRA_PROFILE_ROLES = new Set([
  'fse',
  'engineer',
  'technician',
  'dispatcher',
  'scheduler',
  'billing_manager',
  'service_manager',
]);

type ProfileBody = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  bio?: string | null;
  onboardingCompleted?: boolean;
  additionalRoles?: string[] | null;
};

function safeAdditionalRoles(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const roles = raw
    .map((item) => String(item || '').toLowerCase().trim())
    .filter((item) => EXTRA_PROFILE_ROLES.has(item));
  return roles.length ? roles : null;
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'Server cannot link organizations (missing service role).' },
        { status: 503 }
      );
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      organizationId?: number | string | null;
      pending?: PendingSignup | null;
      profile?: ProfileBody | null;
    };

    const admin = getSupabaseAdmin();
    let orgId = body.organizationId ?? null;
    let orgType = '';
    let createdBy: string | null = null;
    let existingForGrant: FounderOrgRow | null = null;
    let trialColumnRead = false;

    if (orgId == null || orgId === '') {
      const pending = body.pending;
      if (
        refuseClaimOrgAutoCreate(
          pending,
          (user.user_metadata || null) as Record<string, unknown> | null
        )
      ) {
        return NextResponse.json(
          { error: 'This clinic invite was not claimed. A new organization was not created.' },
          { status: 409 }
        );
      }
      if (!pending?.name || !pending.orgType) {
        return NextResponse.json(
          { error: 'Organization name and type are required.' },
          { status: 400 }
        );
      }
      // Created in this request: the one place a trial is granted outright.
      // trial_granted_at rides on the same insert as the grant.
      const row = markTrialOnInsert(organizationInsertFromPending(pending, user.id));
      row.created_by = user.id;
      delete row.num_lasers;
      let { data, error } = await admin
        .from('organizations')
        .insert(row)
        .select('id, type, created_by')
        .maybeSingle();
      if (error && isTrialGrantedAtMissing(error.message) && 'trial_granted_at' in row) {
        // 000915 not applied yet. A new org gets its trial once by construction.
        delete row.trial_granted_at;
        ({ data, error } = await admin
          .from('organizations')
          .insert(row)
          .select('id, type, created_by')
          .maybeSingle());
      }
      if (error || data?.id == null) {
        return NextResponse.json(
          { error: error?.message || 'Could not create your organization.' },
          { status: 400 }
        );
      }
      orgId = data.id;
      orgType = String(data.type || pending.orgType);
      createdBy = String(data.created_by || user.id);
    } else {
      const loaded = await loadFounderOrg(admin, orgId);
      const org = loaded.org;
      if (loaded.error || !org) {
        return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });
      }
      orgType = String(org.type || '');
      createdBy = org.created_by ? String(org.created_by) : null;
      existingForGrant = org;
      trialColumnRead = loaded.trialColumnRead;
    }

    const decision = decideFounderLink({
      callerId: user.id,
      orgCreatedBy: createdBy,
      orgType,
    });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    // Existing org: created_by alone doesn't make the caller its founder (a
    // removed tech is still created_by on the clinics they added). Same rule as
    // org_unclaimed_new in 000916, plus 000917: a customer org created by a
    // shop user (the caller is its created_by) is never claimable.
    if (existingForGrant) {
      const claim = await loadFounderClaimState(admin, orgId, user.id);
      const allowed = founderClaimAllowed({
        ...claim,
        orgType,
        orgCreatedAt: (existingForGrant as { created_at?: string | null }).created_at ?? null,
      });
      if (!allowed.ok) {
        return NextResponse.json({ error: allowed.error }, { status: allowed.status });
      }
    }

    // Existing org: one trial ever (trial_granted_at), and only while the org
    // is new (24h). Expiry/removal clear the premium fields but never
    // trial_granted_at, so a visit can't re-grant. Unreadable column: no grant.
    if (existingForGrant) {
      await grantSignupTrialIfEligible(admin, {
        org: existingForGrant,
        callerId: user.id,
        trialColumnRead,
      });
    }

    const profile = body.profile || {};
    // Org pointer and home membership are one transaction in set_home_membership.
    // Writing organization_id here would let the profile trigger mark a second home
    // before that call, and a failed call could not undo it.
    const profileUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (profile.firstName) profileUpdate.first_name = profile.firstName;
    if (profile.lastName) profileUpdate.last_name = profile.lastName;
    if (profile.phone !== undefined) profileUpdate.phone = profile.phone || null;
    if (profile.jobTitle) profileUpdate.job_title = profile.jobTitle;
    if (profile.bio !== undefined) profileUpdate.bio = profile.bio || null;
    if (profile.onboardingCompleted != null) {
      profileUpdate.onboarding_completed = profile.onboardingCompleted;
      if (profile.onboardingCompleted) {
        profileUpdate.onboarding_completed_at = new Date().toISOString();
      }
    }
    const extraRoles = safeAdditionalRoles(profile.additionalRoles);
    if (extraRoles) profileUpdate.additional_roles = extraRoles;
    if (user.email) profileUpdate.email = user.email.toLowerCase();

    let { data: profileRows, error: profileError } = await admin
      .from('user_profiles')
      .update(profileUpdate)
      .eq('id', user.id)
      .select('id');
    if (profileError && /additional_roles|onboarding_completed_at|column/i.test(profileError.message || '')) {
      delete profileUpdate.additional_roles;
      delete profileUpdate.onboarding_completed_at;
      ({ data: profileRows, error: profileError } = await admin
        .from('user_profiles')
        .update(profileUpdate)
        .eq('id', user.id)
        .select('id'));
    }
    if (profileError || !profileRows?.length) {
      const insertRow = { id: user.id, ...profileUpdate };
      const inserted = await admin
        .from('user_profiles')
        .upsert(insertRow, { onConflict: 'id' })
        .select('id');
      profileError = inserted.error;
    }
    if (profileError) {
      return NextResponse.json(
        { error: profileError.message || 'Could not link your profile.' },
        { status: 500 }
      );
    }

    if (orgId == null || orgId === '') {
      return NextResponse.json({ error: 'Organization not found.' }, { status: 500 });
    }
    const organizationId = orgId;

    const membership = await upsertMembership(admin, {
      userId: user.id,
      organizationId,
      role: decision.role,
      isHome: true,
      syncProfile: true,
    });
    if (!membership.ok) {
      return NextResponse.json(
        { error: membership.error || 'Could not save organization membership.' },
        { status: 500 }
      );
    }

    const active = await setActiveOrganization(admin, {
      userId: user.id,
      organizationId,
      role: decision.role,
    });
    if (!active.ok) {
      return NextResponse.json(
        { error: active.error || 'Could not activate the organization.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      organizationId,
      role: decision.role,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Organization setup failed';
    console.error('org founder', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
