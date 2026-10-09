import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '../supabase/migrations/20261009_000906_rls_require_membership.sql'),
  'utf8'
);
const rollback = readFileSync(
  join(here, '../supabase/migrations/20261009_000906_rls_require_membership_rollback.sql'),
  'utf8'
);
const sqlTest = readFileSync(
  join(here, '../supabase/tests/20261009_rls_require_membership.sql'),
  'utf8'
);
const precheck = readFileSync(
  join(here, '../supabase/oneoff/20261009_rls_membership_precheck.sql'),
  'utf8'
);

const policies: { table: string; name: string; cmd: string; role: string }[] = [
  { table: 'bids', name: 'Listing sellers update bid status', cmd: 'UPDATE', role: 'authenticated' },
  { table: 'bids', name: 'Listing sellers view bids', cmd: 'SELECT', role: 'authenticated' },
  { table: 'equipment', name: 'equipment_service_org_manage', cmd: 'ALL', role: 'authenticated' },
  { table: 'inventory_locations', name: 'locations_read', cmd: 'SELECT', role: 'authenticated' },
  { table: 'inventory_stock', name: 'stock_read', cmd: 'SELECT', role: 'authenticated' },
  { table: 'organization_customers', name: "Users can view their service org's customer links", cmd: 'SELECT', role: 'public' },
  { table: 'organization_customers', name: "Users can delete their org's customer links", cmd: 'DELETE', role: 'public' },
  { table: 'organization_manuals', name: 'organization_manuals_member_select', cmd: 'SELECT', role: 'authenticated' },
  { table: 'organization_manuals', name: 'organization_manuals_member_insert', cmd: 'INSERT', role: 'authenticated' },
  { table: 'organization_manuals', name: 'organization_manuals_member_delete', cmd: 'DELETE', role: 'authenticated' },
  { table: 'service_reports', name: 'service_reports_select', cmd: 'SELECT', role: 'authenticated' },
  { table: 'service_reports', name: 'service_reports_insert', cmd: 'INSERT', role: 'authenticated' },
  { table: 'service_reports', name: 'service_reports_update', cmd: 'UPDATE', role: 'authenticated' },
  { table: 'subscriptions', name: 'subscriptions_org_member_select', cmd: 'SELECT', role: 'authenticated' },
  { table: 'test_equipment', name: 'test_equipment_select', cmd: 'SELECT', role: 'authenticated' },
  { table: 'test_equipment', name: 'test_equipment_insert', cmd: 'INSERT', role: 'authenticated' },
  { table: 'test_equipment', name: 'test_equipment_update', cmd: 'UPDATE', role: 'authenticated' },
  { table: 'test_equipment', name: 'test_equipment_delete', cmd: 'DELETE', role: 'authenticated' },
  { table: 'engineer_invitations', name: 'engineer_invitations_select', cmd: 'SELECT', role: 'authenticated' },
  { table: 'marketplace_orders', name: 'Sellers read own marketplace orders', cmd: 'SELECT', role: 'authenticated' },
];

function policyName(name: string): string {
  return /^[a-z0-9_]+$/.test(name) ? name : `"${name}"`;
}

function policyBlock(sql: string, name: string): string {
  const marker = `CREATE POLICY ${policyName(name)}`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const rest = sql.slice(start + marker.length);
  const stops = [
    '\nDROP POLICY IF EXISTS',
    '\n-- Exact pg_get_functiondef',
    '\n-- organization_memberships policies',
  ]
    .map((token) => rest.indexOf(token))
    .filter((index) => index >= 0);
  const end = stops.length ? Math.min(...stops) : rest.length;
  return sql.slice(start, start + marker.length + end);
}

/** Profile-org match is not enough. Membership of that same org is required. */
function profileOrgAllowed(input: {
  profileOrgId: number | null;
  rowOrgId: number | null;
  membershipOrgIds: number[];
  otherBranch: boolean;
}): boolean {
  if (input.otherBranch) return true;
  if (input.profileOrgId == null || input.rowOrgId == null) return false;
  const profileMatch = String(input.profileOrgId) === String(input.rowOrgId);
  const member = input.membershipOrgIds.some((id) => String(id) === String(input.rowOrgId));
  return profileMatch && member;
}

test('migration is one transaction and adds the membership helper', () => {
  assert.match(migration, /^SET LOCAL lock_timeout = '5s';/m);
  assert.doesNotMatch(migration, /\bCOMMIT\b/);
  assert.doesNotMatch(migration, /CONCURRENTLY/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.is_active_org_member\(p_org bigint\)/);
  assert.match(migration, /LANGUAGE sql/);
  assert.match(migration, /STABLE/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = public, pg_temp/);
  assert.match(
    migration,
    /m\.user_id = auth\.uid\(\)[\s\S]*m\.organization_id = p_org/
  );
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.is_active_org_member\(bigint\) FROM PUBLIC/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_active_org_member\(bigint\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_active_org_member\(bigint\) TO anon/);
  assert.doesNotMatch(migration, /ON public\.organization_memberships/);
  assert.match(migration, /organization_memberships policies must not call is_active_org_member/);
});

