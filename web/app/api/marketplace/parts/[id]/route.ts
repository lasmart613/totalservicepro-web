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
import { listingPhotoCount, listingPhotoLimit, listingPhotoLimitError } from '@/lib/marketplace/storefront';
import { resolveListingStorefront } from '@/lib/marketplace/storefront-server';
import { listingOrgIdVisibleToViewer } from '@/lib/billing/listing-invoice';
import { stripPrivatePartFields, viewerSeesPartSerial } from '@/lib/marketplace/part-public';
import type { MarketplaceCaller } from '@/lib/marketplace/caller';

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

function publicListingPayload(
  listing: ListingRow,
  sellerName: string | null,
  canManage: boolean,
  caller: MarketplaceCaller | null
) {
  const viewerOrgId = caller?.orgId;
  // No Stripe ids; serial only for the seller org's members; details sanitized.
  const safe = stripPrivatePartFields(
    listing as ListingRow & Record<string, unknown>,
    viewerSeesPartSerial(listing, caller)
  );
  return {
    ...safe,
    details: sanitizeListingDetails(safe.details),
    images: listingImages(listing),
    seller_id: canManage ? listing.seller_id : undefined,
    created_by: canManage ? listing.created_by : undefined,
    organization_id: canManage
      ? listing.organization_id
      : listingOrgIdVisibleToViewer(listing.organization_id, viewerOrgId),
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
    const sellerStorefront = await resolveListingStorefront(listing.organization_id);

    return NextResponse.json({
      listing: publicListingPayload(listing, sellerName, canManage, caller),
      availability,
      price_label: formatListingPrice(listing),
      path: partsDetailPath(id),
      can_manage: canManage,
      seller_storefront: sellerStorefront,
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
    // Photo cap by plan (Free 1, paid 8). Existing over-cap listings are
    // grandfathered: only an edit that ADDS photos past the cap is refused.
    const patchRec = patch as Record<string, unknown>;
    if ('images' in patchRec || 'photos' in patchRec) {
      const newCount = listingPhotoCount(patchRec as { images?: unknown; photos?: unknown });
      const oldCount = listingPhotoCount(gate.listing as { images?: unknown; photos?: unknown });
      const orgId = (gate.listing as { organization_id?: string | number | null }).organization_id;
      let limit = listingPhotoLimit(null);
      if (orgId != null) {
        const { data: org, error: orgErr } = await admin
          .from('organizations')
          .select('is_premium, subscription_tier, plan, premium_until, premium_grant')
          .eq('id', orgId)
          .maybeSingle();
        if (orgErr) return NextResponse.json({ error: 'Could not check your plan. Try again.' }, { status: 503 });
        limit = listingPhotoLimit(org);
      }
      const photoErr = newCount > oldCount ? listingPhotoLimitError(newCount, limit) : null;
      if (photoErr) {
        return NextResponse.json({ error: photoErr, photo_limit: limit, upgrade_url: '/plans' }, { status: 403 });
      }
    }
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
        // Manager response: serial kept, Stripe ids still dropped.
        ...stripPrivatePartFields(listing as ListingRow & Record<string, unknown>, true),
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
