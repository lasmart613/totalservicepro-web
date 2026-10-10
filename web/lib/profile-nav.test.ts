import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOrgRole, reportingOrganizationId } from './org-role.ts';
import {
  adminPortalNavVisible,
  businessManagementNavVisible,
  ORG_NAV_PENDING,
  orgNavFromLookup,
} from './profile-nav.ts';

const here = dirname(fileURLToPath(import.meta.url));
const user = 'user-1';

type Row = Record<string, unknown>;

function db(tables: Record<string, Row[]>, failTable?: string) {
  return {
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return api;
        },
        maybeSingle: async () => {
          if (failTable === table) return { data: null, error: { message: 'db down' } };
          const rows = (tables[table] || []).filter((row) =>
            filters.every((filter) => String(row[filter.column] ?? '') === String(filter.value))
          );
          if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
          return { data: rows[0] ?? null, error: null };
        },
      };
      return api;
    },
  };
}

function shop(input: {
  profileRole: string;
  membershipRole: string | null;
  orgId?: number;
  createdBy?: string;
}) {
  const orgId = input.orgId ?? 9;
  return db({
    user_profiles: [{ id: user, role: input.profileRole }],
    organization_memberships: input.membershipRole
      ? [{ user_id: user, organization_id: orgId, role: input.membershipRole }]
      : [],
    organizations: [{ id: orgId, created_by: input.createdBy ?? 'other' }],
  });
}

async function navFor(input: {
  profileRole: string;
  membershipRole: string | null;
  orgId?: number;
  createdBy?: string;
  failTable?: string;
}) {
  const orgId = input.orgId ?? 9;
  const client = input.failTable
    ? db(
        {
          user_profiles: [{ id: user, role: input.profileRole }],
          organization_memberships: input.membershipRole
            ? [{ user_id: user, organization_id: orgId, role: input.membershipRole }]
            : [],
          organizations: [{ id: orgId, created_by: input.createdBy ?? 'other' }],
        },
        input.failTable
      )
    : shop(input);
  const looked = await getOrgRole(client, user, orgId);
  return orgNavFromLookup(looked);
}

test('profile company_admin with an fse membership sees neither nav entry', async () => {
  const nav = await navFor({ profileRole: 'company_admin', membershipRole: 'fse' });
  assert.equal(nav.lookup, 'ready');
  assert.equal(nav.platformAdmin, false);
  assert.equal(adminPortalNavVisible(nav), false);
  assert.equal(businessManagementNavVisible(nav), false);
});

test('membership company_admin sees Business Management but not Admin Portal', async () => {
  for (const profileRole of ['fse', 'company_admin', 'service_manager']) {
    const nav = await navFor({ profileRole, membershipRole: 'company_admin' });
    assert.equal(adminPortalNavVisible(nav), false, profileRole);
    assert.equal(businessManagementNavVisible(nav), true, profileRole);
  }
});

test('platform admin sees Admin Portal and Business Management', async () => {
  const nav = await navFor({ profileRole: 'admin', membershipRole: 'fse' });
  assert.equal(nav.platformAdmin, true);
  assert.equal(nav.orgPowerRole, 'admin');
  assert.equal(adminPortalNavVisible(nav), true);
  assert.equal(businessManagementNavVisible(nav), true);

  const noShop = await navFor({ profileRole: 'admin', membershipRole: null });
  assert.equal(adminPortalNavVisible(noShop), true);
  assert.equal(businessManagementNavVisible(noShop), true);
});

