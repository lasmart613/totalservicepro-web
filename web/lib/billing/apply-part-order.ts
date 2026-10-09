/**
 * Record a paid marketplace parts Checkout session.
 * Idempotent on the Stripe session id. Does not drop a paid part order.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { listingQuantity, type MarketplaceListingLike } from '../marketplace/parts.ts';
import {
  listingQuantityAfterSale,
  partOrderFromCheckoutSession,
  type PartOrderDraft,
} from './stripe-connect.ts';

export type AppliedPartOrder = {
  orderId: string | null;
  alreadyApplied: boolean;
  payoutStatus: string;
  listingId: string;
};

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

async function findExisting(writer: SupabaseClient, sessionId: string) {
  const { data, error } = await writer
    .from('marketplace_orders')
    .select('id, payout_status, listing_id')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();
  if (error) return { row: null, error };
  return { row: data, error: null };
}

async function decrementListing(writer: SupabaseClient, order: PartOrderDraft): Promise<void> {
  try {
    const { data, error } = await writer
      .from('marketplace_listings')
      .select('id, quantity, qty, status, details')
      .eq('id', order.listingId)
      .maybeSingle();
    if (error || !data) return;
    const next = listingQuantityAfterSale(
      listingQuantity(data as MarketplaceListingLike),
      order.quantity
    );
    if (next.quantity == null) return;
    const patch: Record<string, unknown> = {
      quantity: next.quantity,
      updated_at: new Date().toISOString(),
    };
    if (next.soldOut) patch.status = 'sold';
    const updated = await writer.from('marketplace_listings').update(patch).eq('id', order.listingId);
    if (updated.error) console.warn('[part-order] quantity update', updated.error.message);
  } catch (e) {
    console.warn('[part-order] quantity update', e);
  }
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
    return {
      ok: true,
      applied: {
        orderId: String(existing.row.id),
        alreadyApplied: true,
        payoutStatus: String(existing.row.payout_status || parsed.order.payoutStatus),
        listingId: String(existing.row.listing_id || parsed.order.listingId),
      },
    };
  }

  const inserted = await input.writer.from('marketplace_orders').insert(orderRow(parsed.order)).select('id').maybeSingle();
  if (inserted.error) {
    if (/duplicate|unique|23505/i.test(inserted.error.message || '')) {
      const again = await findExisting(input.writer, parsed.order.stripeCheckoutSessionId);
      return {
        ok: true,
        applied: {
          orderId: again.row?.id ? String(again.row.id) : null,
          alreadyApplied: true,
          payoutStatus: parsed.order.payoutStatus,
          listingId: parsed.order.listingId,
        },
      };
    }
    return { ok: false, reason: inserted.error.message || 'insert_failed', retry: true };
  }

  await decrementListing(input.writer, parsed.order);
  return {
    ok: true,
    applied: {
      orderId: inserted.data?.id ? String(inserted.data.id) : null,
      alreadyApplied: false,
      payoutStatus: parsed.order.payoutStatus,
      listingId: parsed.order.listingId,
    },
  };
}
