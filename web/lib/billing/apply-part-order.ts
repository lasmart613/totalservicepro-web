/**
 * Record a paid marketplace parts Checkout session.
 * Idempotent on the Stripe session id. Does not drop a paid part order.
 *
 * The order is inserted as stock_pending. Stock is claimed only by
 * marketplace_order_claim_stock (000972, not applied with this PR): one
 * transaction flips that order to paid and decrements the listing, or marks
 * refund_review when the listing is short. A repeat returns already_settled
 * and does not decrement again. Fulfilled is reported only for claimed or
 * already_settled. Checkout's kill switch is not read here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseMarketplaceOrderAlertLedger } from '../marketplace/stuck-order-alert-ledger.ts';
import { notifyStuckMarketplaceOrder, type StuckOrderAlertInput } from '../marketplace/stuck-orders.ts';
import { hasServiceRole } from '../supabase/admin.ts';
import { partOrderFromCheckoutSession, type PartOrderDraft } from './stripe-connect.ts';

/** Paid order that did not get the stock. A person refunds it; the webhook must not fulfill it later. */
export const PART_ORDER_REFUND_REVIEW_STATUS = 'refund_review';

/** Inserted before the claim. Stays here when the claim function errors. */
export const PART_ORDER_STOCK_PENDING_STATUS = 'stock_pending';

export const PART_ORDER_CLAIM_RPC = 'marketplace_order_claim_stock';

export const PART_ORDER_CLAIMED = 'claimed';
export const PART_ORDER_ALREADY_SETTLED = 'already_settled';

export type AppliedPartOrder = {
  orderId: string | null;
  alreadyApplied: boolean;
  payoutStatus: string;
  listingId: string;
  /** True only when the claim function returned claimed or already_settled. */
  fulfilled: boolean;
};

export type PartOrderApplyResult =
  | { ok: true; applied: AppliedPartOrder }
  | { ok: false; reason: string; retry: boolean };

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
    status: PART_ORDER_STOCK_PENDING_STATUS,
    payout_status: order.payoutStatus,
    updated_at: new Date().toISOString(),
  };
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

/**
 * Webhook JSON for a part checkout. fulfilled is copied from the claim result
 * and is never set true on this side.
 */
export function partOrderRouteOutcome(part: PartOrderApplyResult): {
  httpStatus: number;
  body: Record<string, unknown>;
} {
  if (!part.ok) {
    if (part.retry) return { httpStatus: 500, body: { error: part.reason } };
    return { httpStatus: 200, body: { ok: true, ignored: part.reason, kind: 'part' } };
  }
  return {
    httpStatus: 200,
    body: {
      ok: true,
      applied: true,
      kind: 'part',
      orderId: part.applied.orderId,
      listingId: part.applied.listingId,
      payoutStatus: part.applied.payoutStatus,
      alreadyApplied: part.applied.alreadyApplied,
      fulfilled: part.applied.fulfilled,
    },
  };
}

