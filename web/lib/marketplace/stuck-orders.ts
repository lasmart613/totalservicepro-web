/**
 * God view and admin alert for marketplace orders that did not finish.
 * stock_pending is waiting on a claim. refund_review needs a person.
 * Buyers and sellers are never emailed. A sweep of orders older than N hours
 * is not built here: it would need a scheduled job.
 *
 * Durable dedupe is marketplace_order_alerts (000973, not applied with this
 * change). The claim is an insert of (order_id, status) on conflict do
 * nothing. Admins are emailed only when that insert created a row. A failed
 * send deletes the row so the next retry can alert again. An unsent row
 * older than an hour can be claimed again. If the ledger errors, this
 * process still sends once from the in-memory set. That set is otherwise
 * only a fast path.
 */

import { productIssuesFromAddress, productIssuesTeamRecipients } from '../product-issues.ts';
import { postResendEmail } from '../mail/outgoing-mail.ts';

export const STUCK_MARKETPLACE_ORDER_STATUSES = ['stock_pending', 'refund_review'] as const;
export type StuckMarketplaceOrderStatus = (typeof STUCK_MARKETPLACE_ORDER_STATUSES)[number];

export const DESTINATION_REFUND_NOTE =
  'Refunds on destination charges need a reverse transfer before the buyer is refunded. This list does not refund or reverse anything.';

export const STUCK_ORDER_LIST_LIMIT = 200;

/** Ledger claim. Its own clock, so a slow claim cannot shorten the send. */
export const STUCK_ORDER_ALERT_CLAIM_TIMEOUT_MS = 1000;

/** Resend send. Its own clock, so a claim does not eat this budget. */
export const STUCK_ORDER_ALERT_TIMEOUT_MS = 3000;

/** Delete of an unsent claim after a failed send. Not the send's signal. */
export const STUCK_ORDER_ALERT_RELEASE_TIMEOUT_MS = 1000;

/** Write of sent_at after Resend accepts the email. */
export const STUCK_ORDER_ALERT_MARK_TIMEOUT_MS = 1000;

/**
 * Claim plus send plus release, or claim plus send plus markSent.
 * 1000 + 3000 + 1000. The webhook does not wait past this.
 */
export const STUCK_ORDER_ALERT_BUDGET_MS = 5000;

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
 * only when this caller owns the row. `release` deletes an unsent row.
 * `markSent` records that Resend accepted the email. Each call gets its own
 * abort signal. Those signals are not one shared webhook deadline.
 */
export type StuckOrderAlertLedger = {
  claim(orderId: string, status: string, signal?: AbortSignal): Promise<boolean>;
  release(orderId: string, status: string, signal?: AbortSignal): Promise<void>;
  markSent?(orderId: string, status: string, signal?: AbortSignal): Promise<void>;
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
  /** Send timeout. Production uses STUCK_ORDER_ALERT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Claim timeout. Production uses STUCK_ORDER_ALERT_CLAIM_TIMEOUT_MS. */
  claimTimeoutMs?: number;
  /** Release timeout. Production uses STUCK_ORDER_ALERT_RELEASE_TIMEOUT_MS. */
  releaseTimeoutMs?: number;
  /** markSent timeout. Production uses STUCK_ORDER_ALERT_MARK_TIMEOUT_MS. */
  markTimeoutMs?: number;
  /** Whole alert wait. Production uses STUCK_ORDER_ALERT_BUDGET_MS. */
  budgetMs?: number;
  send?: (
    message: { to: string[]; subject: string; text: string; idempotencyKey: string },
    signal: AbortSignal
  ) => Promise<void>;
};

/** Resend idempotency key. A late post after abort and the retry share it. */
export function stuckOrderAlertIdempotencyKey(orderId: string, status: string): string {
  return `stuck-order/${String(orderId || '').trim()}/${String(status || '').trim()}`;
}

type AlertOutcome = { sent: boolean; reason: 'sent' | 'duplicate' | 'no_recipient' | 'error' };

function logNotSent(
  input: StuckOrderAlertInput,
  reason: AlertOutcome['reason'],
  error?: unknown
): AlertOutcome {
  const detail = {
    orderId: input.orderId,
    status: input.status,
    reason,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  };
  if (reason === 'error' || error) console.error('[stuck-order] alert not sent', detail);
  else console.warn('[stuck-order] alert not sent', detail);
  return { sent: false, reason };
}

