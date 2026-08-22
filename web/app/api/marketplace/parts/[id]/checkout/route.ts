import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createPartCheckoutSession,
  loadMarketplaceListing,
  StripeMarketplaceError,
  syncPartStripeCatalog,
} from '@/lib/billing/stripe-marketplace';
import { isPartListing, listingAvailability } from '@/lib/marketplace/parts';
import { resolveStripeSecret } from '@/lib/billing/stripe-pay';

export const dynamic = 'force-dynamic';

async function callerEmail(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase.auth.getUser(token);
    return data.user?.email || null;
  } catch {
    return null;
  }
}

/**
 * Start Stripe Checkout for a parts listing, or sync the Stripe Product + Price only.
 * Guest checkout is allowed (same money path as invoice pay links).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const raw = await Promise.resolve(ctx.params);
    const id = raw?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const listing = await loadMarketplaceListing(id);
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    if (!isPartListing(listing)) {
      return NextResponse.json(
        { error: 'Only parts-for-sale listings can be purchased. RFQs and service requests are not Stripe products.' },
        { status: 400 }
      );
    }

    const availability = listingAvailability(listing);
    if (!availability.purchasable) {
      return NextResponse.json(
        { error: availability.reason || 'Not available', soldOut: availability.soldOut, availability },
        { status: 409 }
      );
    }

    if (body?.syncOnly) {
      const catalog = await syncPartStripeCatalog(listing);
      return NextResponse.json({
        ok: true,
        ...catalog,
        availability,
        livemode: resolveStripeSecret().livemode,
      });
    }

    const headerEmail = await callerEmail(req);
    const email = String(body?.email || headerEmail || '').trim() || null;
    const quantity = body?.quantity != null ? Number(body.quantity) : 1;
    const session = await createPartCheckoutSession({ listing, customerEmail: email, quantity });
    return NextResponse.json({
      url: session.url,
      sessionId: session.sessionId,
      productId: session.productId,
      priceId: session.priceId,
      amountCents: session.amountCents,
      livemode: session.livemode,
    });
  } catch (e: unknown) {
    const status = e instanceof StripeMarketplaceError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Checkout failed';
    console.error('[marketplace/parts checkout]', e);
    return NextResponse.json({ error: message }, { status });
  }
}
