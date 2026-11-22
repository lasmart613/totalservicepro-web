/**
 * Record a paid marketplace parts Checkout session.
 * Idempotent on the Stripe session id. Does not drop a paid part order.
 *
 * Stock is claimed with a compare-and-swap on the quantity just read:
 * update the listing only while that column still matches (or, when stock
 * lived only in details, only while quantity is still null). PostgREST can
 * express that filter, so no SQL function is required. If no row comes back
 * and a fresh read is still short, the order is kept and marked refund_review
 * instead of fulfilled. A webhook retry for the same session does not
 * decrement again.
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

/** Re-read after a lost race. Enough for two deliveries of the same listing; a last unit still fulfills once. */
const STOCK_CLAIM_ATTEMPTS = 4;

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
  | { ok: false; reason: 'insufficient' | 'conflict' | 'missing' | 'untracked' | 'error' };

function orderRow(order: PartOrderDraft): Record<string, unknown> {
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
    status: order.status,
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
  return String(status || '') !== PART_ORDER_REFUND_REVIEW_STATUS;
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
    console.warn('[part-order] quantity update', error.message);
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
    console.warn('[part-order] quantity update', updated.error.message);
    return { ok: false, reason: 'error' };
  }
  if (!rowMatched(updated.data)) return { ok: false, reason: 'conflict' };
  return { ok: true };
}

async function claimListingStock(writer: SupabaseClient, order: PartOrderDraft): Promise<StockClaim> {
  let last: StockClaim = { ok: false, reason: 'conflict' };
  for (let attempt = 0; attempt < STOCK_CLAIM_ATTEMPTS; attempt++) {
    last = await claimListingStockOnce(writer, order);
    if (last.ok || last.reason !== 'conflict') return last;
  }
  return last;
}

async function markRefundReview(
  writer: SupabaseClient,
  orderId: string | null,
  order: PartOrderDraft,
  reason: string
): Promise<void> {
  console.warn('[part-order] not fulfilled; marked for refund review', {
    orderId,
    listingId: order.listingId,
    sessionId: order.stripeCheckoutSessionId,
    reason,
    quantity: order.quantity,
    payoutStatus: order.payoutStatus,
  });
  if (!orderId) return;
  const updated = await writer
    .from('marketplace_orders')
    .update({
      status: PART_ORDER_REFUND_REVIEW_STATUS,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);
  if (updated.error) console.warn('[part-order] refund review mark', updated.error.message);
}

export async function applyPartCheckoutSession(input: {
  writer: SupabaseClient;
  session: unknown;
}): Promise<{ ok: true; applied: AppliedPartOrder } | { ok: false; reason: string; retry: boolean }> {
  const parsed = partOrderFromCheckoutSession(input.session);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, retry: false };

  const existing = await findExisting(input.writer, parsed.order.stripeCheckoutSessionId);
  if (existing.error) {
    return { ok: false, reason: existing.error.message || 'load_failed', retry: true };
  }
  if (existing.row?.id) {
    return { ok: true, applied: appliedExisting(existing.row, parsed.order) };
  }

  const inserted = await input.writer.from('marketplace_orders').insert(orderRow(parsed.order)).select('id').maybeSingle();
  if (inserted.error) {
    if (/duplicate|unique|23505/i.test(inserted.error.message || '')) {
      const again = await findExisting(input.writer, parsed.order.stripeCheckoutSessionId);
      return { ok: true, applied: appliedExisting(again.row, parsed.order) };
    }
    return { ok: false, reason: inserted.error.message || 'insert_failed', retry: true };
  }

  const orderId = inserted.data?.id ? String(inserted.data.id) : null;
  let claim: StockClaim;
  try {
    claim = await claimListingStock(input.writer, parsed.order);
  } catch (e) {
    console.warn('[part-order] quantity update', e);
    claim = { ok: false, reason: 'error' };
  }

  // Unknown stock stays a recorded paid order (checkout already allowed quantity 1).
  // A write error stays paid too: the order row is the idempotency key, and a
  // webhook retry must not take the stock a second time. A confirmed miss or a
  // short read is not a fulfillment.
  if (!claim.ok && claim.reason !== 'untracked' && claim.reason !== 'error') {
    await markRefundReview(input.writer, orderId, parsed.order, claim.reason);
    return {
      ok: true,
      applied: {
        orderId,
        alreadyApplied: false,
        payoutStatus: parsed.order.payoutStatus,
        listingId: parsed.order.listingId,
        fulfilled: false,
      },
    };
  }

  return {
    ok: true,
    applied: {
      orderId,
      alreadyApplied: false,
      payoutStatus: parsed.order.payoutStatus,
      listingId: parsed.order.listingId,
      fulfilled: true,
    },
  };
}
