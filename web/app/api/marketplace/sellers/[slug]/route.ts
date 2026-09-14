import { NextRequest, NextResponse } from 'next/server';
import { getMarketplaceCaller } from '@/lib/marketplace/caller';
import { isPublicListingStatus } from '@/lib/marketplace/ownership';
import {
  formatListingPrice,
  isPartListing,
  listingAvailability,
  listingImages,
  listingQuantity,
  type MarketplaceListingLike,
} from '@/lib/marketplace/parts';
import {
  isPublicStorefront,
  publicStorefrontContact,
  storefrontAbout,
  storefrontDisplayName,
  storefrontPath,
  supplierGetsFeaturedPlacement,
} from '@/lib/marketplace/storefront';
import { loadPublicStorefrontBySlug } from '@/lib/marketplace/storefront-server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const LISTING_SELECTS = [
  'id, title, description, status, condition, price, price_type, manufacturer, model, serial_number, part_number, quantity, qty, listing_type, category, city, state, images, photos, details, created_at, organization_id',
  'id, title, description, status, condition, price, manufacturer, model, part_number, quantity, listing_type, category, images, details, created_at, organization_id',
];

async function loadOrgParts(orgId: string | number): Promise<MarketplaceListingLike[]> {
  const admin = getSupabaseAdmin();
  for (const cols of LISTING_SELECTS) {
    let res = await admin
      .from('marketplace_listings')
      .select(cols)
      .eq('organization_id', orgId)
      .or('listing_type.eq.part,listing_type.eq.parts')
      .order('created_at', { ascending: false })
      .limit(200);
    if (res.error && /listing_type|column|does not exist/i.test(res.error.message || '')) {
      res = await admin
        .from('marketplace_listings')
        .select(cols)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200);
    }
    if (!res.error && res.data) return res.data as MarketplaceListingLike[];
    if (res.error && !/column|does not exist|schema cache/i.test(res.error.message || '')) break;
  }
  return [];
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> | { slug: string } }
) {
  try {
    const raw = await Promise.resolve(ctx.params);
    const slug = decodeURIComponent(raw?.slug || '').trim().toLowerCase();
    if (!slug) return NextResponse.json({ error: 'Missing seller' }, { status: 400 });
    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'Storefront unavailable' }, { status: 503 });
    }

    const org = await loadPublicStorefrontBySlug(slug);
    if (!org || !isPublicStorefront(org) || org.id == null) {
      return NextResponse.json({ error: 'Storefront not found' }, { status: 404 });
    }

    const caller = await getMarketplaceCaller(req);
    const signedIn = !!caller?.userId;
    const contact = publicStorefrontContact(org, signedIn);
    const rows = await loadOrgParts(org.id);
    const listings = rows
      .filter((row) => isPartListing(row) && isPublicListingStatus(row.status))
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        manufacturer: row.manufacturer,
        model: row.model,
        part_number: row.part_number,
        condition: row.condition,
        images: listingImages(row),
        quantity: listingQuantity(row),
        price_label: formatListingPrice(row),
        availability: listingAvailability(row),
      }));

    return NextResponse.json({
      seller: {
        name: storefrontDisplayName(org),
        slug,
        bio: storefrontAbout(org),
        logo_url: org.logo_url || null,
        featured: supplierGetsFeaturedPlacement(org.type, org),
        href: storefrontPath(slug),
        city: signedIn ? org.city || null : null,
        state: signedIn ? org.state || null : null,
        ...contact,
      },
      listings,
      signedIn,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
