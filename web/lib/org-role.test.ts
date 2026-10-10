import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { runVoidInvoice } from '../app/api/billing/invoices/void/route.ts';
import {
  getOrgRole,
  membershipRoleForOrgPowers,
  orgRoleAllows,
  orgRoleOutranks,
  orgRoleRank,
  ORG_ROLE_LOOKUP_ERROR,
  SHOP_ADMIN_ROLES,
  TEAM_LEAD_ROLES,
  teamLeadRole,
  VOID_INVOICE_ROLES,
  voidInvoiceRole,
} from './org-role.ts';

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

const user = 'user-1';

test('membership role admin is company_admin and ranks below platform admin', () => {
  assert.equal(membershipRoleForOrgPowers(' Admin '), 'company_admin');
  assert.equal(membershipRoleForOrgPowers('fse'), 'fse');
  assert.equal(membershipRoleForOrgPowers(''), null);
  assert.equal(orgRoleOutranks('company_admin', 'fse'), true);
  assert.equal(orgRoleOutranks('fse', 'company_admin'), false);
  assert.ok(orgRoleRank('admin') > orgRoleRank('company_admin'));
});

test('getOrgRole uses the membership in the target org', async () => {
  const client = db({
    user_profiles: [{ id: user, role: 'fse' }],
    organization_memberships: [
      { user_id: user, organization_id: 9, role: 'company_admin' },
      { user_id: user, organization_id: 8, role: 'company_admin' },
    ],
    organizations: [{ id: 9, created_by: 'someone-else' }],
  });

  const here = await getOrgRole(client, user, 9);
  assert.equal(here.ok, true);
  if (!here.ok) return;
  assert.equal(here.role, 'company_admin');
  assert.equal(here.isFounder, false);
  assert.equal(here.isPlatformAdmin, false);
  assert.equal(orgRoleAllows(here, TEAM_LEAD_ROLES), true);
  assert.equal(teamLeadRole(here), 'company_admin');

  const elsewhere = await getOrgRole(client, user, 4);
  assert.equal(elsewhere.ok, true);
  if (!elsewhere.ok) return;
  assert.equal(elsewhere.role, null);
  assert.equal(orgRoleAllows(elsewhere, TEAM_LEAD_ROLES), false);
});

test('a company_admin profile with an fse membership is not an org lead', async () => {
  const client = db({
    user_profiles: [{ id: user, role: 'company_admin' }],
    organization_memberships: [{ user_id: user, organization_id: 9, role: 'fse' }],
    organizations: [{ id: 9, created_by: 'other' }],
  });
  const org = await getOrgRole(client, user, 9);
  assert.equal(org.ok, true);
  if (!org.ok) return;
  assert.equal(org.role, 'fse');
  assert.equal(org.isPlatformAdmin, false);
  assert.equal(orgRoleAllows(org, TEAM_LEAD_ROLES), false);
  assert.equal(orgRoleAllows(org, SHOP_ADMIN_ROLES), false);
  assert.equal(voidInvoiceRole(org), 'fse');
});

test('no membership is 403 unless the profile is platform admin', async () => {
  const shopAdmin = await getOrgRole(
    db({
      user_profiles: [{ id: user, role: 'company_admin' }],
      organization_memberships: [],
      organizations: [{ id: 9, created_by: 'other' }],
    }),
    user,
    9
  );
  assert.equal(shopAdmin.ok, true);
  if (!shopAdmin.ok) return;
  assert.equal(shopAdmin.role, null);
  assert.equal(orgRoleAllows(shopAdmin, TEAM_LEAD_ROLES), false);
  assert.equal(orgRoleAllows(shopAdmin, SHOP_ADMIN_ROLES), false);

  const platform = await getOrgRole(
    db({
      user_profiles: [{ id: user, role: 'admin' }],
      organization_memberships: [],
      organizations: [{ id: 9, created_by: 'other' }],
    }),
    user,
    9
  );
  assert.equal(platform.ok, true);
  if (!platform.ok) return;
  assert.equal(platform.isPlatformAdmin, true);
  assert.equal(platform.role, null);
  assert.equal(teamLeadRole(platform), 'admin');
  assert.equal(voidInvoiceRole(platform), 'admin');
  assert.equal(orgRoleAllows(platform, SHOP_ADMIN_ROLES), true);
});

test('a membership role of admin is company_admin and is not platform admin', async () => {
  const org = await getOrgRole(
    db({
      user_profiles: [{ id: user, role: 'fse' }],
      organization_memberships: [{ user_id: user, organization_id: 9, role: 'admin' }],
      organizations: [{ id: 9, created_by: 'other' }],
    }),
    user,
    9
  );
  assert.equal(org.ok, true);
  if (!org.ok) return;
  assert.equal(org.role, 'company_admin');
  assert.equal(org.isPlatformAdmin, false);
  assert.equal(orgRoleAllows(org, SHOP_ADMIN_ROLES), true);
});

