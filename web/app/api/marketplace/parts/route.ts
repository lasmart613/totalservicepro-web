import { NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  formatListingPrice,
  isPartListing,
  listingAvailability,
  listingImages,
  listingQuantity,
  listingSellerName,
  type MarketplaceListingLike,
} from '@/lib/marketplace/parts';

export const dynamic = 'force-dynamic';

const SELECTS = [
  'id, title, description, status, condition, price, price_type, manufacturer, model, serial_number, part_number, quantity, qty, listing_type, category, city, state, images, photos, details, created_at',
  'id, title, description, status, condition, price, manufacturer, model, serial_number, part_number, quantity, listing_type, category, images, details, created_at',
];

/**
 * Public catalog of parts-for-sale (no RFQs / consumables / used systems).
 */
export async function GET() {
  try {
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'Catalog unavailable', listings: [] },
        { status: 503 }
      );
    }
    const admin = getSupabaseAdmin();
    let rows: MarketplaceListingLike[] = [];
    let error: { message?: string } | null = null;
    for (const cols of SELECTS) {
      const q = admin
        .from('marketplace_listings')
        .select(cols)
        .or('listing_type.eq.part,listing_type.eq.parts')
        .order('created_at', { ascending: false })
        .limit(100);
      let res = await q;
      if (res.error && /listing_type|column|does not exist/i.test(res.error.message || '')) {
        res = await admin
          .from('marketplace_listings')
          .select(cols)
          .order('created_at', { ascending: false })
          .limit(100);
      }
      error = res.error;
      if (!res.error && res.data) {
        rows = res.data as MarketplaceListingLike[];
        break;
      }
      if (res.error && !/column|does not exist|schema cache/i.test(res.error.message || '')) break;
    }
    if (error && !rows.length) {
      return NextResponse.json({ error: error.message, listings: [] }, { status: 500 });
    }

    const listings = rows.filter(isPartListing).map((row) => {
      const details =
        row.details && typeof row.details === 'object' ? { ...row.details } : row.details;
      if (details && typeof details === 'object') {
        const clean = details as Record<string, unknown>;
        delete clean.seller_email;
        delete clean.seller_phone;
        delete clean.contact_email;
        delete clean.contact_phone;
      }
      return {
        ...row,
        details,
        images: listingImages(row),
        seller_id: undefined,
        created_by: undefined,
        organization_id: undefined,
        seller_name: listingSellerName(row),
        quantity: listingQuantity(row),
        price_label: formatListingPrice(row),
        availability: listingAvailability(row),
      };
    });

    return NextResponse.json({ listings });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[marketplace/parts list]', e);
    return NextResponse.json({ error: message, listings: [] }, { status: 500 });
  }
}
