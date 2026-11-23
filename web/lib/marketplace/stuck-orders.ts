/**
 * God view and admin alert for marketplace orders that did not finish.
 * stock_pending is waiting on a claim. refund_review needs a person.
 * Buyers and sellers are never emailed. A sweep of orders older than N hours
 * is not built here: it would need a scheduled job.
 *
 * Durable dedupe is marketplace_order_alerts (000973, not applied with this
 * change). The claim is an insert of (order_id, status) on conflict do
 * nothing. Admins are emailed only when that insert created a row. A failed
 * send deletes the row so the next retry can alert again. The in-memory set
 * is only a fast path for this process.
 */

import { productIssuesFromAddress, productIssuesTeamRecipients } from '../product-issues.ts';
import { postResendEmail } from '../mail/outgoing-mail.ts';

export const STUCK_MARKETPLACE_ORDER_STATUSES = ['stock_pending', 'refund_review'] as const;
export type StuckMarketplaceOrderStatus = (typeof STUCK_MARKETPLACE_ORDER_STATUSES)[number];

export const DESTINATION_REFUND_NOTE =
  'Refunds on destination charges need a reverse transfer before the buyer is refunded. This list does not refund or reverse anything.';

export const STUCK_ORDER_LIST_LIMIT = 200;

/** Resend must not hold the Stripe webhook open. */
export const STUCK_ORDER_ALERT_TIMEOUT_MS = 3000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StuckOrderSource = {
  id?: unknown;
  listing_id?: unknown;
  seller_organization_id?: unknown;
  buyer_email?: unknown;
  amount_cents?: unknown;
  currency?: unknown;
  stripe_checkout_session_id?: unknown;
  stripe_payment_intent_id?: unknown;
  status?: unknown;
  payout_status?: unknown;
  quantity?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

export type StuckOrderOrg = { id?: unknown; name?: unknown };
export type StuckOrderListing = { id?: unknown; title?: unknown; part_number?: unknown };

export type StuckOrderListRow = {
  id: string;
  listingId: string;
  listingTitle: string;
  sellerOrganizationId: string;
  sellerOrganizationName: string;
  buyerEmail: string;
  amount: string;
  currency: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string;
  status: string;
  payoutStatus: string;
  quantity: string;
  createdAt: string;
  updatedAt: string;
  age: string;
};

const liveStuckOrderAlerts = new Set<string>();

export function clearStuckOrderAlertsForTests(): void {
  liveStuckOrderAlerts.clear();
}

/** In-memory key. A later status on the same order is a new alert. */
export function stuckOrderAlertKey(orderId: string, status: string): string {
  return `${String(orderId || '').trim()}:${String(status || '').trim()}`;
}

/** True the first time this order and status should email admins. */
export function claimStuckOrderAlert(
  orderId: string,
  status: string,
  seen: Set<string> = liveStuckOrderAlerts
): boolean {
  const id = String(orderId || '').trim();
  const state = String(status || '').trim();
  const key = stuckOrderAlertKey(id, state);
  if (!id || !state || seen.has(key)) return false;
  seen.add(key);
  return true;
}

export function releaseStuckOrderAlert(
  orderId: string,
  status: string,
  seen: Set<string> = liveStuckOrderAlerts
): void {
  seen.delete(stuckOrderAlertKey(orderId, status));
}

export function isStuckMarketplaceOrderStatus(status: unknown): status is StuckMarketplaceOrderStatus {
  return STUCK_MARKETPLACE_ORDER_STATUSES.includes(String(status || '') as StuckMarketplaceOrderStatus);
}

export function stuckOrderAgeLabel(fromIso: unknown, now = Date.now()): string {
  const at = Date.parse(String(fromIso || ''));
  if (!Number.isFinite(at)) return '—';
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function stuckOrderAmount(cents: unknown, currency: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '—';
  const code = String(currency || 'usd').trim().toUpperCase() || 'USD';
  return `${(n / 100).toFixed(2)} ${code}`;
}

function text(value: unknown): string {
  const out = String(value ?? '').trim();
  return out || '—';
}

export function marketplaceOrdersAuthStatus(input: { ok: boolean; httpStatus?: number }): 200 | 401 | 403 | 500 {
  if (input.ok) return 200;
  if (input.httpStatus === 401) return 401;
  if (input.httpStatus === 500) return 500;
  return 403;
}

export function assembleStuckOrders(input: {
  orders: StuckOrderSource[];
  organizations?: StuckOrderOrg[];
  listings?: StuckOrderListing[];
  now?: number;
}): StuckOrderListRow[] {
  const now = input.now ?? Date.now();
  const orgs = new Map(
    (input.organizations || []).map((org) => [String(org.id ?? ''), String(org.name || '').trim()])
  );
  const listings = new Map(
    (input.listings || []).map((listing) => [
      String(listing.id ?? ''),
      [listing.part_number, listing.title].map((part) => String(part || '').trim()).filter(Boolean).join(' · '),
    ])
  );
  return input.orders
    .filter((order) => isStuckMarketplaceOrderStatus(order.status))
    .map((order) => {
      const sellerId = text(order.seller_organization_id);
      const listingId = text(order.listing_id);
      const updatedAt = text(order.updated_at);
      const createdAt = text(order.created_at);
      const ageFrom = updatedAt !== '—' ? updatedAt : createdAt !== '—' ? createdAt : '';
      return {
        id: text(order.id),
        listingId,
        listingTitle: listings.get(listingId) || '—',
        sellerOrganizationId: sellerId,
        sellerOrganizationName: (sellerId !== '—' && orgs.get(sellerId)) || '—',
        buyerEmail: text(order.buyer_email),
        amount: stuckOrderAmount(order.amount_cents, order.currency),
        currency: String(order.currency || 'usd').trim().toLowerCase() || 'usd',
        stripeCheckoutSessionId: text(order.stripe_checkout_session_id),
        stripePaymentIntentId: text(order.stripe_payment_intent_id),
        status: String(order.status),
        payoutStatus: text(order.payout_status),
        quantity: text(order.quantity),
        createdAt,
        updatedAt,
        age: stuckOrderAgeLabel(ageFrom, now),
      };
    });
}

/** Admin inboxes only. A buyer or seller address is removed if it collides with the team list. */
export function stuckOrderAlertRecipients(blocked: Array<string | null | undefined> = []): string[] {
  const skip = new Set(
    blocked
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => EMAIL_RE.test(value))
  );
  return productIssuesTeamRecipients().filter((email) => !skip.has(email.toLowerCase()));
}

export function stuckOrderAlertSubject(orderId: string, status: StuckMarketplaceOrderStatus): string {
  return `Marketplace order ${status}: ${orderId}`;
}

export function stuckOrderAlertText(input: {
  orderId: string;
  listingId: string;
  status: StuckMarketplaceOrderStatus;
  sessionId?: string | null;
  buyerEmail?: string | null;
  sellerOrganizationId?: string | null;
  payoutStatus?: string | null;
  amountCents?: number | null;
  currency?: string | null;
}): string {
  return [
    'A marketplace parts order needs an admin. Buyers and sellers were not emailed.',
    '',
    `Order: ${input.orderId}`,
    `Status: ${input.status}`,
    `Listing: ${input.listingId}`,
    `Seller organization: ${input.sellerOrganizationId || '—'}`,
    `Buyer email (not a recipient): ${input.buyerEmail || '—'}`,
    `Amount: ${stuckOrderAmount(input.amountCents, input.currency)}`,
    `Payout: ${input.payoutStatus || '—'}`,
    `Checkout session: ${input.sessionId || '—'}`,
    '',
    DESTINATION_REFUND_NOTE,
  ].join('\n');
}

/**
 * Durable claim. `claim` is insert ... on conflict do nothing and is true
 * only when a row was inserted. `release` deletes that row.
 */
export type StuckOrderAlertLedger = {
  claim(orderId: string, status: string): Promise<boolean>;
  release(orderId: string, status: string): Promise<void>;
};

export type StuckOrderAlertInput = {
  orderId: string;
  listingId: string;
  status: StuckMarketplaceOrderStatus;
  sessionId?: string | null;
  buyerEmail?: string | null;
  sellerOrganizationId?: string | null;
  payoutStatus?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  seen?: Set<string>;
  /** Shared across instances. Omit for the in-memory fast path only. */
  ledger?: StuckOrderAlertLedger;
  /** Test override. Production uses STUCK_ORDER_ALERT_TIMEOUT_MS. */
  timeoutMs?: number;
  send?: (message: { to: string[]; subject: string; text: string }, signal: AbortSignal) => Promise<void>;
};

async function sendAlert(
  ms: number,
  work: (signal: AbortSignal) => Promise<void>
): Promise<void> {
  const signal = AbortSignal.timeout(ms);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('alert send timed out'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  const pending = work(signal);
  pending.catch(() => {});
  try {
    await Promise.race([pending, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function releaseAlertClaim(
  orderId: string,
  status: string,
  seen: Set<string>,
  ledger: StuckOrderAlertLedger | undefined,
  held: boolean
): Promise<void> {
  releaseStuckOrderAlert(orderId, status, seen);
  if (!held || !ledger) return;
  await ledger.release(orderId, status);
}

export async function notifyStuckMarketplaceOrder(
  input: StuckOrderAlertInput
): Promise<{ sent: boolean; reason: 'sent' | 'duplicate' | 'no_recipient' | 'error' }> {
  const seen = input.seen ?? liveStuckOrderAlerts;
  const to = stuckOrderAlertRecipients([input.buyerEmail]);
  if (!to.length) return { sent: false, reason: 'no_recipient' };
  if (!input.send && !String(process.env.RESEND_API_KEY || '').trim()) {
    return { sent: false, reason: 'error' };
  }
  if (seen.has(stuckOrderAlertKey(input.orderId, input.status))) {
    return { sent: false, reason: 'duplicate' };
  }

  let held = false;
  let remembered = false;
  try {
    if (input.ledger) {
      const inserted = await input.ledger.claim(input.orderId, input.status);
      if (!inserted) return { sent: false, reason: 'duplicate' };
      held = true;
    }
    remembered = claimStuckOrderAlert(input.orderId, input.status, seen);
    if (!remembered) {
      if (held && input.ledger) await input.ledger.release(input.orderId, input.status);
      return { sent: false, reason: 'duplicate' };
    }
  } catch {
    if (remembered) releaseStuckOrderAlert(input.orderId, input.status, seen);
    if (held && input.ledger) {
      await input.ledger.release(input.orderId, input.status).catch(() => {});
    }
    return { sent: false, reason: 'error' };
  }

  const subject = stuckOrderAlertSubject(input.orderId, input.status);
  const text = stuckOrderAlertText(input);
  const timeoutMs = input.timeoutMs ?? STUCK_ORDER_ALERT_TIMEOUT_MS;
  try {
    if (input.send) {
      const send = input.send;
      await sendAlert(timeoutMs, (signal) => send({ to, subject, text }, signal));
    } else {
      const apiKey = String(process.env.RESEND_API_KEY || '').trim();
      await sendAlert(timeoutMs, async (signal) => {
        const res = await postResendEmail({
          apiKey,
          signal,
          message: {
            from: productIssuesFromAddress(),
            to,
            subject,
            text,
          },
        });
        if (!res.ok) throw new Error('alert send failed');
      });
    }
    return { sent: true, reason: 'sent' };
  } catch {
    await releaseAlertClaim(input.orderId, input.status, seen, input.ledger, held).catch(() => {});
    return { sent: false, reason: 'error' };
  }
}
