import { NextResponse } from 'next/server';
import { isMarketplaceCheckoutEnabled } from '@/lib/marketplace/checkout-pause';

export const dynamic = 'force-dynamic';

/** Public, read-only: is marketplace part checkout open? No secrets, no DB. */
export async function GET() {
  return NextResponse.json(
    { checkoutEnabled: isMarketplaceCheckoutEnabled() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
