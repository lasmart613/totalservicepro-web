import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAIM_SIGNUP_METADATA_KEYS,
  claimSignupMetadataClearPatch,
  isClaimSignupWithoutToken,
  refuseClaimOrgAutoCreate,
} from './claim-signup-metadata.ts';
import { applyPendingSignup, pendingSignupFromMetadata as pendingFromMeta, resolvePendingSignup as resolvePending } from './pending-signup.ts';

const here = dirname(fileURLToPath(import.meta.url));

const leftoverClaim = {
  role: 'owner',
  company: 'QA TEST 238 Clinic 1026',
  facility: 'QA TEST 238 Clinic 1026',
  signup_kind: 'owner',
  facility_type: 'Clinic',
  organization_type: 'customer',
  preferred_services: '',
  first_name: 'QATEST238',
  last_name: 'ClinicD',
};

const normalOwner = {
  ...leftoverClaim,
  company: 'QA TEST clinic',
  facility: 'QA TEST clinic',
  claim_token: '',
};

const companyFounder = {
  signup_kind: 'company',
  role: 'company_admin',
  organization_type: 'service_company',
  company: 'QA TEST 245 Founder 1210',
  first_name: 'QA',
  last_name: 'Founder',
};

test('a failed claim patch nulls every signup field that rebuilds an org', () => {
  const patch = claimSignupMetadataClearPatch({
    ...leftoverClaim,
    claim_token: 'live-token',
    signup_type: 'claim',
  });
  assert.ok(patch);
  for (const key of CLAIM_SIGNUP_METADATA_KEYS) {
    assert.equal(patch[key], null, key);
  }
  assert.equal(claimSignupMetadataClearPatch(companyFounder), null);
  assert.equal(claimSignupMetadataClearPatch({ first_name: 'Ada' }), null);
});

test('leftover claim metadata with no token is not rebuilt; a company founder still is', () => {
  assert.equal(isClaimSignupWithoutToken(leftoverClaim), true);
  assert.equal(isClaimSignupWithoutToken({ ...leftoverClaim, claim_token: null }), true);
  assert.equal(isClaimSignupWithoutToken({ ...leftoverClaim, signup_type: 'claim', claim_token: '' }), true);
  assert.equal(isClaimSignupWithoutToken(normalOwner), false);
  assert.equal(isClaimSignupWithoutToken(companyFounder), false);
  assert.equal(isClaimSignupWithoutToken({ ...leftoverClaim, claim_token: 'still-set' }), false);

  const user = {
    email: 'fieldservicetotalservice+qa-238clinicd-1026@gmail.com',
    user_metadata: leftoverClaim,
  };
  assert.equal(pendingFromMeta(user), null);
  assert.equal(resolvePending(user), null);
  assert.equal(refuseClaimOrgAutoCreate({ kind: 'owner', extra: {} }, leftoverClaim), true);
  assert.equal(
    refuseClaimOrgAutoCreate({ kind: 'company', extra: {} }, leftoverClaim),
    true
  );

  const founder = pendingFromMeta({
    email: 'founder@shop.test',
    user_metadata: companyFounder,
  });
  assert.equal(founder?.kind, 'company');
  assert.equal(founder?.name, 'QA TEST 245 Founder 1210');
  assert.equal(founder?.orgType, 'service_company');
  assert.equal(refuseClaimOrgAutoCreate(founder, companyFounder), false);

  const owner = pendingFromMeta({
    email: 'owner@clinic.test',
    user_metadata: normalOwner,
  });
  assert.equal(owner?.kind, 'owner');
  assert.equal(refuseClaimOrgAutoCreate(owner, normalOwner), false);

  assert.equal(
    pendingFromMeta({
      email: 'claimer@clinic.test',
      user_metadata: { ...normalOwner, claim_token: 'live-token', signup_type: 'claim' },
    }),
    null
  );
  assert.equal(
    refuseClaimOrgAutoCreate(
      { kind: 'owner', extra: { claimToken: 'live-token' } },
      { ...normalOwner, claim_token: 'live-token' }
    ),
    true
  );
});