test('a founder with a non-lead membership is not a team or void lead', async () => {
  const member = await getOrgRole(
    db({
      user_profiles: [{ id: user, role: 'parts_supplier' }],
      organization_memberships: [{ user_id: user, organization_id: 9, role: 'fse' }],
      organizations: [{ id: 9, created_by: user }],
    }),
    user,
    9
  );
  assert.equal(member.ok, true);
  if (!member.ok) return;
  assert.equal(member.isFounder, true);
  assert.equal(member.role, 'fse');
  assert.equal(orgRoleAllows(member, TEAM_LEAD_ROLES), false);
  assert.equal(orgRoleAllows(member, VOID_INVOICE_ROLES), false);
  assert.equal(orgRoleAllows(member, SHOP_ADMIN_ROLES), false);
  assert.equal(teamLeadRole(member), 'fse');
  assert.equal(voidInvoiceRole(member), 'fse');

  const missing = await getOrgRole(
    db({
      user_profiles: [{ id: user, role: 'fse' }],
      organization_memberships: [],
      organizations: [{ id: 9, created_by: user }],
    }),
    user,
    9
  );
  assert.equal(missing.ok, true);
  if (!missing.ok) return;
  assert.equal(missing.isFounder, true);
  assert.equal(missing.role, null);
  assert.equal(orgRoleAllows(missing, TEAM_LEAD_ROLES), false);
  assert.equal(orgRoleAllows(missing, VOID_INVOICE_ROLES), false);
});

test('an organization role lookup error fails closed', async () => {
  for (const table of ['user_profiles', 'organization_memberships', 'organizations']) {
    const result = await getOrgRole(
      db(
        {
          user_profiles: [{ id: user, role: 'company_admin' }],
          organization_memberships: [{ user_id: user, organization_id: 9, role: 'company_admin' }],
          organizations: [{ id: 9, created_by: user }],
        },
        table
      ),
      user,
      9
    );
    assert.equal(result.ok, false, table);
    if (result.ok) return;
    assert.equal(result.status, 503);
    assert.equal(result.error, ORG_ROLE_LOOKUP_ERROR);
  }
});

function voidClient(input: {
  profileRole: string;
  membershipRole: string | null;
  invoice?: Row | null;
  fail?: string;
  createdBy?: string | null;
}) {
  const orgId = 7;
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: user, email: 'ada@shop.test' } }, error: null }),
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return api;
        },
        maybeSingle: async () => {
          if (input.fail === table) return { data: null, error: { message: 'db down' } };
          if (table === 'user_profiles') {
            return { data: { id: user, organization_id: orgId, role: input.profileRole }, error: null };
          }
          if (table === 'organization_memberships') {
            if (input.membershipRole == null) return { data: null, error: null };
            if (String(filters.organization_id ?? '') !== String(orgId)) return { data: null, error: null };
            return {
              data: { user_id: user, organization_id: orgId, role: input.membershipRole },
              error: null,
            };
          }
          if (table === 'organizations') return { data: { id: orgId, created_by: input.createdBy ?? null }, error: null };
          if (table === 'service_invoices') return { data: input.invoice ?? null, error: null };
          return { data: null, error: null };
        },
        update() {
          return {
            eq() {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return api;
    },
  };
}

test('void uses the membership role and fails closed on a lookup error', async () => {
  const invoice = {
    id: 5,
    organization_id: 7,
    status: 'sent',
    amount_paid: 0,
    invoice_data: {},
  };
  const request = () =>
    new NextRequest('https://repairplanet.net/api/billing/invoices/void', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ invoice_id: 5 }),
    });

  const denied = await runVoidInvoice(request(), {
    userClient: voidClient({ profileRole: 'company_admin', membershipRole: 'fse', invoice }) as never,
    adminClient: null,
  });
  assert.equal(denied.status, 403);

  const allowedRole = await runVoidInvoice(request(), {
    userClient: voidClient({ profileRole: 'fse', membershipRole: 'company_admin', invoice }) as never,
    adminClient: null,
  });
  assert.equal(allowedRole.status, 200, await allowedRole.clone().text());

  const founder = await runVoidInvoice(request(), {
    userClient: voidClient({
      profileRole: 'parts_supplier',
      membershipRole: 'fse',
      createdBy: user,
      invoice,
    }) as never,
    adminClient: null,
  });
  assert.equal(founder.status, 403);

  const lookup = await runVoidInvoice(request(), {
    userClient: voidClient({
      profileRole: 'company_admin',
      membershipRole: 'company_admin',
      invoice,
      fail: 'organization_memberships',
    }) as never,
    adminClient: null,
  });
  assert.equal(lookup.status, 503);
  const lookupBody = (await lookup.json()) as { error?: string };
  assert.equal(lookupBody.error, ORG_ROLE_LOOKUP_ERROR);
});
