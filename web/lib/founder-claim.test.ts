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
  });
  assert.deepEqual(await loadFounderClaimState(admin, 21, 'removed-tech'), {
    callerIsMember: false, orgHasMembers: false, orgHasServiceLink: true,
  });
  assert.deepEqual(await loadFounderClaimState(admin, 7, 'boss'), {
    callerIsMember: true, orgHasMembers: true, orgHasServiceLink: false,
  });
  const broken = fakeAdmin({ organization_memberships: { error: 'boom' }, organization_customers: [] });
  assert.deepEqual(await loadFounderClaimState(broken, 7, 'boss'), {
    callerIsMember: null, orgHasMembers: null, orgHasServiceLink: false,
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
