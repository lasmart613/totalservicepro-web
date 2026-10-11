import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '../supabase/migrations/20261010_000909_service_reports_require_membership.sql'),
  'utf8'
);
const rollback = readFileSync(
  join(here, '../supabase/migrations/20261010_000909_service_reports_require_membership_rollback.sql'),
  'utf8'
);
const sqlTest = readFileSync(
  join(here, '../supabase/tests/20261010_service_reports_require_membership.sql'),
  'utf8'
);
const precheck = readFileSync(
  join(here, '../supabase/oneoff/20261010_service_reports_membership_precheck.sql'),
  'utf8'
);

function policyBlock(sql: string, name: string): string {
  const marker = `CREATE POLICY ${name}`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const rest = sql.slice(start + marker.length);
  const stops = ['\nDROP POLICY IF EXISTS', '\nCREATE OR REPLACE FUNCTION', '\n-- Same created_by gate']
    .map((token) => rest.indexOf(token))
    .filter((index) => index >= 0);
  const end = stops.length ? Math.min(...stops) : rest.length;
  return sql.slice(start, start + marker.length + end);
}

/**
 * SELECT and UPDATE. Profile org must match and the caller must be a member.
 * created_by is allowed only with a membership in the report's organization.
 * is_active_org_member(null) is false, so an unscoped report is not included.
 */
function serviceReportAllowed(input: {
  profileOrgId: number | null;
  rowOrgId: number | null;
  membershipOrgIds: number[];
  createdBySelf: boolean;
}): boolean {
  const member =
    input.rowOrgId != null &&
    input.membershipOrgIds.some((id) => String(id) === String(input.rowOrgId));
  const profileMatch =
    input.profileOrgId != null &&
    input.rowOrgId != null &&
    String(input.profileOrgId) === String(input.rowOrgId);
  const author = input.createdBySelf && member;
  return (profileMatch && member) || author;
}

test('migration is one transaction and gates created_by with the existing helper', () => {
  assert.match(migration, /^SET LOCAL lock_timeout = '5s';/m);
  assert.doesNotMatch(migration, /\bCOMMIT\b/);
  assert.doesNotMatch(migration, /CONCURRENTLY/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.is_active_org_member/);
  assert.match(migration, /public\.is_active_org_member\(organization_id\)/);
  assert.match(migration, /public\.is_active_org_member\(p_org bigint\)/);
  assert.doesNotMatch(migration, /ON public\.organization_memberships/);
  assert.doesNotMatch(migration, /CREATE POLICY service_reports_insert/);

  for (const name of ['service_reports_select', 'service_reports_update']) {
    const block = policyBlock(migration, name);
    assert.match(block, /TO authenticated/);
    assert.match(block, /\(organization_id\)::text/);
    assert.match(block, /\(user_profiles\.organization_id\)::text/);
    assert.match(
      block,
      /created_by = auth\.uid\(\)\s+AND public\.is_active_org_member\(organization_id\)/
    );
  }
  assert.match(policyBlock(migration, 'service_reports_select'), /FOR SELECT/);
  const update = policyBlock(migration, 'service_reports_update');
  assert.match(update, /FOR UPDATE/);
  const using = update.slice(update.indexOf('USING'), update.indexOf('WITH CHECK'));
  const check = update.slice(update.indexOf('WITH CHECK'));
  assert.match(using, /created_by = auth\.uid\(\)\s+AND public\.is_active_org_member\(organization_id\)/);
  assert.match(check, /created_by = auth\.uid\(\)\s+AND public\.is_active_org_member\(organization_id\)/);

  const hist = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history'),
  );
  assert.match(hist, /SECURITY DEFINER/);
  assert.match(hist, /SET search_path = public/);
  assert.match(hist, /r\.organization_id = public\.get_my_org_id\(\)/);
  assert.match(
    hist,
    /r\.created_by = auth\.uid\(\)\s+AND public\.is_active_org_member\(r\.organization_id\)/
  );
  assert.match(hist, /public\.user_owns_or_created_org\(r\.customer_organization_id\)/);
  assert.match(hist, /public\.user_owns_or_created_org\(e\.customer_organization_id\)/);
  assert.match(hist, /oc\.service_organization_id = public\.get_my_org_id\(\)/);
});