function fakeSupabase(user: { id: string; email: string; user_metadata: Record<string, unknown> }) {
  const api = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    ilike() {
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    maybeSingle: async () => ({ data: null, error: null }),
    insert() {
      return api;
    },
  };
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
      getSession: async () => ({ data: { session: { access_token: 'tok', user } } }),
    },
    from() {
      return api;
    },
  };
}

test('sign-in with leftover claim metadata creates no org; a company founder still does', async () => {
  const calls: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/api/team/claim')) {
      return new Response(JSON.stringify({ ok: true, claimed: false, pendingInvite: false }), { status: 200 });
    }
    if (url.includes('/api/org/founder')) {
      return new Response(JSON.stringify({ ok: true, organizationId: 2672 }), { status: 200 });
    }
    return new Response('missing', { status: 500 });
  };
  try {
    const claimUser = {
      id: '706c6bbf-db0d-4097-9428-94c04ca93c01',
      email: 'fieldservicetotalservice+qa-238clinicd-1026@gmail.com',
      user_metadata: leftoverClaim,
    };
    const blocked = await applyPendingSignup(fakeSupabase(claimUser) as never, claimUser.id, {
      kind: 'owner',
      name: 'QA TEST 238 Clinic 1026',
      firstName: 'QATEST238',
      lastName: 'ClinicD',
      email: claimUser.email,
      role: 'owner',
      orgType: 'customer',
      extra: { claimToken: null },
    });
    assert.equal(blocked.blockedClaim, true);
    assert.equal(blocked.orgId, null);
    assert.equal(blocked.dest, '/onboarding');
    assert.equal(calls.some((url) => url.includes('/api/org/founder')), false);

    calls.length = 0;
    const founderUser = {
      id: '145a7a3a-0917-4498-8dae-224645e11a49',
      email: 'founder@shop.test',
      user_metadata: companyFounder,
    };
    const created = await applyPendingSignup(fakeSupabase(founderUser) as never, founderUser.id, {
      kind: 'company',
      name: 'QA TEST 245 Founder 1210',
      firstName: 'QA',
      lastName: 'Founder',
      email: founderUser.email,
      role: 'company_admin',
      orgType: 'service_company',
    });
    assert.equal(created.blockedClaim, undefined);
    assert.equal(created.orgId, 2672);
    assert.equal(calls.some((url) => url.includes('/api/org/founder')), true);
  } finally {
    globalThis.fetch = previous;
  }
});

test('every rebuild path refuses a claim signup that has no token', () => {
  const pending = readFileSync(join(here, './pending-signup.ts'), 'utf8');
  assert.match(pending, /refuseClaimOrgAutoCreate/);
  assert.match(pending, /isClaimSignupWithoutToken/);
  assert.match(pending, /blockedClaim: true/);

  const founder = readFileSync(join(here, '../app/api/org/founder/route.ts'), 'utf8');
  assert.ok(founder.indexOf('refuseClaimOrgAutoCreate') < founder.indexOf('.insert(row)'));

  const home = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  assert.match(home, /resolvePendingSignup/);
  assert.match(home, /blockedClaim/);
  assert.match(home, /router\.replace\('\/onboarding'\)/);

  const lasers = readFileSync(join(here, '../app/my-lasers/page.tsx'), 'utf8');
  assert.match(lasers, /isClaimSignupWithoutToken/);
  assert.match(lasers, /router\.replace\('\/onboarding'\)/);
  assert.match(lasers, /blockedClaim/);

  const onboarding = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  assert.match(onboarding, /resolvePendingSignup/);
  assert.match(onboarding, /blockedClaim/);

  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  assert.match(callback, /resolvePendingSignup/);
  assert.match(callback, /blockedClaim/);
  assert.match(callback, /clearStaleClaimToken/);

  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  assert.match(login, /clearStaleClaimToken/);

  const owner = readFileSync(join(here, '../app/signup/owner/page.tsx'), 'utf8');
  assert.match(owner, /signup_type: 'claim'/);

  const find = readFileSync(
    join(here, '../supabase/oneoff/20261009_claim_signup_without_token_find.sql'),
    'utf8'
  );
  assert.match(find, /claim_token/);
  assert.doesNotMatch(find, /\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
});
