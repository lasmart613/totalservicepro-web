import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET as issueNonce } from '../app/api/auth/android-nonce/route.ts';
import { GET as bindNonce } from '../app/api/auth/android-bind/route.ts';
import { POST as confirmHandoff } from '../app/api/auth/android-handoff/route.ts';
import {
  ANDROID_NONCE_COOKIE,
  ANDROID_NONCE_TTL_SEC,
  androidNonceMatchesSession,
  issueAndroidNonce,
  stampNonceOnAuthorizeUrl,
  supabaseAuthHosts,
  verifyAndroidNonceProof,
} from './android-handoff.ts';
import { TSP_APP_NONCE_RE } from './android-session.ts';

const SECRET = 'android-handoff-test-secret';
const NONCE = '0123456789abcdef0123456789abcdef';
const NOW = Date.parse('2026-11-05T16:00:00.000Z');
const AUTHORIZE =
  'https://yljztfajyvjzqikxdddf.supabase.co/auth/v1/authorize' +
  '?provider=google&redirect_to=' +
  encodeURIComponent('https://www.repairplanet.net/auth/callback?next=/') +
  '&state=abc';

function withSecret<T>(run: () => Promise<T> | T): Promise<T> {
  const previous = process.env.ANDROID_HANDOFF_SECRET;
  process.env.ANDROID_HANDOFF_SECRET = SECRET;
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete process.env.ANDROID_HANDOFF_SECRET;
    else process.env.ANDROID_HANDOFF_SECRET = previous;
  });
}

test('a proof verifies only the nonce and expiry the server signed', () => {
  const issued = issueAndroidNonce(SECRET, NOW);
  assert.equal(TSP_APP_NONCE_RE.test(issued.nonce), true);
  assert.equal(verifyAndroidNonceProof(SECRET, issued.nonce, issued.proof, issued.exp, NOW), true);
  assert.equal(verifyAndroidNonceProof('other-secret', issued.nonce, issued.proof, issued.exp, NOW), false);
  assert.equal(verifyAndroidNonceProof(SECRET, NONCE, issued.proof, issued.exp, NOW), false);
  assert.equal(
    verifyAndroidNonceProof(SECRET, issued.nonce, issued.proof, issued.exp, NOW + (ANDROID_NONCE_TTL_SEC + 30) * 1000),
    false
  );
  assert.equal(androidNonceMatchesSession(issued.nonce, issued.nonce), true);
  assert.equal(androidNonceMatchesSession(issued.nonce, NONCE), false);
  assert.equal(androidNonceMatchesSession(undefined, issued.nonce), false);
});

test('bind stamps our callback and rejects a foreign continue URL', () => {
  const hosts = supabaseAuthHosts({ NEXT_PUBLIC_SUPABASE_URL: 'https://yljztfajyvjzqikxdddf.supabase.co' });
  const stamped = stampNonceOnAuthorizeUrl(AUTHORIZE, NONCE, hosts);
  assert.ok(stamped);
  const redirect = new URL(stamped!).searchParams.get('redirect_to') || '';
  assert.equal(
    redirect,
    `https://repairplanet.net/auth/callback?app=1&tsp_nonce=${NONCE}&next=%2F`
  );
  assert.match(stamped!, /state=abc/);
  assert.equal(stampNonceOnAuthorizeUrl('https://evil.example/auth/v1/authorize?redirect_to=https://repairplanet.net/auth/callback', NONCE, hosts), null);
  assert.equal(
    stampNonceOnAuthorizeUrl(
      'https://yljztfajyvjzqikxdddf.supabase.co/auth/v1/authorize?redirect_to=' +
        encodeURIComponent('https://evil.example/auth/callback'),
      NONCE,
      hosts
    ),
    null
  );
  assert.equal(stampNonceOnAuthorizeUrl('https://accounts.google.com.evil.com/o/oauth2', NONCE, hosts), null);
  const google = stampNonceOnAuthorizeUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', NONCE, hosts);
  assert.match(google || '', /^https:\/\/accounts\.google\.com\/o\/oauth2/);
});

test('issue, bind, and handoff accept only the nonce stored for this browser', async () => {
  await withSecret(async () => {
    const issuedRes = await issueNonce();
    assert.equal(issuedRes.status, 200);
    const issued = (await issuedRes.json()) as { nonce: string; proof: string; exp: number };
    assert.equal(verifyAndroidNonceProof(SECRET, issued.nonce, issued.proof, issued.exp), true);

    const bindUrl =
      'https://repairplanet.net/api/auth/android-bind?nonce=' +
      `${issued.nonce}&proof=${issued.proof}&exp=${issued.exp}&continue_url=${encodeURIComponent(AUTHORIZE)}`;
    const bound = await bindNonce(new NextRequest(bindUrl));
    assert.equal(bound.status, 302);
    const location = bound.headers.get('location') || '';
    assert.match(location, /yljztfajyvjzqikxdddf\.supabase\.co\/auth\/v1\/authorize/);
    assert.match(decodeURIComponent(location), new RegExp(`tsp_nonce=${issued.nonce}`));
    const cookie = bound.cookies.get(ANDROID_NONCE_COOKIE);
    assert.equal(cookie?.value, issued.nonce);
    assert.equal(cookie?.httpOnly, true);

    const foreign = await confirmHandoff(
      new NextRequest('https://repairplanet.net/api/auth/android-handoff', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${ANDROID_NONCE_COOKIE}=${issued.nonce}`,
        },
        body: JSON.stringify({ nonce: NONCE }),
      })
    );
    assert.equal(foreign.status, 200);
    assert.equal(((await foreign.json()) as { ok?: boolean }).ok, false);
    assert.equal(foreign.cookies.get(ANDROID_NONCE_COOKIE), undefined);

    const unissued = await confirmHandoff(
      new NextRequest('https://repairplanet.net/api/auth/android-handoff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonce: issued.nonce }),
      })
    );
    assert.equal(((await unissued.json()) as { ok?: boolean }).ok, false);

    const matched = await confirmHandoff(
      new NextRequest('https://repairplanet.net/api/auth/android-handoff', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${ANDROID_NONCE_COOKIE}=${issued.nonce}`,
        },
        body: JSON.stringify({ nonce: issued.nonce }),
      })
    );
    assert.equal(((await matched.json()) as { ok?: boolean }).ok, true);
    assert.equal(matched.cookies.get(ANDROID_NONCE_COOKIE)?.value, '');

    const badProof = await bindNonce(
      new NextRequest(
        `https://repairplanet.net/api/auth/android-bind?nonce=${NONCE}&proof=${'ab'.repeat(32)}&exp=${issued.exp}&continue_url=${encodeURIComponent(AUTHORIZE)}`
      )
    );
    assert.equal(badProof.status, 400);
    assert.equal(badProof.cookies.get(ANDROID_NONCE_COOKIE), undefined);
  });
});