test('rollback restores the live created_by policies and history function', () => {
  assert.match(rollback, /^SET LOCAL lock_timeout = '5s';/m);
  assert.doesNotMatch(rollback, /\bCOMMIT\b/);
  assert.doesNotMatch(rollback, /CONCURRENTLY/);
  assert.doesNotMatch(rollback, /DROP FUNCTION/);

  const select = policyBlock(rollback, 'service_reports_select');
  assert.match(select, /FOR SELECT/);
  assert.match(select, /TO authenticated/);
  assert.match(select, /is_active_org_member\(organization_id\)/);
  assert.match(select, /OR \(created_by = auth\.uid\(\)\)/);
  assert.doesNotMatch(select, /created_by = auth\.uid\(\)\)\s+AND/);

  const update = policyBlock(rollback, 'service_reports_update');
  assert.match(update, /FOR UPDATE/);
  assert.match(update, /USING \(\(\(created_by = auth\.uid\(\)\) OR/);
  assert.match(update, /WITH CHECK \(\(\(created_by = auth\.uid\(\)\) OR/);
  assert.match(update, /is_active_org_member\(organization_id\)/);
  assert.doesNotMatch(update, /created_by = auth\.uid\(\)\)\s+AND/);

  const hist = rollback.slice(
    rollback.indexOf('CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history'),
  );
  assert.match(hist, /SET search_path TO 'public'/);
  assert.match(hist, /OR \(r\.created_by IS NOT NULL AND r\.created_by = auth\.uid\(\)\)/);
  assert.doesNotMatch(hist, /is_active_org_member/);
  assert.match(hist, /public\.user_owns_or_created_org\(r\.customer_organization_id\)/);
  assert.match(hist, /\$function\$/);
});

test('a former author is denied and a current member is allowed', () => {
  assert.equal(
    serviceReportAllowed({ profileOrgId: 4, rowOrgId: 4, membershipOrgIds: [], createdBySelf: true }),
    false
  );
  assert.equal(
    serviceReportAllowed({ profileOrgId: 4, rowOrgId: 4, membershipOrgIds: [4], createdBySelf: true }),
    true
  );
  assert.equal(
    serviceReportAllowed({ profileOrgId: 9, rowOrgId: 4, membershipOrgIds: [4], createdBySelf: true }),
    true
  );
  assert.equal(
    serviceReportAllowed({ profileOrgId: 4, rowOrgId: 4, membershipOrgIds: [4], createdBySelf: false }),
    true
  );
  assert.equal(
    serviceReportAllowed({ profileOrgId: 9, rowOrgId: 4, membershipOrgIds: [4], createdBySelf: false }),
    false
  );
  assert.equal(
    serviceReportAllowed({ profileOrgId: 4, rowOrgId: 4, membershipOrgIds: [9], createdBySelf: true }),
    false
  );
  assert.equal(
    serviceReportAllowed({ profileOrgId: null, rowOrgId: null, membershipOrgIds: [], createdBySelf: true }),
    false
  );

  assert.match(sqlTest, /former author can read a service report after leaving the org/);
  assert.match(sqlTest, /former author can update a service report after leaving the org/);
  assert.match(sqlTest, /member cannot read the organization service report/);
  assert.match(sqlTest, /member cannot update the organization service report/);
  assert.match(sqlTest, /is_active_org_member\(bigint\)/);
  assert.match(sqlTest, /ROLLBACK;/);
  assert.match(sqlTest, /Do not run this on production/);

  assert.match(precheck, /service_reports/);
  assert.match(precheck, /organization_memberships/);
  assert.match(precheck, /created_by/);
  assert.match(precheck, /\+qa-/);
  assert.match(precheck, /account_kind/);
  assert.doesNotMatch(precheck, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/);
});
