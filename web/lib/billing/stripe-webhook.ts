/**
 * Stripe webhook signature check (no SDK). Uses the raw body + Stripe-Signature.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const STRIPE_WEBHOOK_SECRET_ENV = 'STRIPE_WEBHOOK_SECRET';

export function getStripeWebhookSecret(): string | null {
  const value = String(process.env[STRIPE_WEBHOOK_SECRET_ENV] ?? '').trim();
  return value || null;
}

export function parseStripeSignatureHeader(header: string): { timestamp: string; signatures: string[] } | null {
  const parts = String(header || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed || !secret) return false;
  const ts = Number(parsed.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;

  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return parsed.signatures.some((sig) => {
    const got = Buffer.from(sig, 'utf8');
    return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf);
  });
}

export type StripeWebhookEventLike = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> | null };
};

export function stripeWebhookObject(
  event: StripeWebhookEventLike | null | undefined
): Record<string, unknown> | null {
  const obj = event?.data?.object;
  return obj && typeof obj === 'object' ? obj : null;
}

export function isCheckoutSessionCompleted(type: string | null | undefined): boolean {
  return type === 'checkout.session.completed';
}

export function isSubscriptionLifecycle(type: string | null | undefined): boolean {
  return type === 'customer.subscription.created' || type === 'customer.subscription.updated';
}
