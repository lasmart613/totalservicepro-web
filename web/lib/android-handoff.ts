/**
 * Server-issued tsp_nonce for the official Android app.
 *
 * The app asks GET /api/auth/android-nonce for a nonce and an HMAC proof.
 * It stores the nonce, then opens a Custom Tab on GET /api/auth/android-bind.
 * Bind checks the proof and sets an httpOnly cookie on this browser, which is
 * the auth session. POST /api/auth/android-handoff returns ok only when the
 * callback's tsp_nonce matches that cookie. The page then builds an intent
 * pinned to package com.photometrytools. A nonce the server did not issue, or
 * one issued for a different browser, does not match, so no session tokens
 * are placed on a handoff URL. A bare totalservicepro:// URL is never used.
 *
 * ANDROID_HANDOFF_SECRET signs the proof. The service role key is the fallback
 * so production can issue nonces before a dedicated secret is set. The app
 * never sees the secret.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TSP_APP_NONCE_RE } from './android-session.ts';

export const ANDROID_NONCE_COOKIE = 'tsp_android_nonce';
/** Same five minutes as AuthHandoff.TTL_MS. */
export const ANDROID_NONCE_TTL_SEC = 5 * 60;
export const SUPABASE_AUTH_HOST = 'yljztfajyvjzqikxdddf.supabase.co';

const PROOF_RE = /^[0-9a-f]{64}$/;

export function androidHandoffSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const dedicated = String(env.ANDROID_HANDOFF_SECRET || '').trim();
  if (dedicated) return dedicated;
  const service = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return service || null;
}

export function issueAndroidNonce(
  secret: string,
  nowMs: number = Date.now()
): { nonce: string; proof: string; exp: number } {
  const nonce = randomBytes(16).toString('hex');
  const exp = Math.floor(nowMs / 1000) + ANDROID_NONCE_TTL_SEC;
  return { nonce, proof: signAndroidNonce(secret, nonce, exp), exp };
}

export function signAndroidNonce(secret: string, nonce: string, exp: number): string {
  return createHmac('sha256', secret).update(`${nonce}.${exp}`).digest('hex');
}

export function verifyAndroidNonceProof(
  secret: string,
  nonce: string,
  proof: string,
  exp: number,
  nowMs: number = Date.now()
): boolean {
  if (!TSP_APP_NONCE_RE.test(nonce) || !PROOF_RE.test(proof)) return false;
  if (!Number.isFinite(exp)) return false;
  const now = Math.floor(nowMs / 1000);
  if (exp < now - 5 || exp > now + ANDROID_NONCE_TTL_SEC + 5) return false;
  return safeEqual(signAndroidNonce(secret, nonce, exp), proof);
}

/** Cookie value from bind, compared with the nonce on the callback URL. */
export function androidNonceMatchesSession(
  cookieNonce: string | null | undefined,
  presented: string | null | undefined
): boolean {
  const cookie = String(cookieNonce || '');
  const nonce = String(presented || '');
  if (!TSP_APP_NONCE_RE.test(cookie) || !TSP_APP_NONCE_RE.test(nonce)) return false;
  return safeEqual(cookie, nonce);
}

export function supabaseAuthHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>([SUPABASE_AUTH_HOST]);
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
    const raw = String(env[key] || '').trim();
    if (!raw) continue;
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host) hosts.add(host);
    } catch {
      /* ignore a bad env URL */
    }
  }
  return hosts;
}

/**
 * Authorize URL the Custom Tab may continue to, with tsp_nonce stamped on
 * our auth callback. Google hosts are returned unchanged (no redirect_to to
 * rewrite). Anything else is rejected.
 */
export function stampNonceOnAuthorizeUrl(
  authorizeUrl: string,
  nonce: string,
  hosts: Set<string>
): string | null {
  if (!TSP_APP_NONCE_RE.test(nonce)) return null;
  let url: URL;
  try {
    url = new URL(authorizeUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'accounts.google.com' || host === 'accounts.youtube.com') return url.toString();
  if (!hosts.has(host) || !url.pathname.startsWith('/auth/v1/authorize')) return null;
  const redirect = url.searchParams.get('redirect_to');
  if (!redirect) return null;
  const stamped = stampAppCallback(redirect, nonce);
  if (!stamped) return null;
  url.searchParams.set('redirect_to', stamped);
  return url.toString();
}

function stampAppCallback(redirect: string, nonce: string): string | null {
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'repairplanet.net' && host !== 'www.repairplanet.net') return null;
  const path = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  if (path !== '/auth/callback') return null;
  const next = new URLSearchParams();
  next.set('app', '1');
  next.set('tsp_nonce', nonce);
  url.searchParams.forEach((value, key) => {
    if (key === 'app' || key === 'tsp_nonce') return;
    next.append(key, value);
  });
  return `https://repairplanet.net/auth/callback?${next.toString()}${url.hash}`;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
