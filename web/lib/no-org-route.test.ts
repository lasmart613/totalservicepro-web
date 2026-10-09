import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callbackDest,
  claimSaysNoOrganization,
  homeDest,
  hubDest,
  loginDest,
  onboardingLeaveTarget,
  signInRedirects,
} from './no-org-route.ts';
import {
  clearTeamClaimDedupe,
  postTeamClaim,
  resetTeamClaimDedupeForSignIn,
  userIdFromAccessToken,
} from './invite-claim.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://totalservicepro.com';

const noOrg = { organization_id: null, active_organization_id: null, role: 'fse', onboarding_completed: false };
const noInvite = { ok: true, claimed: false, pendingInvite: false, status: 200 };
const failedClaim = { ok: false, claimed: false, pendingInvite: false, error: 'claim failed', status: 500 };
const joined = {
  ok: true,
  claimed: true,
  pendingInvite: true,
  inviteAccepted: true,
  organization_id: 4,
  role: 'fse',
  needsMemberOnboarding: true,
  status: 200,
};

function tokenFor(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub }), 'utf8').toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function installSessionStorage(): void {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
    setItem: (key: string, value: string) => {
      mem.set(key, String(value));
    },
    removeItem: (key: string) => {
      mem.delete(key);
    },
    clear: () => mem.clear(),
    key: (index: number) => [...mem.keys()][index] ?? null,
    get length() {
      return mem.size;
    },
  };
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
}

test('a no-org user reaches /onboarding in one navigation and stays there', () => {
  for (const start of ['/login', '/', '/hub', '/auth/callback'] as const) {
    const hops = signInRedirects({
      start,
      profile: noOrg,
      claim: noInvite,
      next: '/',
      origin: ORIGIN,
      isFounder: true,
    });
    assert.deepEqual(hops, ['/onboarding'], start);
  }
  assert.deepEqual(
    signInRedirects({ start: '/onboarding', profile: noOrg, claim: noInvite, origin: ORIGIN }),
    []
  );
  assert.equal(onboardingLeaveTarget({ profile: noOrg, claim: noInvite }), null);
  assert.equal(homeDest({ profile: noOrg, claim: noInvite }), '/onboarding');
  assert.equal(hubDest(noOrg), '/onboarding');
  assert.equal(loginDest(noInvite, '/', ORIGIN), '/onboarding');
  assert.equal(callbackDest({ profile: noOrg, claim: noInvite, next: '/', isFounder: true }), '/onboarding');
});

test('a pending invite claim that succeeds goes to the member destination once', () => {
  const hops = signInRedirects({
    start: '/login',
    profile: noOrg,
    claim: joined,
    next: '/',
    origin: ORIGIN,
  });
  assert.deepEqual(hops, ['/onboarding/member']);
  assert.equal(
    onboardingLeaveTarget({ profile: { ...noOrg, organization_id: 4 }, claim: joined }),
    '/onboarding/member'
  );
  const again = signInRedirects({
    start: '/onboarding/member',
    profile: { organization_id: 4, role: 'fse', onboarding_completed: false },
    claim: joined,
    origin: ORIGIN,
  });
  assert.deepEqual(again, []);
});

test('a failed claim does not bounce /onboarding back to /', () => {
  const fromHome = signInRedirects({
    start: '/',
    profile: noOrg,
    claim: failedClaim,
    origin: ORIGIN,
  });
  assert.deepEqual(fromHome, ['/onboarding']);
  const fromOnboarding = signInRedirects({
    start: '/onboarding',
    profile: noOrg,
    claim: failedClaim,
    orgType: 'service_company',
    origin: ORIGIN,
  });
  assert.deepEqual(fromOnboarding, []);
  assert.equal(onboardingLeaveTarget({ profile: noOrg, claim: failedClaim, orgType: 'service_company' }), null);
  assert.equal(claimSaysNoOrganization(failedClaim), false);
  assert.equal(loginDest(failedClaim, '/hub', ORIGIN), '/hub');
});

