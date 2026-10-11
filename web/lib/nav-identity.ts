/**
 * One merged read of the signed-in user's nav identity: profile, the home
 * and active organizations, and the org role for the active org.
 *
 * Before this, the header (loadOwnNavProfile + getOrgRole), the upgrade hook
 * and the ad banner each read user_profiles and organizations on their own:
 * about 8 reads per mount, with the header mounting twice per page. This is
 * 3 reads (profile, organizations for both ids, membership), shared by every
 * consumer through NavIdentityProvider.
 *
 * Never embed organizations from user_profiles: a second org FK makes
 * PostgREST reject the whole row (see loadOwnNavProfile).
 */
import { ORG_ROLE_LOOKUP_ERROR, orgRoleFromRows, reportingOrganizationId, type OrgRoleResult } from './org-role.ts';

/** Widest first. A missing-column error steps down, like the old per-consumer reads. */
export const NAV_PROFILE_COLUMNS = [
  'id, first_name, last_name, role, organization_id, active_organization_id, onboarding_completed, onboarding_completed_at',
  'id, first_name, last_name, role, organization_id, active_organization_id, onboarding_completed',
  'id, first_name, last_name, role, organization_id, onboarding_completed',
  'id, first_name, last_name, role, organization_id',
] as const;

/** Covers nav (name/type/facility), getOrgRole (created_by), upgrade and ads (plan fields). */
export const NAV_ORG_COLUMNS = [
  'id, name, type, facility_type, created_by, is_premium, subscription_tier, plan, premium_until',
  'id, name, type, facility_type, created_by, is_premium, subscription_tier',
  'id, name, type, facility_type, created_by, is_premium',
  'id, name, type, facility_type, created_by',
] as const;

export type NavOrg = {
  id: number | string;
  name?: string | null;
  type?: string | null;
  facility_type?: string | null;
  created_by?: string | null;
  is_premium?: boolean | null;
  subscription_tier?: string | null;
  plan?: string | null;
  premium_until?: string | null;
};

export type NavIdentityProfile = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  organization_id?: number | string | null;
  active_organization_id?: number | string | null;
  onboarding_completed?: boolean | null;
  onboarding_completed_at?: string | null;
  /** Home org name/type/facility, same shape loadOwnNavProfile returned. */
  organizations: { name?: string | null; type?: string | null; facility_type?: string | null } | null;
};

export type NavIdentity = {
  profile: NavIdentityProfile | null;
  /** user_profiles.organization_id's row. Upgrade entry and ads read this one. */
  homeOrg: NavOrg | null;
  /** Org role for reportingOrganizationId(profile): active org first. */
  orgRole: OrgRoleResult;
};

type Result = { data: any; error: { message?: string } | null };

type NavClient = {
  from: (table: string) => any;
};

function columnError(error: Result['error']): boolean {
  return !!error && /column|schema cache/i.test(error.message || '');
}

async function withColumnFallback(
  columns: readonly string[],
  run: (cols: string) => PromiseLike<Result>
): Promise<Result> {
  let last: Result = { data: null, error: null };
  for (const cols of columns) {
    last = await run(cols);
    if (!columnError(last.error)) return last;
  }
  return last;
}

function hasId(value: unknown): boolean {
  return value != null && String(value).trim() !== '';
}

const FAILED: OrgRoleResult = { ok: false, status: 503, error: ORG_ROLE_LOOKUP_ERROR };

export async function loadNavIdentity(supabase: NavClient, userId: string): Promise<NavIdentity> {
  const uid = String(userId || '').trim();
  if (!uid) {
    return { profile: null, homeOrg: null, orgRole: { ok: true, role: null, isFounder: false, isPlatformAdmin: false } };
  }
  try {
    const prof = await withColumnFallback(NAV_PROFILE_COLUMNS, (cols) =>
      supabase.from('user_profiles').select(cols).eq('id', uid).maybeSingle()
    );
    if (prof.error) {
      console.warn('loadNavIdentity profile', prof.error.message);
      return { profile: null, homeOrg: null, orgRole: FAILED };
    }
    const row = (prof.data || null) as Omit<NavIdentityProfile, 'organizations'> | null;
    const homeId = row?.organization_id;
    const roleOrgId = reportingOrganizationId(row);
    const ids = [homeId, roleOrgId].filter(hasId).map(String);
    const uniqueIds = Array.from(new Set(ids));

    const [orgs, membership] = await Promise.all([
      uniqueIds.length
        ? withColumnFallback(NAV_ORG_COLUMNS, (cols) => supabase.from('organizations').select(cols).in('id', uniqueIds))
        : Promise.resolve<Result>({ data: [], error: null }),
      hasId(roleOrgId)
        ? (supabase
            .from('organization_memberships')
            .select('role, user_id, organization_id')
            .eq('user_id', uid)
            .eq('organization_id', roleOrgId)
            .maybeSingle() as PromiseLike<Result>)
        : Promise.resolve<Result>({ data: null, error: null }),
    ]);

    const orgRows = (Array.isArray(orgs.data) ? orgs.data : orgs.data ? [orgs.data] : []) as NavOrg[];
    const byId = (id: unknown) => (hasId(id) ? orgRows.find((o) => String(o.id) === String(id)) || null : null);
    const homeOrg = orgs.error ? null : byId(homeId);
    const roleOrg = byId(roleOrgId);

    const orgRole: OrgRoleResult =
      orgs.error || membership.error
        ? FAILED
        : { ok: true, ...orgRoleFromRows(uid, row, membership.data, roleOrg) };

    const profile: NavIdentityProfile | null = row
      ? {
          ...row,
          organizations: homeOrg
            ? { name: homeOrg.name ?? null, type: homeOrg.type ?? null, facility_type: homeOrg.facility_type ?? null }
            : null,
        }
      : null;
    return { profile, homeOrg, orgRole };
  } catch {
    return { profile: null, homeOrg: null, orgRole: FAILED };
  }
}
