import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { orgSeatLimit, seatAddBlocked, seatLimitMessage, SOLO_SEAT_LIMIT, TEAM_SEAT_LIMIT } from './org-plan.ts';
import { orgSeatCheck, upsertMembership } from './org-membership-server.ts';
import {
  FREE_LISTING_PHOTO_LIMIT,
  PAID_LISTING_PHOTO_LIMIT,
  listingPhotoCount,
  listingPhotoLimit,
  listingPhotoLimitError,
} from './marketplace/storefront.ts';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ---------- seats ----------
function fakeAdmin(org: Record<string, unknown> | null, members: string[], inserts: unknown[] = []) {
  return {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === 'organizations' ? org : null, error: null }),
        insert: async (row: unknown) => {
          inserts.push(row);
          return { error: null };
        },
        delete: () => {
          throw new Error('seat code must never delete');
        },
        then: (resolve: any) =>
          resolve({ data: table === 'organization_memberships' ? members.map((user_id) => ({ user_id })) : [], error: null }),
      };
      return q;
    },
    async rpc() {
      return { error: null };
    },
  } as any;
}

test('seat limits: Free and Premium 1, Team 10', () => {
  assert.equal(SOLO_SEAT_LIMIT, 1);
  assert.equal(TEAM_SEAT_LIMIT, 10);
  assert.equal(orgSeatLimit(null), 1);
  assert.equal(orgSeatLimit({ is_premium: false, subscription_tier: 'free' }), 1);
  assert.equal(orgSeatLimit({ is_premium: true, subscription_tier: 'premium' }), 1);
  assert.equal(orgSeatLimit({ is_premium: true, subscription_tier: 'team' }), 10);
  assert.equal(orgSeatLimit({ is_premium: false, subscription_tier: 'team', premium_until: '2020-01-01T00:00:00Z', premium_grant: 'complimentary_signup' }), 1);
  assert.equal(seatAddBlocked(1, 1), true);
  assert.equal(seatAddBlocked(9, 10), false);
  assert.match(seatLimitMessage(3, 1), /3 of 1 seat .*upgrade to Team/);
});

test('seat check: full org blocks a new member, existing member passes', async () => {
  const free = { is_premium: false, subscription_tier: 'free' };
  const blocked = await orgSeatCheck(fakeAdmin(free, ['a']), 1, 'new');
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 403);
  assert.equal((await orgSeatCheck(fakeAdmin(free, ['a']), 1, 'a')).ok, true);
  assert.equal((await orgSeatCheck(fakeAdmin(free, []), 1, 'first')).ok, true);
  const team = { is_premium: true, subscription_tier: 'team' };
  assert.equal((await orgSeatCheck(fakeAdmin(team, ['a', 'b', 'c']), 1, 'd')).ok, true);
});

test('over-cap org keeps members and only loses new adds; nothing is removed', async () => {
  const members = ['a', 'b', 'c']; // e.g. was Team, now Premium (1 seat)
  const inserts: unknown[] = [];
  const admin = fakeAdmin({ is_premium: true, subscription_tier: 'premium' }, members, inserts);
  const add = await upsertMembership(admin, { userId: 'd', organizationId: 1, role: 'fse' });
  assert.equal(add.ok, false);
  assert.equal(add.seatLimited, true);
  assert.equal(inserts.length, 0);
  assert.deepEqual(members, ['a', 'b', 'c']);
  for (const rel of ['../lib/billing/apply-org-downgrade.ts', '../lib/billing/upgrade-session.ts', '../app/api/billing/upgrade/webhook/route.ts']) {
    assert.doesNotMatch(src(rel), /from\('organization_memberships'\)\s*\.delete|deleteMembership\(/, `${rel} must not remove members`);
  }
});

test('seat cap is enforced on invites, claims and membership adds', () => {
  const invite = src('../app/api/team/invite/route.ts');
  assert.match(invite, /\(deps\.seatCheck \?\? orgSeatCheck\)\(admin, orgId/);
  assert.match(invite, /seat_limited/);
  const claim = src('../app/api/team/claim/route.ts');
  assert.match(claim, /orgSeatCheck\(admin, decision\.add\.organizationId, user\.id\)/);
  const server = src('./org-membership-server.ts');
  assert.match(server, /const seats = await orgSeatCheck\(admin, input\.inviteOrgId, input\.userId\)/);
  assert.match(server, /const seats = await orgSeatCheck\(admin, input\.organizationId, input\.userId\)/);
  for (const page of ['../app/company/page.tsx', '../app/admin/team/page.tsx']) {
    assert.match(src(page), /<SeatLimitNudge used=\{/, `${page} shows the seat nudge`);
  }
  assert.match(src('../components/SeatLimitNudge.tsx'), /data-testid="seat-limit-nudge"/);
});

// ---------- listing photos ----------
test('listing photos: Free 1, paid 8, counted and enforced', () => {
  assert.equal(FREE_LISTING_PHOTO_LIMIT, 1);
  assert.equal(PAID_LISTING_PHOTO_LIMIT, 8);
  assert.equal(listingPhotoLimit({ is_premium: false }), 1);
  assert.equal(listingPhotoLimit({ is_premium: true, subscription_tier: 'premium' }), 8);
  assert.equal(listingPhotoCount({ images: ['a', 'b'], photos: ['a'] }), 2);
  assert.equal(listingPhotoCount({ images: ['', null] }), 0);
  assert.equal(listingPhotoLimitError(1, 1), null);
  assert.match(String(listingPhotoLimitError(2, 1)), /Free plan listings can have 1 photo/);
  assert.equal(listingPhotoLimitError(8, 8), null);
  assert.ok(listingPhotoLimitError(9, 8));
});

test('listing page uses the tier limit; PATCH and DB trigger enforce it', () => {
  const page = src('../app/marketplace/list/page.tsx');
  assert.match(page, /setPhotoLimit\(listingPhotoLimit\(org\)\)/);
  assert.match(page, /images\.length < photoLimit/);
  assert.doesNotMatch(page, /8 - images\.length|images\.length < 8/);
  const patch = src('../app/api/marketplace/parts/[id]/route.ts');
  assert.match(patch, /listingPhotoLimitError\(/);
  const mig = src('../supabase/migrations/20261029_000947_listing_photo_tier_limit.sql');
  assert.match(mig, /BEFORE INSERT OR UPDATE ON public\.marketplace_listings/);
  assert.match(mig, /org_is_paid_entitled/);
  assert.match(mig, /IF v_new <= v_old THEN/);
  assert.doesNotMatch(mig, /\bDELETE\b|\bUPDATE public\./i);
});

// ---------- branding ----------
test('branding: Free orgs cannot save custom colors; save shows a lock', () => {
  const route = src('../app/api/org/profile/route.ts');
  assert.match(route, /branding_locked: true/);
  assert.doesNotMatch(route, /delete payload\.brand_primary_color/);
  const company = src('../app/company/page.tsx');
  assert.match(company, /data-testid="branding-save-locked"/);
  const mig = src('../supabase/migrations/20261029_000948_org_branding_paid_only.sql');
  assert.match(mig, /BEFORE UPDATE OF brand_primary_color, brand_accent_color ON public\.organizations/);
  assert.match(mig, /org_is_paid_entitled\(NEW\.id::bigint\)/);
});
