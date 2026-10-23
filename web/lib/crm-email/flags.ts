/**
 * CRM Send email feature flags (server only). Everything is OFF until Larry sets env:
 *   CRM_EMAIL_ENABLED=true             master switch for /api/crm-email/* (send, connect)
 *   MAILBOX_TOKEN_KEY                  32-byte key (base64 or hex) for AES-256-GCM refresh tokens + state
 *   MAILBOX_MS_CLIENT_ID / MAILBOX_MS_CLIENT_SECRET   (optional MAILBOX_MS_TENANT, default "common")
 *   MAILBOX_GOOGLE_CLIENT_ID / MAILBOX_GOOGLE_CLIENT_SECRET
 *   RESEND_API_KEY (existing)          fallback transport
 *   CRM_EMAIL_FROM_ADDRESS (optional)  fallback From address on the verified Resend domain;
 *                                      defaults to the address in NOTIFY_FROM_EMAIL / RESEND_FROM.
 * A provider's Connect button shows only when its id + secret + MAILBOX_TOKEN_KEY are all set.
 */
import { parseTokenKey } from './token-crypto.ts';

export type MailboxProvider = 'microsoft' | 'google';
export const MAILBOX_PROVIDERS: readonly MailboxProvider[] = ['microsoft', 'google'];

type Env = Record<string, string | undefined>;

export function crmEmailEnabled(env: Env = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.CRM_EMAIL_ENABLED || '').trim());
}

export function mailboxTokenKey(env: Env = process.env): Buffer | null {
  return parseTokenKey(env.MAILBOX_TOKEN_KEY);
}

export function providerCredentials(
  provider: MailboxProvider,
  env: Env = process.env
): { clientId: string; clientSecret: string; tenant: string } | null {
  const id = String((provider === 'microsoft' ? env.MAILBOX_MS_CLIENT_ID : env.MAILBOX_GOOGLE_CLIENT_ID) || '').trim();
  const secret = String(
    (provider === 'microsoft' ? env.MAILBOX_MS_CLIENT_SECRET : env.MAILBOX_GOOGLE_CLIENT_SECRET) || ''
  ).trim();
  if (!id || !secret) return null;
  const tenant = String(env.MAILBOX_MS_TENANT || 'common').trim() || 'common';
  return { clientId: id, clientSecret: secret, tenant };
}

export function providerEnabled(provider: MailboxProvider, env: Env = process.env): boolean {
  return crmEmailEnabled(env) && Boolean(mailboxTokenKey(env)) && Boolean(providerCredentials(provider, env));
}

function addressOf(v: string | undefined): string {
  const s = String(v || '').trim();
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (m) return m[1];
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s) ? s : '';
}

/** Fallback From address on the verified Resend domain, or '' when not configured. */
export function fallbackFromAddress(env: Env = process.env): string {
  return addressOf(env.CRM_EMAIL_FROM_ADDRESS) || addressOf(env.NOTIFY_FROM_EMAIL) || addressOf(env.RESEND_FROM);
}

export function fallbackEnabled(env: Env = process.env): boolean {
  return crmEmailEnabled(env) && Boolean(String(env.RESEND_API_KEY || '').trim()) && Boolean(fallbackFromAddress(env));
}

/** Display name for the fallback: "<User name> via RepairPlanet". Strips characters that break a From header. */
export function fallbackFromHeader(userName: string, address: string): string {
  const name = String(userName || '').replace(/["<>\r\n\\]/g, '').trim().slice(0, 80) || 'A RepairPlanet user';
  return `"${name} via RepairPlanet" <${address}>`;
}

export const RATE_CAP_HOUR = 20;
export const RATE_CAP_DAY = 100;
