import { NextRequest, NextResponse } from 'next/server';
import { getMarketplaceCaller } from '@/lib/marketplace/caller';
import { canManageMarketplaceListing, isPublicListingStatus } from '@/lib/marketplace/ownership';
import {
  formatListingPrice,
  isPartListing,
  listingAvailability,
  listingImages,
  listingQuantity,
  listingSellerName,
  type MarketplaceListingLike,
} from '@/lib/marketplace/parts';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const SELECTS = [
  'id, title, description, status, condition, price, price_type, manufacturer, model, serial_number, part_number, quantity, qty, listing_type, category, city, state, images, photos, details, created_at, seller_id, created_by, organization_id',
  'id, title, description, status, condition, price, manufacturer, model, serial_number, part_number, quantity, listing_type, category, images, details, created_at, seller_id, created_by, organization_id',
  'id, title, description, status, condition, price, manufacturer, model, serial_number, part_number, quantity, listing_type, category, images, details, created_at',
];

async function loadPartRows(): Promise<{ rows: MarketplaceListingLike[]; error: { message?: string } | null }> {
  const admin = getSupabaseAdmin();
  let rows: MarketplaceListingLike[] = [];
  let error: { message?: string } | null = null;
  for (const cols of SELECTS) {
    const q = admin
      .from('marketplace_listings')
      .select(cols)
      .or('listing_type.eq.part,listing_type.eq.parts')
      .order('created_at', { ascending: false })
      .limit(200);
    let res = await q;
    if (res.error && /listing_type|column|does not exist/i.test(res.error.message || '')) {
      res = await admin
        .from('marketplace_listings')
        .select(cols)
        .order('created_at', { ascending: false })
        .limit(200);
    }
    error = res.error;
    if (!res.error && res.data) {
      rows = res.data as MarketplaceListingLike[];
      break;
    }
    if (res.error && !/column|does not exist|schema cache/i.test(res.error.message || '')) break;
  }
  return { rows, error };
}

function publicize(row: MarketplaceListingLike, canManage: boolean) {
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
    seller_id: canManage ? row.seller_id : undefined,
    created_by: canManage ? row.created_by : undefined,
    organization_id: canManage ? row.organization_id : undefined,
    seller_name: listingSellerName(row),
    quantity: listingQuantity(row),
    price_label: formatListingPrice(row),
    availability: listingAvailability(row),
    can_manage: canManage,
  };
}

/**
 * Public catalog of parts-for-sale (no RFQs / consumables / used systems).
 * ?mine=1 returns the caller's (and their supplier org's) listings, including removed.
 */
export async function GET(req: NextRequest) {
  try {
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'Catalog unavailable', listings: [] },
        { status: 503 }
      );
    }
    const mine = req.nextUrl.searchParams.get('mine') === '1';
    const caller = mine ? await getMarketplaceCaller(req) : null;
    if (mine && !caller) {
      return NextResponse.json({ error: 'Sign in required', listings: [] }, { status: 401 });
    }

    const { rows, error } = await loadPartRows();
    if (error && !rows.length) {
      return NextResponse.json({ error: error.message, listings: [] }, { status: 500 });
    }

    const listings = rows
      .filter(isPartListing)
      .filter((row) => {
        if (mine && caller) return canManageMarketplaceListing(row, caller);
        return isPublicListingStatus(row.status);
      })
      .map((row) => publicize(row, !!(mine && caller && canManageMarketplaceListing(row, caller))));

    return NextResponse.json({ listings, mine: !!mine });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[marketplace/parts list]', e);
    return NextResponse.json({ error: message, listings: [] }, { status: 500 });
  }
}
