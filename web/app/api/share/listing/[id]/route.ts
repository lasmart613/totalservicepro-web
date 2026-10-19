import { NextRequest, NextResponse } from 'next/server';
import { listingOrgIdVisibleToViewer } from '@/lib/billing/listing-invoice';
import { getMarketplaceCaller } from '@/lib/marketplace/caller';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { SHARE_LISTING_SELECTS, sanitizeShareListingDetails } from '@/lib/share-listing-public';

export const dynamic = 'force-dynamic';

/** marketplace_listings.id is a uuid; anything else is a 404 without touching the DB. */
const LISTING_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * Public share endpoint for marketplace listings (equipment / parts / consumables).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const raw = await Promise.resolve(ctx.params);
    const id = String(raw?.id || '').trim();
    if (!LISTING_ID_RE.test(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'Share preview unavailable' },
        { status: 503 }
      );
    }

    const admin = getSupabaseAdmin();
    const selects = SHARE_LISTING_SELECTS;
    let data: Record<string, unknown> | null = null;
    let error: { message?: string } | null = null;
    for (const cols of selects) {
      const res = await admin.from('marketplace_listings').select(cols).eq('id', id).maybeSingle();
      data = (res.data as Record<string, unknown> | null) || null;
      error = res.error;
      if (!error && data) break;
      if (error && !/column|does not exist|schema cache/i.test(error.message || '')) break;
    }

    if (error) {
      console.error('[share/listing]', error.message);
      return NextResponse.json({ error: 'Share preview unavailable' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const caller = await getMarketplaceCaller(_req);
    const organizationId = listingOrgIdVisibleToViewer(
      data.organization_id as string | number | null | undefined,
      caller?.orgId
    );

    const st = String(data.status || 'active').toLowerCase();
    if (!['active', 'open', 'published'].includes(st)) {
      return NextResponse.json(
        { error: 'This listing is no longer available', status: data.status, closed: true },
        { status: 403 }
      );
    }

    // Sanitize details: no seller contact, no Stripe keys.
    const details = sanitizeShareListingDetails(data.details);

    return NextResponse.json({
      listing: {
        ...data,
        details,
        seller_id: undefined,
        created_by: undefined,
        serial_number: undefined,
        stripe_product_id: undefined,
        stripe_price_id: undefined,
        organization_id: organizationId,
        _public_share: true,
      },
    });
  } catch (e: unknown) {
    console.error('[share/listing]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Share preview unavailable' }, { status: 500 });
  }
}
