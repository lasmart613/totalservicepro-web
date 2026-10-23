/** Drop Stripe ids (productId, priceId and any *stripe* key) from a sync result before it leaves the server. */
export function publicCatalogFields(catalog: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!catalog || typeof catalog !== 'object') return out;
  for (const [k, v] of Object.entries(catalog as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (key === 'productid' || key === 'priceid' || key.includes('stripe')) continue;
    out[k] = v;
  }
  return out;
}
