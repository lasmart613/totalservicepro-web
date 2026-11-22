/**
 * Record a paid marketplace parts Checkout session.
 * Idempotent on the Stripe session id. Does not drop a paid part order.
 *
 * The order is inserted as stock_pending, then stock is claimed with a
 * compare-and-swap on the quantity just read. Each attempt re-reads. A short
 * read is refund_review. Conflicts while stock still covers the order are
 * retried with jitter until an attempt cap or a time cap; if the claim still
 * has not landed, the order stays stock_pending. A webhook retry of
 * stock_pending tries the claim again. A paid or refund_review order is not
 * decremented again. No SQL function is required.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { listingQuantity, type MarketplaceListingLike } from '../marketplace/parts.ts';
import {
  listingQuantityAfterSale,
  partOrderFromCheckoutSession,
  type PartOrderDraft,
} from './stripe-connect.ts';

/** Paid order that did not get the stock. A person refunds it; the webhook must not fulfill it later. */
export const PART_ORDER_REFUND_REVIEW_STATUS = 'refund_review';

/** Inserted before the claim, and kept when a write fails or contention outlasts the cap. */
export const PART_ORDER_STOCK_PENDING_STATUS = 'stock_pending';

/** Bound on compare-and-swap attempts while stock still covers the order. */
export const STOCK_CLAIM_ATTEMPT_CAP = 12;

/** Stop retrying once this much time has passed, even if attempts remain. */
export const STOCK_CLAIM_TIME_CAP_MS = 2000;

export type AppliedPartOrder = {
  orderId: string | null;
  alreadyApplied: boolean;
  payoutStatus: string;
  listingId: string;
  /** False when the order was recorded for refund review and stock was not taken. */
  fulfilled: boolean;
};

type StockClaim =
  | { ok: true }
  | { ok: false; reason: 'insufficient' | 'conflict' | 'pending' | 'missing' | 'untracked' | 'error' };

type ClaimClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

