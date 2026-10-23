/**
 * AES-256-GCM for mailbox OAuth refresh tokens (000940).
 * Key: MAILBOX_TOKEN_KEY, 32 bytes as base64 or 64 hex chars (Netlify env, server only).
 * Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>. The database CHECK requires the v1. prefix.
 * Server-only. Never import from a client component.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function parseTokenKey(raw: string | undefined | null): Buffer | null {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  try {
    const b = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

export function encryptToken(plain: string, key: Buffer, aad = 'mailbox'): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
}

export function decryptToken(enc: string, key: Buffer, aad = 'mailbox'): string {
  const parts = String(enc || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('bad token format');
  const d = createDecipheriv('aes-256-gcm', key, fromB64u(parts[1]));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(fromB64u(parts[2]));
  return Buffer.concat([d.update(fromB64u(parts[3])), d.final()]).toString('utf8');
}

/** HMAC-signed OAuth state: payload.b64url + "." + sig. Separate subkey from the encryption key. */
function stateKey(key: Buffer): Buffer {
  return createHmac('sha256', key).update('crm-email-oauth-state').digest();
}

export function signState(payload: Record<string, unknown>, key: Buffer): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(createHmac('sha256', stateKey(key)).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState<T = Record<string, unknown>>(state: string, key: Buffer, now = Date.now()): T | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', stateKey(key)).update(body).digest();
  const got = fromB64u(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(fromB64u(body).toString('utf8')) as T & { exp?: number };
    if (typeof p.exp !== 'number' || p.exp < now) return null;
    return p;
  } catch {
    return null;
  }
}
