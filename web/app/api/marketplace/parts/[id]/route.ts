import { NextRequest, NextResponse } from 'next/server';
import {
  loadMarketplaceListing,
  resolveSellerName,
  StripeMarketplaceError,
} from '@/lib/billing/stripe-marketplace';
import {
  formatListingPrice,
  isPartListing,
  listingAvailability,
  listingImages,
  listingQuantity,
  partsDetailPath,
} from '@/lib/marketplace/parts';

export const dynamic = 'force-dynamic';

function sanitizeDetails(details: unknown) {
  if (!details || typeof details !== 'object') return details;
  const d = { ...(details as Record<string, unknown>) };
  delete d.seller_email;
  delete d.seller_phone;
  delete d.contact_email;
  delete d.contact_phone;
  return d;
}

/**
 * Public parts product payload (logged-out viewers can open a deep link).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const raw = await Promise.resolve(ctx.params);
    const id = raw?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const listing = await loadMarketplaceListing(id);
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    if (!isPartListing(listing)) {
      return NextResponse.json(
        { error: 'This listing is not a parts-for-sale item', listing_type: listing.listing_type },
        { status: 404 }
      );
    }

    const availability = listingAvailability(listing);
    const sellerName = await resolveSellerName(listing);
    const details = sanitizeDetails(listing.details);

    return NextResponse.json({
      listing: {
        ...listing,
        details,
        images: listingImages(listing),
        seller_id: undefined,
        created_by: undefined,
        organization_id: undefined,
        seller_name: sellerName,
        quantity: listingQuantity(listing),
      },
      availability,
      price_label: formatListingPrice(listing),
      path: partsDetailPath(id),
    });
  } catch (e: unknown) {
    const status = e instanceof StripeMarketplaceError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[marketplace/parts GET]', e);
    return NextResponse.json({ error: message }, { status });
  }
}