async function alertStuck(
  orderId: string,
  order: PartOrderDraft,
  status: 'stock_pending' | 'refund_review',
  notify: (input: StuckOrderAlertInput) => Promise<unknown>
): Promise<void> {
  try {
    await notify({
      orderId,
      listingId: order.listingId,
      status,
      sessionId: order.stripeCheckoutSessionId,
      buyerEmail: order.buyerEmail,
      sellerOrganizationId: order.sellerOrganizationId,
      payoutStatus: order.payoutStatus,
      amountCents: order.amountCents,
      currency: order.currency,
    });
  } catch (e) {
    logClaim('[part-order] admin alert failed', {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function claimOrder(
  writer: SupabaseClient,
  orderId: string,
  order: PartOrderDraft,
  existingRow: boolean,
  notify: (input: StuckOrderAlertInput) => Promise<unknown>
): Promise<PartOrderApplyResult> {
  const sold = Math.max(1, Math.floor(order.quantity) || 1);
  let data: unknown;
  let error: { message?: string } | null = null;
  try {
    const claimed = await writer.rpc(PART_ORDER_CLAIM_RPC, {
      p_order_id: orderId,
      p_listing_id: order.listingId,
      p_quantity: sold,
    });
    data = claimed.data;
    error = claimed.error;
  } catch (e) {
    logClaim('[part-order] stock claim failed', {
      orderId,
      listingId: order.listingId,
      sessionId: order.stripeCheckoutSessionId,
      error: e instanceof Error ? e.message : String(e),
    });
    await alertStuck(orderId, order, 'stock_pending', notify);
    return { ok: false, reason: PART_ORDER_STOCK_PENDING_STATUS, retry: true };
  }
  if (error) {
    logClaim('[part-order] stock claim failed', {
      orderId,
      listingId: order.listingId,
      sessionId: order.stripeCheckoutSessionId,
      message: error.message,
    });
    await alertStuck(orderId, order, 'stock_pending', notify);
    return { ok: false, reason: PART_ORDER_STOCK_PENDING_STATUS, retry: true };
  }

  const result = String(data ?? '');
  if (result === PART_ORDER_CLAIMED || result === PART_ORDER_ALREADY_SETTLED) {
    return {
      ok: true,
      applied: {
        orderId,
        alreadyApplied: result === PART_ORDER_ALREADY_SETTLED || existingRow,
        payoutStatus: order.payoutStatus,
        listingId: order.listingId,
        fulfilled: true,
      },
    };
  }
  if (result === PART_ORDER_REFUND_REVIEW_STATUS) {
    logClaim('[part-order] not fulfilled; marked for refund review', {
      orderId,
      listingId: order.listingId,
      sessionId: order.stripeCheckoutSessionId,
      reason: result,
      quantity: order.quantity,
      payoutStatus: order.payoutStatus,
    });
    await alertStuck(orderId, order, 'refund_review', notify);
    return {
      ok: true,
      applied: {
        orderId,
        alreadyApplied: existingRow,
        payoutStatus: order.payoutStatus,
        listingId: order.listingId,
        fulfilled: false,
      },
    };
  }

  logClaim('[part-order] stock claim returned an unexpected result', {
    orderId,
    listingId: order.listingId,
    sessionId: order.stripeCheckoutSessionId,
    result,
  });
  await alertStuck(orderId, order, 'stock_pending', notify);
  return { ok: false, reason: PART_ORDER_STOCK_PENDING_STATUS, retry: true };
}

export async function applyPartCheckoutSession(input: {
  writer: SupabaseClient;
  session: unknown;
  notifyStuck?: (alert: StuckOrderAlertInput) => Promise<unknown>;
}): Promise<PartOrderApplyResult> {
  const parsed = partOrderFromCheckoutSession(input.session);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, retry: false };
  const notify =
    input.notifyStuck ??
    ((alert: StuckOrderAlertInput) =>
      notifyStuckMarketplaceOrder({
        ...alert,
        ...(hasServiceRole() ? { ledger: supabaseMarketplaceOrderAlertLedger() } : {}),
      }));

  const existing = await findExisting(input.writer, parsed.order.stripeCheckoutSessionId);
  if (existing.error) {
    return { ok: false, reason: existing.error.message || 'load_failed', retry: true };
  }
  if (existing.row?.id) {
    return claimOrder(input.writer, String(existing.row.id), parsed.order, true, notify);
  }

  const inserted = await input.writer
    .from('marketplace_orders')
    .insert(orderRow(parsed.order))
    .select('id')
    .maybeSingle();
  if (inserted.error) {
    if (/duplicate|unique|23505/i.test(inserted.error.message || '')) {
      const again = await findExisting(input.writer, parsed.order.stripeCheckoutSessionId);
      if (!again.row?.id) {
        return { ok: false, reason: PART_ORDER_STOCK_PENDING_STATUS, retry: true };
      }
      return claimOrder(input.writer, String(again.row.id), parsed.order, true, notify);
    }
    return { ok: false, reason: inserted.error.message || 'insert_failed', retry: true };
  }

  const orderId = inserted.data?.id ? String(inserted.data.id) : '';
  if (!orderId) {
    logClaim('[part-order] stock claim failed', {
      listingId: parsed.order.listingId,
      sessionId: parsed.order.stripeCheckoutSessionId,
      message: 'insert returned no id',
    });
    return { ok: false, reason: PART_ORDER_STOCK_PENDING_STATUS, retry: true };
  }
  return claimOrder(input.writer, orderId, parsed.order, false, notify);
}
