/**
 * God view and admin alert for marketplace orders that did not finish.
 * stock_pending is waiting on a claim. refund_review needs a person.
 * Buyers and sellers are never emailed. A sweep of orders older than N hours
 * is not built here: it would need a scheduled job and a durable send log.
 */

import { productIssuesFromAddress, productIssuesTeamRecipients } from '../product-issues.ts';
import { postResendEmail } from '../mail/outgoing-mail.ts';

export const STUCK_MARKETPLACE_ORDER_STATUSES = ['stock_pending', 'refund_review'] as const;
export type StuckMarketplaceOrderStatus = (typeof STUCK_MARKETPLACE_ORDER_STATUSES)[number];

export const DESTINATION_REFUND_NOTE =
  'Refunds on destination charges need a reverse transfer before the buyer is refunded. This list does not refund or reverse anything.';

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

/** True the first time this order should email admins. */
export function claimStuckOrderAlert(orderId: string, seen: Set<string> = liveStuckOrderAlerts): boolean {
  const id = String(orderId || '').trim();
  if (!id || seen.has(id)) return false;
  seen.add(id);
  return true;
}

export function releaseStuckOrderAlert(orderId: string, seen: Set<string> = liveStuckOrderAlerts): void {
  seen.delete(String(orderId || '').trim());
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
  send?: (message: { to: string[]; subject: string; text: string }) => Promise<void>;
};

export async function notifyStuckMarketplaceOrder(
  input: StuckOrderAlertInput
): Promise<{ sent: boolean; reason: 'sent' | 'duplicate' | 'no_recipient' | 'error' }> {
  const seen = input.seen ?? liveStuckOrderAlerts;
  if (!claimStuckOrderAlert(input.orderId, seen)) return { sent: false, reason: 'duplicate' };
  const to = stuckOrderAlertRecipients([input.buyerEmail]);
  if (!to.length) {
    releaseStuckOrderAlert(input.orderId, seen);
    return { sent: false, reason: 'no_recipient' };
  }
  const subject = stuckOrderAlertSubject(input.orderId, input.status);
  const text = stuckOrderAlertText(input);
  try {
    if (input.send) {
      await input.send({ to, subject, text });
    } else {
      const apiKey = String(process.env.RESEND_API_KEY || '').trim();
      if (!apiKey) {
        releaseStuckOrderAlert(input.orderId, seen);
        return { sent: false, reason: 'error' };
      }
      const res = await postResendEmail({
        apiKey,
        message: {
          from: productIssuesFromAddress(),
          to,
          subject,
          text,
        },
      });
      if (!res.ok) {
        releaseStuckOrderAlert(input.orderId, seen);
        return { sent: false, reason: 'error' };
      }
    }
    return { sent: true, reason: 'sent' };
  } catch {
    releaseStuckOrderAlert(input.orderId, seen);
    return { sent: false, reason: 'error' };
  }
}
