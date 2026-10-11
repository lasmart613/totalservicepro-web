import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNavIdentity, NAV_ORG_COLUMNS, NAV_PROFILE_COLUMNS } from './nav-identity.ts';
import { getOrgRole } from './org-role.ts';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** Minimal PostgREST-ish client: eq / in / maybeSingle, counts every read. */
function fakeClient(tables: Tables, opts: { failColumns?: RegExp; failTable?: string } = {}) {
  const reads: string[] = [];
  const client = {
    from(table: string) {
      let filters: Array<(r: Row) => boolean> = [];
      let cols = '';
      const run = () => {
        reads.push(table);
        if (opts.failTable === table) return { data: null, error: { message: 'boom' } };
        if (opts.failColumns && opts.failColumns.test(cols)) {
          return { data: null, error: { message: `column "${cols.split(',').pop()!.trim()}" does not exist` } };
        }
        return { data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null };
      };
      const builder: any = {
        select(c: string) {
          cols = c;
          return builder;
        },
        eq(col: string, value: unknown) {
          filters.push((r) => String(r[col]) === String(value));
          return builder;
        },
        in(col: string, values: unknown[]) {
          filters.push((r) => values.map(String).includes(String(r[col])));
          return builder;
        },
        maybeSingle() {
          const res = run();
          return Promise.resolve({ data: res.data ? res.data[0] || null : null, error: res.error });
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { client, reads };
}

const UID = 'u-1';
const base: Tables = {
  user_profiles: [
    {
      id: UID,
      first_name: 'Ann',
      last_name: 'Lee',
      role: 'technician',
      organization_id: 1,
      active_organization_id: 2,
      onboarding_completed: true,
      onboarding_completed_at: null,
    },
  ],
  organizations: [
    { id: 1, name: 'Home Co', type: 'service_company', facility_type: null, created_by: 'someone', is_premium: false, subscription_tier: 'free', plan: null, premium_until: null },
    { id: 2, name: 'Active Co', type: 'service_company', facility_type: null, created_by: UID, is_premium: true, subscription_tier: 'team', plan: 'team', premium_until: null },
  ],
  organization_memberships: [
    { role: 'admin', user_id: UID, organization_id: 2 },
    { role: 'technician', user_id: UID, organization_id: 1 },
  ],
};

test('three reads cover profile, both orgs and the active-org role', async () => {
  const { client, reads } = fakeClient(base);
  const got = await loadNavIdentity(client, UID);
  assert.deepEqual(reads.sort(), ['organization_memberships', 'organizations', 'user_profiles']);
  assert.equal(got.profile?.first_name, 'Ann');
  // Nav name/type comes from the home org, like loadOwnNavProfile.
  assert.deepEqual(got.profile?.organizations, { name: 'Home Co', type: 'service_company', facility_type: null });
  // Upgrade entry and ads read the home org.
  assert.equal(got.homeOrg?.id, 1);
  assert.equal(got.homeOrg?.subscription_tier, 'free');
  // Role is for the active org (reportingOrganizationId), same as getOrgRole.
  assert.deepEqual(got.orgRole, { ok: true, role: 'company_admin', isFounder: true, isPlatformAdmin: false });
  const { client: c2 } = fakeClient(base);
  assert.deepEqual(got.orgRole, await getOrgRole(c2 as any, UID, 2));
});

test('home org only: one org row, role for the home org', async () => {
  const tables: Tables = {
    ...base,
    user_profiles: [{ ...base.user_profiles[0], active_organization_id: null, role: 'admin' }],
  };
  const { client } = fakeClient(tables);
  const got = await loadNavIdentity(client, UID);
  assert.equal(got.homeOrg?.id, 1);
  assert.deepEqual(got.orgRole, { ok: true, role: 'technician', isFounder: false, isPlatformAdmin: true });
});

test('missing columns step down instead of failing', async () => {
  const { client, reads } = fakeClient(base, { failColumns: /onboarding_completed_at|premium_until/ });
  const got = await loadNavIdentity(client, UID);
  assert.equal(got.profile?.first_name, 'Ann');
  assert.equal(got.homeOrg?.name, 'Home Co');
  assert.equal(got.orgRole.ok, true);
  assert.ok(reads.length <= 5);
  assert.ok(NAV_PROFILE_COLUMNS.length > 1 && NAV_ORG_COLUMNS.length > 1);
});

test('lookup errors fail closed', async () => {
  for (const failTable of ['user_profiles', 'organizations', 'organization_memberships']) {
    const { client } = fakeClient(base, { failTable });
    const got = await loadNavIdentity(client, UID);
    assert.equal(got.orgRole.ok, false, failTable);
  }
});

test('no user id: nothing read', async () => {
  const { client, reads } = fakeClient(base);
  const got = await loadNavIdentity(client, '');
  assert.equal(reads.length, 0);
  assert.equal(got.profile, null);
});

test('profile columns never embed organizations', () => {
  for (const cols of NAV_PROFILE_COLUMNS) assert.doesNotMatch(cols, /organizations/);
});
