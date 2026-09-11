import { NextRequest, NextResponse } from 'next/server';
import {
  loadMarketplaceListing,
  resolveSellerName,
  StripeMarketplaceError,
} from '@/lib/billing/stripe-marketplace';
import { getMarketplaceCaller } from '@/lib/marketplace/caller';
import {
  buildListingRemovePayload,
  buildListingUpdatePayload,
  sanitizeListingDetails,
} from '@/lib/marketplace/manage-listing';
import { canManageMarketplaceListing, isPublicListingStatus } from '@/lib/marketplace/ownership';
import {
  formatListingPrice,
  isPartListing,
  listingAvailability,
  listingImages,
  listingQuantity,
  partsDetailPath,
  type MarketplaceListingLike,
} from '@/lib/marketplace/parts';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type ListingRow = MarketplaceListingLike & {
  id: string;
  title?: string;
  seller_id?: string | null;
  created_by?: string | null;
  organization_id?: string | number | null;
};

async function listingParams(ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const raw = await Promise.resolve(ctx.params);
  return raw?.id || '';
}

function publicListingPayload(listing: ListingRow, sellerName: string | null, canManage: boolean) {
  return {
    ...listing,
    details: sanitizeListingDetails(listing.details),
    images: listingImages(listing),
    seller_id: canManage ? listing.seller_id : undefined,
    created_by: canManage ? listing.created_by : undefined,
    organization_id: canManage ? listing.organization_id : undefined,
    seller_name: sellerName,
    quantity: listingQuantity(listing),
  };
}

/**
 * Public parts product payload (logged-out viewers can open a deep link).
 * Owners / supplier org admins also get can_manage and can see removed rows.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const id = await listingParams(ctx);
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const listing = (await loadMarketplaceListing(id)) as ListingRow | null;
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    if (!isPartListing(listing)) {
      return NextResponse.json(
        { error: 'This listing is not a parts-for-sale item', listing_type: listing.listing_type },
        { status: 404 }
      );
    }

    const caller = await getMarketplaceCaller(req);
    const canManage = canManageMarketplaceListing(listing, caller || {});
    if (!isPublicListingStatus(listing.status) && !canManage) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    const availability = listingAvailability(listing);
    const sellerName = await resolveSellerName(listing);

    return NextResponse.json({
      listing: publicListingPayload(listing, sellerName, canManage),
      availability,
      price_label: formatListingPrice(listing),
      path: partsDetailPath(id),
      can_manage: canManage,
    });
  } catch (e: unknown) {
    const status = e instanceof StripeMarketplaceError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[marketplace/parts GET]', e);
    return NextResponse.json({ error: message }, { status });
  }
}

async function requireManager(
  req: NextRequest,
  id: string
): Promise<{ listing: ListingRow } | NextResponse> {
  const caller = await getMarketplaceCaller(req);
  if (!caller) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  if (!hasServiceRole()) {
    return NextResponse.json(
      { error: 'Listing updates unavailable', hint: 'Add SUPABASE_SERVICE_ROLE_KEY to Netlify.' },
      { status: 503 }
    );
  }
  const listing = (await loadMarketplaceListing(id)) as ListingRow | null;
  if (!listing || !isPartListing(listing)) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }
  if (!canManageMarketplaceListing(listing, caller)) {
    return NextResponse.json({ error: 'You cannot edit this listing' }, { status: 403 });
  }
  return { listing };
}

/**
 * Seller / supplier-org admin: edit title, description, price, photos, part #, etc.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const id = await listingParams(ctx);
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const gate = await requireManager(req, id);
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = buildListingUpdatePayload(body, { details: gate.listing.details });
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('marketplace_listings')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) {
      console.error('[marketplace/parts PATCH]', error);
      return NextResponse.json({ error: error.message || 'Could not update listing' }, { status: 500 });
    }

    const listing = (data || { ...gate.listing, ...patch, id }) as ListingRow;
    if (isPartListing(listing) && listingAvailability(listing).purchasable) {
      fetch(
        `${req.nextUrl.origin}/api/marketplace/parts/${encodeURIComponent(id)}/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncOnly: true }),
        }
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      listing: {
        ...listing,
        details: sanitizeListingDetails(listing.details),
        images: listingImages(listing),
        quantity: listingQuantity(listing),
      },
      can_manage: true,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[marketplace/parts PATCH]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Seller / supplier-org admin: soft-remove so the listing leaves the public catalog.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const id = await listingParams(ctx);
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const gate = await requireManager(req, id);
    if (gate instanceof NextResponse) return gate;

    const patch = buildListingRemovePayload();
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('marketplace_listings').update(patch).eq('id', id);
    if (error) {
      console.error('[marketplace/parts DELETE]', error);
      return NextResponse.json({ error: error.message || 'Could not remove listing' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      id,
      status: 'removed',
      message: 'Listing removed from the public marketplace',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[marketplace/parts DELETE]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