function orderRow(order: PartOrderDraft, status: string): Record<string, unknown> {
  return {
    listing_id: order.listingId,
    seller_organization_id: order.sellerOrganizationId,
    stripe_checkout_session_id: order.stripeCheckoutSessionId,
    stripe_payment_intent_id: order.stripePaymentIntentId,
    stripe_account_id: order.stripeAccountId,
    amount_cents: order.amountCents,
    application_fee_cents: order.applicationFeeCents,
    currency: order.currency,
    quantity: order.quantity,
    buyer_email: order.buyerEmail,
    status,
    payout_status: order.payoutStatus,
    updated_at: new Date().toISOString(),
  };
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function rowMatched(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0;
  return data != null;
}

function fulfilledStatus(status: unknown): boolean {
  return String(status || '') === 'paid';
}

function claimClock(input: { now?: () => number; sleep?: (ms: number) => Promise<void>; random?: () => number }): ClaimClock {
  return {
    now: input.now ?? Date.now,
    sleep: input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    random: input.random ?? Math.random,
  };
}

/** 25–74ms so overlapping claims do not line up on the same instant. */
function backoffMs(random: () => number): number {
  return 25 + Math.floor(random() * 50);
}

function logClaim(message: string, detail: Record<string, unknown>): void {
  console.error(message, detail);
}

async function findExisting(writer: SupabaseClient, sessionId: string) {
  const { data, error } = await writer
    .from('marketplace_orders')
    .select('id, payout_status, listing_id, status')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();
  if (error) return { row: null, error };
  return { row: data, error: null };
}

function appliedExisting(
  row: { id?: unknown; payout_status?: unknown; listing_id?: unknown; status?: unknown } | null,
  order: PartOrderDraft
): AppliedPartOrder {
  return {
    orderId: row?.id ? String(row.id) : null,
    alreadyApplied: true,
    payoutStatus: String(row?.payout_status || order.payoutStatus),
    listingId: String(row?.listing_id || order.listingId),
    fulfilled: fulfilledStatus(row?.status),
  };
}

/**
 * One read and one conditional update. A miss (`conflict`) means another
 * delivery changed the row after this read. `insufficient` means the read
 * itself is already short, so there is nothing to write.
 */
async function claimListingStockOnce(writer: SupabaseClient, order: PartOrderDraft): Promise<StockClaim> {
  const { data, error } = await writer
    .from('marketplace_listings')
    .select('id, quantity, qty, status, details')
    .eq('id', order.listingId)
    .maybeSingle();
  if (error) {
    logClaim('[part-order] quantity read failed', { listingId: order.listingId, message: error.message });
    return { ok: false, reason: 'error' };
  }
  if (!data) return { ok: false, reason: 'missing' };

  const current = listingQuantity(data as MarketplaceListingLike);
  const sold = Math.max(1, Math.floor(order.quantity) || 1);
  if (current == null) return { ok: false, reason: 'untracked' };
  if (current < sold) return { ok: false, reason: 'insufficient' };

  const next = listingQuantityAfterSale(current, sold);
  if (next.quantity == null) return { ok: false, reason: 'untracked' };

  const quantityCol = readNumber((data as { quantity?: unknown }).quantity);
  const qtyCol = readNumber((data as { qty?: unknown }).qty);
  const patch: { quantity: number; qty?: number; status?: string; updated_at: string } = {
    quantity: next.quantity,
    updated_at: new Date().toISOString(),
  };
  if (next.soldOut) patch.status = 'sold';
  if (quantityCol == null && qtyCol != null) patch.qty = next.quantity;

  const base = writer.from('marketplace_listings').update(patch).eq('id', order.listingId);
  const updated =
    quantityCol != null
      ? await base.eq('quantity', quantityCol).select('id, quantity, status')
      : qtyCol != null
        ? await base.eq('qty', qtyCol).select('id, quantity, status')
        : await base.is('quantity', null).select('id, quantity, status');
  if (updated.error) {
    logClaim('[part-order] quantity update failed', { listingId: order.listingId, message: updated.error.message });
    return { ok: false, reason: 'error' };
  }
  if (!rowMatched(updated.data)) return { ok: false, reason: 'conflict' };
  return { ok: true };
}

async function claimListingStock(writer: SupabaseClient, order: PartOrderDraft, clock: ClaimClock): Promise<StockClaim> {
  const started = clock.now();
  let attempts = 0;
  let last: StockClaim = { ok: false, reason: 'conflict' };
  while (attempts < STOCK_CLAIM_ATTEMPT_CAP && clock.now() - started < STOCK_CLAIM_TIME_CAP_MS) {
    attempts += 1;
    last = await claimListingStockOnce(writer, order);
    if (last.ok || last.reason !== 'conflict') return last;
    if (attempts >= STOCK_CLAIM_ATTEMPT_CAP || clock.now() - started >= STOCK_CLAIM_TIME_CAP_MS) break;
    await clock.sleep(backoffMs(clock.random));
  }
  // One more read so a short listing becomes refund_review instead of pending.
  const fresh = await claimListingStockOnce(writer, order);
  if (fresh.ok || fresh.reason !== 'conflict') return fresh;
  return { ok: false, reason: 'pending' };
}

async function markOrderStatus(
  writer: SupabaseClient,
  orderId: string | null,
  status: string
): Promise<void> {
  if (!orderId) return;
  const updated = await writer
    .from('marketplace_orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', orderId);
  if (updated.error) {
    logClaim('[part-order] order status update failed', { orderId, status, message: updated.error.message });
  }
}

async function settleStock(
  writer: SupabaseClient,
  orderId: string | null,
  order: PartOrderDraft,
  clock: ClaimClock
): Promise<{ ok: true; applied: AppliedPartOrder } | { ok: false; reason: string; retry: boolean }> {
  let claim: StockClaim;
  try {
    claim = await claimListingStock(writer, order, clock);
  } catch (e) {
    logClaim('[part-order] quantity update failed', {
      orderId,
      listingId: order.listingId,
      sessionId: order.stripeCheckoutSessionId,
      error: e instanceof Error ? e.message : String(e),
    });
    claim = { ok: false, reason: 'error' };
  }

  if (claim.ok || claim.reason === 'untracked') {
    await markOrderStatus(writer, orderId, 'paid');
    return {
      ok: true,
      applied: {
        orderId,
        alreadyApplied: false,
        payoutStatus: order.payoutStatus,
        listingId: order.listingId,
        fulfilled: true,
      },
    };
  }

  if (claim.reason === 'insufficient' || claim.reason === 'missing') {
    logClaim('[part-order] not fulfilled; marked for refund review', {
      orderId,
      listingId: order.listingId,
      sessionId: order.stripeCheckoutSessionId,
      reason: claim.reason,
      quantity: order.quantity,
      payoutStatus: order.payoutStatus,
    });
    await markOrderStatus(writer, orderId, PART_ORDER_REFUND_REVIEW_STATUS);
    return {
      ok: true,
      applied: {
        orderId,
        alreadyApplied: false,
        payoutStatus: order.payoutStatus,
        listingId: order.listingId,
        fulfilled: false,
      },
    };
  }

  logClaim('[part-order] stock claim still pending', {
    orderId,
    listingId: order.listingId,
    sessionId: order.stripeCheckoutSessionId,
    reason: claim.reason,
    quantity: order.quantity,
    payoutStatus: order.payoutStatus,
  });
  return { ok: false, reason: PART_ORDER_STOCK_PENDING_STATUS, retry: true };
}

export async function applyPartCheckoutSession(input: {
  writer: SupabaseClient;
  session: unknown;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): Promise<{ ok: true; applied: AppliedPartOrder } | { ok: false; reason: string; retry: boolean }> {
  const parsed = partOrderFromCheckoutSession(input.session);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, retry: false };
  const clock = claimClock(input);

  const existing = await findExisting(input.writer, parsed.order.stripeCheckoutSessionId);
  if (existing.error) {
    return { ok: false, reason: existing.error.message || 'load_failed', retry: true };
  }
  if (existing.row?.id) {
    if (String(existing.row.status || '') === PART_ORDER_STOCK_PENDING_STATUS) {
      const settled = await settleStock(input.writer, String(existing.row.id), parsed.order, clock);
      if (settled.ok) settled.applied.alreadyApplied = true;
      return settled;
    }
    return { ok: true, applied: appliedExisting(existing.row, parsed.order) };
  }

  const inserted = await input.writer
    .from('marketplace_orders')
    .insert(orderRow(parsed.order, PART_ORDER_STOCK_PENDING_STATUS))
    .select('id')
    .maybeSingle();
  if (inserted.error) {
    if (/duplicate|unique|23505/i.test(inserted.error.message || '')) {
      const again = await findExisting(input.writer, parsed.order.stripeCheckoutSessionId);
      if (again.row?.id && String(again.row.status || '') === PART_ORDER_STOCK_PENDING_STATUS) {
        const settled = await settleStock(input.writer, String(again.row.id), parsed.order, clock);
        if (settled.ok) settled.applied.alreadyApplied = true;
        return settled;
      }
      return { ok: true, applied: appliedExisting(again.row, parsed.order) };
    }
    return { ok: false, reason: inserted.error.message || 'insert_failed', retry: true };
  }

  const orderId = inserted.data?.id ? String(inserted.data.id) : null;
  return settleStock(input.writer, orderId, parsed.order, clock);
}