test('a company_admin membership in another shop does not open this shop', async () => {
  const client = db({
    user_profiles: [{ id: user, role: 'company_admin', active_organization_id: 9, organization_id: 4 }],
    organization_memberships: [
      { user_id: user, organization_id: 9, role: 'fse' },
      { user_id: user, organization_id: 4, role: 'company_admin' },
    ],
    organizations: [
      { id: 9, created_by: 'other' },
      { id: 4, created_by: 'other' },
    ],
  });
  const current = reportingOrganizationId({
    active_organization_id: 9,
    organization_id: 4,
  });
  assert.equal(current, 9);
  const nav = orgNavFromLookup(await getOrgRole(client, user, current));
  assert.equal(adminPortalNavVisible(nav), false);
  assert.equal(businessManagementNavVisible(nav), false);

  const homeOnly = reportingOrganizationId({ organization_id: 4 });
  const home = orgNavFromLookup(await getOrgRole(client, user, homeOnly));
  assert.equal(businessManagementNavVisible(home), true);
  assert.equal(adminPortalNavVisible(home), false);
});

test('nav stays hidden while the org role lookup is pending or failed', async () => {
  const ready = await navFor({ profileRole: 'admin', membershipRole: 'company_admin' });
  assert.equal(adminPortalNavVisible({ ...ready, lookup: 'pending' }), false);
  assert.equal(businessManagementNavVisible({ ...ready, lookup: 'pending' }), false);
  assert.equal(adminPortalNavVisible(ORG_NAV_PENDING), false);
  assert.equal(businessManagementNavVisible(ORG_NAV_PENDING), false);

  const failed = await navFor({
    profileRole: 'admin',
    membershipRole: 'company_admin',
    failTable: 'organization_memberships',
  });
  assert.equal(failed.lookup, 'error');
  assert.equal(failed.platformAdmin, false);
  assert.equal(adminPortalNavVisible(failed), false);
  assert.equal(businessManagementNavVisible(failed), false);
});

test('CRM lead memberships see Business Management but not Admin Portal', async () => {
  const founder = await navFor({
    profileRole: 'company_admin',
    membershipRole: 'fse',
    createdBy: user,
  });
  assert.equal(businessManagementNavVisible(founder), false);
  assert.equal(adminPortalNavVisible(founder), false);

  for (const membershipRole of ['service_manager', 'dispatcher', 'scheduler', 'billing_manager']) {
    const nav = await navFor({ profileRole: 'fse', membershipRole });
    assert.equal(businessManagementNavVisible(nav), true, membershipRole);
    assert.equal(adminPortalNavVisible(nav), false, membershipRole);
    assert.equal(nav.orgPowerRole, membershipRole);
  }

  const owner = await navFor({ profileRole: 'company_admin', membershipRole: 'owner' });
  assert.equal(businessManagementNavVisible(owner), false);
  assert.equal(adminPortalNavVisible(owner), false);
});

test('header, home, and hub gate both entries on the org lookup and fail closed', () => {
  const header = readFileSync(join(here, '../components/Header.tsx'), 'utf8');
  const home = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  const hub = readFileSync(join(here, '../app/hub/page.tsx'), 'utf8');

  for (const source of [header, home, hub]) {
    assert.match(source, /orgNavFromLookup\(/);
    assert.match(source, /ORG_NAV_PENDING/);
    assert.match(source, /reportingOrganizationId\(/);
    assert.doesNotMatch(source, /isAdmin\(profile\?\.role\)/);
    assert.doesNotMatch(source, /\['service_manager', 'dispatcher', 'scheduler', 'billing_manager'\]/);
  }
  assert.doesNotMatch(header, /isAdmin\(role\)/);
  assert.doesNotMatch(hub, /isAdmin\(/);

  assert.match(header, /adminPortalNavVisible\(orgNav\)/);
  assert.match(header, /businessManagementNavVisible\(orgNav\)/);
  assert.match(header, /setOrgNav\(ORG_NAV_PENDING\)/);
  assert.match(home, /adminPortalNavVisible\(orgNav\)/);
  assert.match(home, /businessManagementNavVisible\(orgNav\)/);
  assert.match(hub, /businessManagementNavVisible\(orgNav\)/);
  assert.match(header, /financialReportingNavLink\(\{ role: orgPowerRole, god: isGod \}\)/);
  assert.match(home, /canAccessFinancialReporting\(\{ role: orgPowerRole, god \}\)/);
  assert.match(hub, /canAccessFinancialReporting\(\{ role: orgPowerRole, god \}\)/);
});
