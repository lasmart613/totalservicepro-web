/**
 * Helpers for Stripe subscription products that already exist on the
 * RepairPlanet account. This file does not name plans or set dollar amounts.
 */

export type LivePlanPrice = {
  priceId: string;
  productId: string;
  name: string;
  unitAmountCents: number;
  currency: string;
  interval: 'day' | 'week' | 'month' | 'year' | string;
  lookupKey: string | null;
};

export function isStripePriceId(value: unknown): boolean {
  return /^price_[A-Za-z0-9]+$/.test(String(value || '').trim());
}

/** Marketplace listing prices are one-off products, not org plans. */
export function isMarketplaceStripeMeta(
  metadata: Record<string, string | undefined> | null | undefined
): boolean {
  if (!metadata) return false;
  if (metadata.marketplace_listing_id) return true;
  if (metadata.marketplace_kind) return true;
  if (metadata.source === 'repairplanet_marketplace') return true;
  return false;
}

export function formatStripeMoney(unitAmountCents: number, currency = 'usd'): string {
  const amount = Number(unitAmountCents) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `$${(amount / 100).toFixed(2)}`;
  }
}

type StripePriceLike = {
  id?: string;
  active?: boolean;
  type?: string;
  unit_amount?: number;
  currency?: string;
  lookup_key?: string | null;
  recurring?: { interval?: string } | null;
  metadata?: Record<string, string | undefined> | null;
  product?: string | { id?: string; name?: string; metadata?: Record<string, string | undefined> } | null;
};

export function livePlanFromStripePrice(price: StripePriceLike | null | undefined): LivePlanPrice | null {
  if (!price?.id || !isStripePriceId(price.id)) return null;
  if (price.active === false) return null;
  if (price.type && price.type !== 'recurring') return null;
  const interval = price.recurring?.interval;
  if (!interval) return null;
  const product = typeof price.product === 'object' && price.product ? price.product : null;
  if (isMarketplaceStripeMeta(price.metadata) || isMarketplaceStripeMeta(product?.metadata || null)) {
    return null;
  }
  const amount = Number(price.unit_amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const productId = typeof price.product === 'string' ? price.product : String(product?.id || '');
  const name = String(product?.name || productId || 'Subscription').slice(0, 120);
  return {
    priceId: String(price.id),
    productId,
    name,
    unitAmountCents: amount,
    currency: String(price.currency || 'usd'),
    interval,
    lookupKey: price.lookup_key ? String(price.lookup_key) : null,
  };
}

export function formatStripeInterval(interval: string): string {
  const i = String(interval || '').toLowerCase();
  if (i === 'month') return '/ month';
  if (i === 'year') return '/ year';
  if (i === 'week') return '/ week';
  if (i === 'day') return '/ day';
  return i ? `/ ${i}` : '';
}
