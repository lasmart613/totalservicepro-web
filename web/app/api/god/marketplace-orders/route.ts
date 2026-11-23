import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  STUCK_MARKETPLACE_ORDER_STATUSES,
  assembleStuckOrders,
  marketplaceOrdersAuthStatus,
  type StuckOrderListing,
  type StuckOrderOrg,
  type StuckOrderSource,
} from '@/lib/marketplace/stuck-orders';

export const dynamic = 'force-dynamic';

const ORDER_COLUMNS =
  'id, listing_id, seller_organization_id, buyer_email, amount_cents, currency, stripe_checkout_session_id, stripe_payment_intent_id, status, payout_status, quantity, created_at, updated_at';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Read-only God list of marketplace orders waiting on a claim or a refund review.
 * Signed-in non-admins get 403. Missing sessions stay 401.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) {
    const status = marketplaceOrdersAuthStatus({ ok: false, httpStatus: gate.response.status });
    if (status === gate.response.status) return gate.response;
    const payload = await gate.response.json().catch(() => ({ error: 'Forbidden', god: false }));
    return json(payload, status);
  }
  if (!hasServiceRole()) return json({ error: 'Marketplace orders unavailable' }, 503);

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('marketplace_orders')
    .select(ORDER_COLUMNS)
    .in('status', [...STUCK_MARKETPLACE_ORDER_STATUSES])
    .order('updated_at', { ascending: true })
    .limit(200);
  if (error) return json({ error: 'Marketplace orders unavailable' }, 503);

  const orders = (data || []) as StuckOrderSource[];
  const listingIds = [...new Set(orders.map((order) => String(order.listing_id || '')).filter(Boolean))];
  const orgIds = [...new Set(orders.map((order) => String(order.seller_organization_id || '')).filter(Boolean))];
  const [listingsRes, orgsRes] = await Promise.all([
    listingIds.length
      ? admin.from('marketplace_listings').select('id, title, part_number').in('id', listingIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? admin.from('organizations').select('id, name').in('id', orgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (listingsRes.error || orgsRes.error) return json({ error: 'Marketplace orders unavailable' }, 503);

  return json({
    orders: assembleStuckOrders({
      orders,
      listings: (listingsRes.data || []) as StuckOrderListing[],
      organizations: (orgsRes.data || []) as StuckOrderOrg[],
    }),
    readOnly: true,
  });
}
