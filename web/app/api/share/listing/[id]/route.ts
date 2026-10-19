import { NextRequest, NextResponse } from 'next/server';
import { listingOrgIdVisibleToViewer } from '@/lib/billing/listing-invoice';
import { getMarketplaceCaller } from '@/lib/marketplace/caller';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** marketplace_listings.id is a uuid; anything else is a 404 without touching the DB. */
const LISTING_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Columns a public share preview may return. No serial_number (equipment
 * serials identify the owner's unit) and no Stripe product/price ids: the
 * share pages never read them. part_number stays (shown as the part number).
 */
export const SHARE_LISTING_SELECTS = [
  'id, title, description, status, condition, price, price_type, manufacturer, model, part_number, quantity, qty, listing_type, category, city, state, images, photos, details, created_at, year_manufactured, wavelength, organization_id',
  'id, title, description, status, condition, price, price_type, manufacturer, model, part_number, quantity, listing_type, category, city, state, images, photos, details, created_at, year_manufactured, wavelength',
];

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

    // Sanitize details — drop seller contact if present
    let details = data.details;
    if (details && typeof details === 'object') {
      const d = { ...(details as Record<string, unknown>) };
      delete d.seller_email;
      delete d.seller_phone;
      delete d.contact_email;
      delete d.contact_phone;
      details = d;
    }

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