test('every listed policy is recreated with a membership check and the same command', () => {
  for (const policy of policies) {
    const drop = `DROP POLICY IF EXISTS ${policyName(policy.name)} ON public.${policy.table}`;
    assert.ok(migration.includes(drop), drop);
    assert.ok(rollback.includes(drop), `rollback ${drop}`);
    const block = policyBlock(migration, policy.name);
    assert.match(block, new RegExp(`FOR ${policy.cmd}\\b`));
    assert.match(block, new RegExp(`TO ${policy.role}\\b`));
    assert.match(block, /is_active_org_member\(/);
    assert.match(block, /user_profiles/);
    const old = policyBlock(rollback, policy.name);
    assert.doesNotMatch(old, /is_active_org_member/);
  }
});

test('service_reports keeps text comparison and created_by; test equipment keeps assignee', () => {
  for (const name of ['service_reports_select', 'service_reports_insert', 'service_reports_update']) {
    const block = policyBlock(migration, name);
    assert.match(block, /\(organization_id\)::text/);
    assert.match(block, /\(user_profiles\.organization_id\)::text/);
    assert.match(block, /created_by = auth\.uid\(\)/);
  }
  const insert = policyBlock(migration, 'service_reports_insert');
  assert.match(insert, /organization_id IS NULL/);

  const select = policyBlock(migration, 'test_equipment_select');
  assert.match(select, /assigned_to_fse = auth\.uid\(\)/);
  assert.match(select, /owned_by = auth\.uid\(\)/);
  assert.match(select, /user_id = auth\.uid\(\)/);

  const update = policyBlock(migration, 'test_equipment_update');
  const using = update.slice(update.indexOf('USING'), update.indexOf('WITH CHECK'));
  const check = update.slice(update.indexOf('WITH CHECK'));
  assert.doesNotMatch(using, /assigned_to_fse/);
  assert.match(check, /assigned_to_fse = auth\.uid\(\)/);

  assert.match(policyBlock(migration, 'locations_read'), /owner_user_id = auth\.uid\(\)/);
  assert.match(policyBlock(migration, 'Listing sellers view bids'), /ml\.seller_id = auth\.uid\(\)/);
  assert.match(policyBlock(migration, 'Listing sellers view bids'), /ml\.created_by = auth\.uid\(\)/);
});

test('helpers require a membership and keep created_by', () => {
  const mine = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.get_my_org_id()'),
    migration.indexOf('COMMENT ON FUNCTION public.get_my_org_id()')
  );
  assert.match(mine, /active_organization_id/);
  assert.match(mine, /organization_memberships/);
  assert.doesNotMatch(mine, /laser_clinic/);
  assert.doesNotMatch(mine, /p\.organization_id/);

  const owns = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)'),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.caller_in_org(target bigint)')
  );
  assert.match(owns, /org_id = public\.get_my_org_id\(\)/);
  assert.match(owns, /public\.is_active_org_member\(org_id\)/);
  assert.match(owns, /o\.created_by = auth\.uid\(\)/);

  const caller = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.caller_in_org(target bigint)'),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.customer_org_link_allowed')
  );
  assert.match(caller, /SECURITY INVOKER/);
  assert.match(caller, /target = public\.get_my_org_id\(\)/);
  assert.match(caller, /public\.is_active_org_member\(target\)/);
  assert.match(caller, /organization_memberships/);

  const link = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.customer_org_link_allowed'),
    migration.indexOf('-- Policies.')
  );
  assert.match(link, /p_service = public\.get_my_org_id\(\)/);
  assert.match(link, /public\.is_active_org_member\(p_service\)/);

  assert.match(rollback, /laser_clinic/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.is_active_org_member\(bigint\)/);
  assert.match(rollback, /claimed clinic the caller did not create/);
});

test('a profile org without a membership is denied and a member is allowed', () => {
  assert.equal(
    profileOrgAllowed({ profileOrgId: 4, rowOrgId: 4, membershipOrgIds: [], otherBranch: false }),
    false
  );
  assert.equal(
    profileOrgAllowed({ profileOrgId: 4, rowOrgId: 4, membershipOrgIds: [4], otherBranch: false }),
    true
  );
  assert.equal(
    profileOrgAllowed({ profileOrgId: 4, rowOrgId: 9, membershipOrgIds: [9], otherBranch: false }),
    false
  );
  assert.equal(
    profileOrgAllowed({ profileOrgId: 4, rowOrgId: 4, membershipOrgIds: [], otherBranch: true }),
    true
  );
  assert.equal(
    profileOrgAllowed({
      profileOrgId: null,
      rowOrgId: null,
      membershipOrgIds: [],
      otherBranch: true,
    }),
    true
  );

  assert.match(sqlTest, /profile org without membership can read subscriptions/);
  assert.match(sqlTest, /member cannot read the organization subscription/);
  assert.match(sqlTest, /assigned_to_fse lost access/);
  assert.match(sqlTest, /created_by lost access/);
  assert.match(sqlTest, /ROLLBACK;/);
  assert.match(sqlTest, /Do not run this on production/);

  assert.match(precheck, /organization_memberships/);
  assert.match(precheck, /active_organization_id/);
  assert.match(precheck, /\+qa-/);
  assert.match(precheck, /account_kind/);
  assert.doesNotMatch(precheck, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
});
