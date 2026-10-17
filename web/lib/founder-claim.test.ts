/**
 * A removed tech is still organizations.created_by on the clinics they added.
 * POST /api/org/founder linked any created_by caller as the org's founder
 * (owner of a customer clinic), which would hand the clinic back after
 * removal. Now an existing org is claimable only by a current member, or while
 * it is brand new and unclaimed (24h, no members, no service link), the same
 * rule as org_unclaimed_new in 20261011_000916.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { founderClaimAllowed, UNCLAIMED_ORG_WINDOW_MS } from './tenant-lockdown.ts';
import { loadFounderClaimState } from './founder-claim.ts';

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date('2026-10-11T20:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

test('removed tech: clinic served by the shop is refused even though they are created_by', () => {
  const r = founderClaimAllowed({
    callerIsMember: false, orgHasMembers: false, orgHasServiceLink: true, orgCreatedAt: hoursAgo(1), now,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

test('an org that already has members is refused to a non-member creator', () => {
  const r = founderClaimAllowed({
    callerIsMember: false, orgHasMembers: true, orgHasServiceLink: false, orgCreatedAt: hoursAgo(1), now,
  });
  assert.equal(r.ok, false);
});

test('brand-new unclaimed org (onboarding) is allowed; after 24h it is not', () => {
  assert.equal(
    founderClaimAllowed({ callerIsMember: false, orgHasMembers: false, orgHasServiceLink: false, orgCreatedAt: hoursAgo(0.01), now }).ok,
    true
  );
  assert.equal(
    founderClaimAllowed({ callerIsMember: false, orgHasMembers: false, orgHasServiceLink: false, orgCreatedAt: hoursAgo(25), now }).ok,
    false
  );
  assert.equal(UNCLAIMED_ORG_WINDOW_MS, 24 * 3600_000);
});

test('a current member re-linking is always allowed', () => {
  assert.equal(
    founderClaimAllowed({ callerIsMember: true, orgHasMembers: true, orgHasServiceLink: true, orgCreatedAt: hoursAgo(9999), now }).ok,
    true
  );
});

test('unknown state (read error, missing created_at) fails closed', () => {
  assert.equal(founderClaimAllowed({ callerIsMember: null, orgHasMembers: false, orgHasServiceLink: false, orgCreatedAt: hoursAgo(1), now }).ok, false);
  assert.equal(founderClaimAllowed({ callerIsMember: false, orgHasMembers: null, orgHasServiceLink: false, orgCreatedAt: hoursAgo(1), now }).ok, false);
  assert.equal(founderClaimAllowed({ callerIsMember: false, orgHasMembers: false, orgHasServiceLink: null, orgCreatedAt: hoursAgo(1), now }).ok, false);
  assert.equal(founderClaimAllowed({ callerIsMember: false, orgHasMembers: false, orgHasServiceLink: false, orgCreatedAt: null, now }).ok, false);
});

const NO_919_ROWS = { organizations: [], service_reports: [], service_tickets: [] };

function fakeAdmin(tables: Record<string, Array<Record<string, unknown>> | { error: string }>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select() { return q; },
        eq(col: string, v: unknown) { filters.push([col, v]); return q; },
        async limit(n: number) {
          const t = tables[table];
          if (!Array.isArray(t)) return { data: null, error: { message: t?.error || 'missing' } };
          return { data: t.filter((r) => filters.every(([c, v]) => String(r[c]) === String(v))).slice(0, n), error: null };
        },
      };
      return q;
    },
  };
}

test('loadFounderClaimState reads memberships and service links; errors become null', async () => {
  const admin = fakeAdmin({
    organization_memberships: [{ user_id: 'boss', organization_id: 7 }],
    organization_customers: [{ id: 1, customer_organization_id: 21 }],
    ...NO_919_ROWS,
  });
  assert.deepEqual(await loadFounderClaimState(admin, 21, 'removed-tech'), {
    callerIsMember: false, orgHasMembers: false, orgHasServiceLink: true, creatorIsShopMember: false,
    creatorWasShopMember: false, orgServed: false,
  });
  assert.deepEqual(await loadFounderClaimState(admin, 7, 'boss'), {
    callerIsMember: true, orgHasMembers: true, orgHasServiceLink: false, creatorIsShopMember: false,
    creatorWasShopMember: false, orgServed: false,
  });
  const broken = fakeAdmin({ organization_memberships: { error: 'boom' }, organization_customers: [], ...NO_919_ROWS });
  assert.deepEqual(await loadFounderClaimState(broken, 7, 'boss'), {
    callerIsMember: null, orgHasMembers: null, orgHasServiceLink: false, creatorIsShopMember: null,
    creatorWasShopMember: false, orgServed: false,
  });
});

test('founder route checks the claim on existing orgs before granting or writing the membership', () => {
  const route = readFileSync(join(here, '../app/api/org/founder/route.ts'), 'utf8');
  const decide = route.indexOf('const decision = decideFounderLink');
  const claim = route.indexOf('const claim = await loadFounderClaimState(admin, orgId, user.id);');
  const allowed = route.indexOf('const allowed = founderClaimAllowed(');
  const grant = route.indexOf('await grantSignupTrialIfEligible(admin');
  const membership = route.indexOf('const membership = await upsertMembership(admin');
  assert.ok(decide > 0 && claim > decide && allowed > claim, 'claim check follows decideFounderLink');
  assert.ok(allowed < grant && allowed < membership, 'claim check precedes the trial grant and membership write');
  assert.match(route.slice(claim - 200, claim), /if \(existingForGrant\) \{/);
});

test('legacy founder read still carries created_at for the claim check', async () => {
  const { FOUNDER_ORG_COLUMNS, FOUNDER_ORG_COLUMNS_LEGACY } = await import('./signup-trial.ts');
  assert.match(FOUNDER_ORG_COLUMNS, /\bcreated_at\b/);
  assert.match(FOUNDER_ORG_COLUMNS_LEGACY, /\bcreated_at\b/);
});

test('000917: founder claim on a customer org created by a shop user is refused', async () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  const admin = fakeAdmin({
    organization_memberships: [{ user_id: 'tech', organization_id: 4 }],
    organization_customers: [],
    organizations: [{ id: 4, type: 'service_company' }, { id: 70, type: 'customer' }],
    service_reports: [],
    service_tickets: [],
  });
  const claim = await loadFounderClaimState(admin, 70, 'tech');
  assert.deepEqual(claim, {
    callerIsMember: false, orgHasMembers: false, orgHasServiceLink: false, creatorIsShopMember: true,
    creatorWasShopMember: false, orgServed: false,
  });
  const refused = founderClaimAllowed({ ...claim, orgType: 'customer', orgCreatedAt: fresh, now });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.status, 403);
  for (const t of ['laser_clinic', 'laser_rental', 'laser_reseller']) {
    assert.equal(founderClaimAllowed({ ...claim, orgType: t, orgCreatedAt: fresh, now }).ok, false, t);
  }
  // Same shop user founding a new service company is still fine.
  assert.equal(founderClaimAllowed({ ...claim, orgType: 'service_company', orgCreatedAt: fresh, now }).ok, true);
  // A clinic owner signing up (in no shop) still claims their own new clinic.
  const own = await loadFounderClaimState(fakeAdmin({ organization_memberships: [], organization_customers: [], ...NO_919_ROWS }), 71, 'clinic-owner');
  assert.equal(founderClaimAllowed({ ...own, orgType: 'laser_clinic', orgCreatedAt: fresh, now }).ok, true);
  // Unknown shop state on a customer org fails closed.
  assert.equal(founderClaimAllowed({ ...own, creatorIsShopMember: null, orgType: 'customer', orgCreatedAt: fresh, now }).ok, false);
});

test('founder route passes the org type into the claim check', () => {
  const route = readFileSync(join(here, '../app/api/org/founder/route.ts'), 'utf8');
  assert.match(route, /founderClaimAllowed\(\{\s*\.\.\.claim,\s*orgType,/);
});

// ---- 000919: leaving the shop first does not make a shop-created or served
// customer org claimable. These fail on 000917 code (main 0eca846c).

const now919 = new Date('2026-10-16T22:00:00Z');
const fresh919 = new Date(now919.getTime() - 5 * 60_000).toISOString();

test('000919: leave-then-claim: a tech who left the shop cannot claim the clinic they created', async () => {
  // After POST /api/org/leave the tech has no memberships at all.
  const admin = fakeAdmin({
    organization_memberships: [],
    organization_customers: [],
    organizations: [{ id: 51, type: 'customer', creator_shop_org_id: 4 }],
    service_reports: [],
    service_tickets: [],
  });
  const claim = await loadFounderClaimState(admin, 51, 'former-tech');
  assert.equal(claim.creatorIsShopMember, false, 'no longer a shop member');
  assert.equal(claim.creatorWasShopMember, true, 'stamped at creation');
  const r = founderClaimAllowed({ ...claim, orgType: 'customer', orgCreatedAt: fresh919, now: now919 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.match(r.error, /added by a service company/);
  }
});

test('000919: an unlinked, memberless customer org that a shop already served is not claimable', async () => {
  for (const table of ['service_reports', 'service_tickets'] as const) {
    const admin = fakeAdmin({
      organization_memberships: [],
      organization_customers: [],
      organizations: [{ id: 70, type: 'customer', creator_shop_org_id: null }],
      service_reports: table === 'service_reports' ? [{ id: 'r1', customer_organization_id: 70 }] : [],
      service_tickets: table === 'service_tickets' ? [{ id: 9, customer_organization_id: 70 }] : [],
    });
    const claim = await loadFounderClaimState(admin, 70, 'never-a-shop-user');
    assert.deepEqual(
      [claim.creatorIsShopMember, claim.creatorWasShopMember, claim.orgServed, claim.orgHasServiceLink],
      [false, false, true, false],
      table
    );
    const r = founderClaimAllowed({ ...claim, orgType: 'customer', orgCreatedAt: fresh919, now: now919 });
    assert.equal(r.ok, false, table);
    if (!r.ok) assert.match(r.error, /already serves this customer/);
  }
});

test('000919: a real clinic self-signup (never in a shop, never served) is still claimable', async () => {
  const admin = fakeAdmin({
    organization_memberships: [],
    organization_customers: [],
    organizations: [{ id: 60, type: 'laser_clinic', creator_shop_org_id: null }],
    service_reports: [{ id: 'other', customer_organization_id: 61 }],
    service_tickets: [],
  });
  const claim = await loadFounderClaimState(admin, 60, 'clinic-owner');
  assert.equal(founderClaimAllowed({ ...claim, orgType: 'laser_clinic', orgCreatedAt: fresh919, now: now919 }).ok, true);
  // A shop admin founding a second service company is unaffected by the stamp.
  assert.equal(
    founderClaimAllowed({ ...claim, creatorWasShopMember: true, orgServed: true, orgType: 'service_company', orgCreatedAt: fresh919, now: now919 }).ok,
    true
  );
});

test('000919: unreadable stamp or served state fails closed; a missing stamp column (000919 not applied) reads as false', async () => {
  const unreadable = fakeAdmin({
    organization_memberships: [], organization_customers: [],
    organizations: { error: 'permission denied' }, service_reports: [], service_tickets: [],
  });
  const a = await loadFounderClaimState(unreadable, 60, 'u');
  assert.equal(a.creatorWasShopMember, null);
  assert.equal(founderClaimAllowed({ ...a, orgType: 'customer', orgCreatedAt: fresh919, now: now919 }).ok, false);
  const noReports = fakeAdmin({
    organization_memberships: [], organization_customers: [],
    organizations: [], service_reports: { error: 'timeout' }, service_tickets: [],
  });
  const b = await loadFounderClaimState(noReports, 60, 'u');
  assert.equal(b.orgServed, null);
  assert.equal(founderClaimAllowed({ ...b, orgType: 'customer', orgCreatedAt: fresh919, now: now919 }).ok, false);
  const pre919 = fakeAdmin({
    organization_memberships: [], organization_customers: [],
    organizations: { error: 'column organizations.creator_shop_org_id does not exist' }, service_reports: [], service_tickets: [],
  });
  const c = await loadFounderClaimState(pre919, 60, 'u');
  assert.equal(c.creatorWasShopMember, false);
  assert.equal(founderClaimAllowed({ ...c, orgType: 'customer', orgCreatedAt: fresh919, now: now919 }).ok, true);
  // Omitted 000919 inputs on a customer org also fail closed.
  assert.equal(
    founderClaimAllowed({ callerIsMember: false, orgHasMembers: false, orgHasServiceLink: false, creatorIsShopMember: false, orgType: 'customer', orgCreatedAt: fresh919, now: now919 }).ok,
    false
  );
});
