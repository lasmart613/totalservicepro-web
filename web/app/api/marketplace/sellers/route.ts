import { NextResponse } from 'next/server';
import {
  isPublicStorefront,
  sortFeaturedSellersFirst,
  toPublicSellerCard,
} from '@/lib/marketplace/storefront';
import { loadEnabledStorefronts } from '@/lib/marketplace/storefront-server';
import { hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Public list of enabled Premium/Team storefronts. Featured (Team) first. */
export async function GET() {
  try {
    if (!hasServiceRole()) {
      return NextResponse.json({ sellers: [], error: 'Catalog unavailable' }, { status: 503 });
    }
    const orgs = await loadEnabledStorefronts();
    const sellers = sortFeaturedSellersFirst(
      orgs.filter((org) => isPublicStorefront(org)).map((org) => toPublicSellerCard(org)!).filter(Boolean)
    );
    return NextResponse.json({ sellers });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ sellers: [], error: message }, { status: 500 });
  }
}