async function untilAbort<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('alert timed out'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  const pending = work();
  pending.catch(() => {});
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function stepSignal(ms: number): AbortSignal {
  if (ms < 1) return AbortSignal.abort(new Error('alert budget exhausted'));
  return AbortSignal.timeout(ms);
}

function stepBudget(started: number, budgetMs: number, capMs: number): number {
  return Math.max(0, Math.min(capMs, budgetMs - (Date.now() - started)));
}

async function releaseAlertClaim(
  input: StuckOrderAlertInput,
  seen: Set<string>,
  ledger: StuckOrderAlertLedger | undefined,
  held: boolean,
  started: number,
  budgetMs: number
): Promise<void> {
  releaseStuckOrderAlert(input.orderId, input.status, seen);
  if (!held || !ledger) return;
  const signal = stepSignal(stepBudget(started, budgetMs, input.releaseTimeoutMs ?? STUCK_ORDER_ALERT_RELEASE_TIMEOUT_MS));
  try {
    await untilAbort(signal, () => ledger.release(input.orderId, input.status, signal));
  } catch (error) {
    console.error('[stuck-order] alert release failed', {
      orderId: input.orderId,
      status: input.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function notifyStuckMarketplaceOrder(input: StuckOrderAlertInput): Promise<AlertOutcome> {
  const seen = input.seen ?? liveStuckOrderAlerts;
  const to = stuckOrderAlertRecipients([input.buyerEmail]);
  if (!to.length) return logNotSent(input, 'no_recipient');
  if (!input.send && !String(process.env.RESEND_API_KEY || '').trim()) {
    return logNotSent(input, 'error', new Error('RESEND_API_KEY is not set'));
  }
  if (seen.has(stuckOrderAlertKey(input.orderId, input.status))) {
    return logNotSent(input, 'duplicate');
  }

  const started = Date.now();
  const budgetMs = input.budgetMs ?? STUCK_ORDER_ALERT_BUDGET_MS;
  let held = false;
  if (input.ledger) {
    const claimSignal = stepSignal(
      stepBudget(started, budgetMs, input.claimTimeoutMs ?? STUCK_ORDER_ALERT_CLAIM_TIMEOUT_MS)
    );
    try {
      const inserted = await untilAbort(claimSignal, () => input.ledger!.claim(input.orderId, input.status, claimSignal));
      if (!inserted) return logNotSent(input, 'duplicate');
      held = true;
    } catch (error) {
      console.error('[stuck-order] alert claim failed', {
        orderId: input.orderId,
        status: input.status,
        error: error instanceof Error ? error.message : String(error),
      });
      held = false;
    }
  }
  if (!claimStuckOrderAlert(input.orderId, input.status, seen)) {
    await releaseAlertClaim(input, seen, input.ledger, held, started, budgetMs);
    return logNotSent(input, 'duplicate');
  }

  const subject = stuckOrderAlertSubject(input.orderId, input.status);
  const text = stuckOrderAlertText(input);
  const idempotencyKey = stuckOrderAlertIdempotencyKey(input.orderId, input.status);
  const sendSignal = stepSignal(stepBudget(started, budgetMs, input.timeoutMs ?? STUCK_ORDER_ALERT_TIMEOUT_MS));
  try {
    await untilAbort(sendSignal, async () => {
      if (input.send) {
        await input.send({ to, subject, text, idempotencyKey }, sendSignal);
        return;
      }
      const apiKey = String(process.env.RESEND_API_KEY || '').trim();
      const res = await postResendEmail({
        apiKey,
        signal: sendSignal,
        idempotencyKey,
        message: {
          from: productIssuesFromAddress(),
          to,
          subject,
          text,
        },
      });
      // Left as-is: any non-2xx, including a Resend 409 idempotency conflict,
      // is a failed send. The claim is released. 409 is not treated as already delivered.
      if (!res.ok) throw new Error('alert send failed');
    });
  } catch (error) {
    await releaseAlertClaim(input, seen, input.ledger, held, started, budgetMs);
    return logNotSent(input, 'error', error);
  }

  if (held && input.ledger?.markSent) {
    const markSignal = stepSignal(stepBudget(started, budgetMs, input.markTimeoutMs ?? STUCK_ORDER_ALERT_MARK_TIMEOUT_MS));
    try {
      await untilAbort(markSignal, () => input.ledger!.markSent!(input.orderId, input.status, markSignal));
    } catch (error) {
      console.error('[stuck-order] alert sent marker failed', {
        orderId: input.orderId,
        status: input.status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sent: true, reason: 'sent' };
}