test('login and callback keep safeRedirectPath on next', () => {
  const withOrg = {
    ok: true,
    claimed: false,
    pendingInvite: false,
    organization_id: 12,
    role: 'company_admin',
    needsMemberOnboarding: false,
    status: 200,
  };
  assert.equal(loginDest(withOrg, 'https://evil.example/phish', ORIGIN), '/');
  assert.equal(loginDest(withOrg, '/\\evil.example', ORIGIN), '/');
  assert.equal(loginDest(noInvite, 'https://evil.example/phish', ORIGIN), '/onboarding');
  assert.equal(
    callbackDest({
      profile: { organization_id: 12, role: 'fse', onboarding_completed: true },
      claim: withOrg,
      next: '/company',
    }),
    '/company'
  );
  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  assert.match(callback, /safeRedirectPath/);
  assert.match(callback, /callbackDest/);
  assert.match(login, /safeRedirectPath/);
  assert.match(login, /loginDest/);
  const setPassword = readFileSync(join(here, '../app/auth/set-password/page.tsx'), 'utf8');
  assert.match(setPassword, /safeRedirectPath/);
});

test('an active org is not treated as no organization', () => {
  const activeOnly = { organization_id: null, active_organization_id: 9, role: 'fse', onboarding_completed: true };
  assert.equal(homeDest({ profile: activeOnly, claim: noInvite }), null);
  assert.equal(hubDest(activeOnly), null);
  assert.equal(onboardingLeaveTarget({ profile: activeOnly, claim: noInvite }), '/hub');
});

test('claim runs once per sign-in even when several callers mount', async () => {
  installSessionStorage();
  clearTeamClaimDedupe();
  const token = tokenFor('user-removed');
  assert.equal(userIdFromAccessToken(token), 'user-removed');

  let fetchCount = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    await gate;
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, claimed: false, pendingInvite: false }),
    };
  }) as typeof fetch;

  try {
    const pending = Promise.all([1, 2, 3, 4, 5].map(() => postTeamClaim(token, undefined, { userId: 'user-removed' })));
    assert.equal(fetchCount, 1);
    release();
    const results = await pending;
    assert.equal(results.length, 5);
    assert.equal(results.every((row) => row.claimed === false && row.pendingInvite === false), true);
    await postTeamClaim(token, undefined, { userId: 'user-removed' });
    assert.equal(fetchCount, 1);

    await postTeamClaim(token, { inviteId: 42 }, { userId: 'user-removed' });
    assert.equal(fetchCount, 2);

    resetTeamClaimDedupeForSignIn(token, 'user-removed');
    await postTeamClaim(token, undefined, { userId: 'user-removed' });
    assert.equal(fetchCount, 3);
  } finally {
    globalThis.fetch = previous;
    clearTeamClaimDedupe();
  }
});

test('a 503 team claim is not cached; the next call retries and an ok result is reused', async () => {
  installSessionStorage();
  clearTeamClaimDedupe();
  const token = tokenFor('user-retry');
  const storageKey = 'tsp-team-claim:user-retry:auto';
  let fetchCount = 0;
  let mode: 'fail' | 'ok' = 'fail';
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    if (mode === 'fail') {
      await gate;
      return {
        ok: false,
        status: 503,
        json: async () => ({ ok: false, error: 'unavailable' }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, claimed: false, pendingInvite: false }),
    };
  }) as typeof fetch;

  try {
    const pending = Promise.all([
      postTeamClaim(token, undefined, { userId: 'user-retry' }),
      postTeamClaim(token, undefined, { userId: 'user-retry' }),
    ]);
    assert.equal(fetchCount, 1);
    release();
    const failed = await pending;
    assert.equal(failed.length, 2);
    assert.equal(failed.every((row) => row.ok === false && row.status === 503), true);
    assert.equal(sessionStorage.getItem(storageKey), null);

    mode = 'ok';
    const retried = await postTeamClaim(token, undefined, { userId: 'user-retry' });
    assert.equal(retried.ok, true);
    assert.equal(retried.claimed, false);
    assert.equal(fetchCount, 2);
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null') as { ok?: boolean };
    assert.equal(stored.ok, true);

    const cached = await postTeamClaim(token, undefined, { userId: 'user-retry' });
    assert.equal(cached.ok, true);
    assert.equal(cached.claimed, false);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = previous;
    clearTeamClaimDedupe();
  }
});
