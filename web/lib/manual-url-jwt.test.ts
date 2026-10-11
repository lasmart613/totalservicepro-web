import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resetJwksCacheForTests,
  verifyAccessTokenLocally,
  type Jwk,
} from '../../supabase/functions/get-manual-url/jwt.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const URL_ = 'https://proj.supabase.co';
const NOW = 1_800_000_000_000;

function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function keypair(alg: 'ES256' | 'RS256', kid: string) {
  const params =
    alg === 'ES256'
      ? { name: 'ECDSA', namedCurve: 'P-256' }
      : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const pair = (await crypto.subtle.generateKey(params as any, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg, use: 'sig' } as Jwk;
  return { pair, jwk };
}

async function sign(alg: 'ES256' | 'RS256', key: CryptoKey, kid: string, claims: Record<string, unknown>) {
  const head = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const data = new TextEncoder().encode(`${head}.${body}`);
  const sig =
    alg === 'ES256'
      ? await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data)
      : await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const good = (over: Record<string, unknown> = {}) => ({
  sub: 'user-1',
  aud: 'authenticated',
  role: 'authenticated',
  iss: `${URL_}/auth/v1`,
  exp: NOW / 1000 + 3600,
  iat: NOW / 1000 - 10,
  ...over,
});

function jwksFetcher(keys: Jwk[]) {
  const calls: string[] = [];
  return {
    calls,
    fetchJwks: async (url: string) => {
      calls.push(url);
      return { keys };
    },
  };
}

test('ES256 token from the project key verifies locally; keys are cached', async () => {
  resetJwksCacheForTests();
  const { pair, jwk } = await keypair('ES256', 'k1');
  const f = jwksFetcher([jwk]);
  const token = await sign('ES256', pair.privateKey, 'k1', good());
  const a = await verifyAccessTokenLocally(token, URL_, { fetchJwks: f.fetchJwks, nowMs: NOW });
  assert.equal(a.kind, 'ok');
  assert.equal(a.kind === 'ok' && a.userId, 'user-1');
  const b = await verifyAccessTokenLocally(token, URL_ + '/', { fetchJwks: f.fetchJwks, nowMs: NOW + 1000 });
  assert.equal(b.kind, 'ok');
  assert.deepEqual(f.calls, [`${URL_}/auth/v1/.well-known/jwks.json`]);
});

test('RS256 also verifies', async () => {
  resetJwksCacheForTests();
  const { pair, jwk } = await keypair('RS256', 'r1');
  const f = jwksFetcher([jwk]);
  const token = await sign('RS256', pair.privateKey, 'r1', good());
  assert.equal((await verifyAccessTokenLocally(token, URL_, { fetchJwks: f.fetchJwks, nowMs: NOW })).kind, 'ok');
});

test('bad signature, expiry, audience, role and subject are rejected', async () => {
  resetJwksCacheForTests();
  const { pair, jwk } = await keypair('ES256', 'k1');
  const other = await keypair('ES256', 'k1');
  const f = jwksFetcher([jwk]);
  const opts = { fetchJwks: f.fetchJwks, nowMs: NOW };
  const forged = await sign('ES256', other.pair.privateKey, 'k1', good());
  assert.deepEqual(await verifyAccessTokenLocally(forged, URL_, opts), { kind: 'reject', reason: 'bad signature' });
  const expired = await sign('ES256', pair.privateKey, 'k1', good({ exp: NOW / 1000 - 120 }));
  assert.deepEqual(await verifyAccessTokenLocally(expired, URL_, opts), { kind: 'reject', reason: 'token expired' });
  const anonKey = await sign('ES256', pair.privateKey, 'k1', good({ role: 'anon', aud: 'authenticated' }));
  assert.equal((await verifyAccessTokenLocally(anonKey, URL_, opts)).kind, 'reject');
  const wrongAud = await sign('ES256', pair.privateKey, 'k1', good({ aud: 'other' }));
  assert.equal((await verifyAccessTokenLocally(wrongAud, URL_, opts)).kind, 'reject');
  const noSub = await sign('ES256', pair.privateKey, 'k1', good({ sub: '' }));
  assert.equal((await verifyAccessTokenLocally(noSub, URL_, opts)).kind, 'reject');
  // Tampered payload with the original signature.
  const ok = await sign('ES256', pair.privateKey, 'k1', good());
  const [h, , s] = ok.split('.');
  const tampered = `${h}.${b64url(JSON.stringify(good({ sub: 'someone-else' })))}.${s}`;
  assert.equal((await verifyAccessTokenLocally(tampered, URL_, opts)).kind, 'reject');
  assert.equal((await verifyAccessTokenLocally('not-a-jwt', URL_, opts)).kind, 'reject');
});

test('cases we cannot decide locally fall back to the network check', async () => {
  resetJwksCacheForTests();
  const { pair, jwk } = await keypair('ES256', 'k1');
  // Legacy HS256.
  const hs = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(good()))}.sig`;
  assert.equal((await verifyAccessTokenLocally(hs, URL_, jwksFetcher([jwk]))).kind, 'fallback');
  // JWKS unreachable.
  resetJwksCacheForTests();
  const token = await sign('ES256', pair.privateKey, 'k1', good());
  const down = await verifyAccessTokenLocally(token, URL_, {
    nowMs: NOW,
    fetchJwks: async () => {
      throw new Error('network');
    },
  });
  assert.deepEqual(down, { kind: 'fallback', reason: 'jwks unavailable' });
  // Unknown kid: one refetch, then fallback.
  resetJwksCacheForTests();
  const f = jwksFetcher([jwk]);
  const rotated = await sign('ES256', pair.privateKey, 'k2', good());
  assert.deepEqual(await verifyAccessTokenLocally(rotated, URL_, { fetchJwks: f.fetchJwks, nowMs: NOW }), {
    kind: 'fallback',
    reason: 'unknown kid',
  });
  assert.equal(f.calls.length, 2);
  // Other issuer (custom auth domain).
  resetJwksCacheForTests();
  const custom = await sign('ES256', pair.privateKey, 'k1', good({ iss: 'https://auth.example.com/auth/v1' }));
  assert.equal((await verifyAccessTokenLocally(custom, URL_, { ...jwksFetcher([jwk]), nowMs: NOW })).kind, 'fallback');
});

test('a key rotation is picked up by the unknown-kid refetch', async () => {
  resetJwksCacheForTests();
  const oldKey = await keypair('ES256', 'old');
  const newKey = await keypair('ES256', 'new');
  let keys: Jwk[] = [oldKey.jwk];
  const fetchJwks = async () => ({ keys });
  const t1 = await sign('ES256', oldKey.pair.privateKey, 'old', good());
  assert.equal((await verifyAccessTokenLocally(t1, URL_, { fetchJwks, nowMs: NOW })).kind, 'ok');
  keys = [oldKey.jwk, newKey.jwk];
  const t2 = await sign('ES256', newKey.pair.privateKey, 'new', good());
  assert.equal((await verifyAccessTokenLocally(t2, URL_, { fetchJwks, nowMs: NOW })).kind, 'ok');
});

test('get-manual-url verifies locally first and keeps access reads per request', () => {
  const src = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');
  const auth = src.slice(src.indexOf('async function authUser('), src.indexOf('type Owned = {'));
  const local = auth.indexOf('verifyAccessTokenLocally(token, supabaseUrl)');
  const network = auth.indexOf('auth.getUser(token)');
  assert.ok(local > 0 && network > local, 'local check runs before the network fallback');
  assert.match(auth, /local\.kind === "reject"\) \{\s*return \{ user: null/);
  // No per-user access cache: membership, profile and owned lists are read per request.
  assert.doesNotMatch(src, /new Map<string, \{[^}]*access/i);
  assert.match(src, /const access = await loadCallerAccess\(admin, user\.id\);/);
  assert.match(src, /let owned = await loadOwned\(admin, user\.id, orgId\);/);
});
