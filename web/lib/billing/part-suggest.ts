/** Unified part-number suggest for PO / invoice / estimate line items. */

export type PartSuggestHit = {
  key: string;
  part_number: string;
  description: string;
  unit_price: number | null;
  source: 'catalog' | 'marketplace';
};

export function fromCatalogRow(row: {
  id?: string | number | null;
  part_number?: string | null;
  name?: string | null;
  description?: string | null;
  brand?: string | null;
  sale_price?: number | string | null;
  unit_cost?: number | string | null;
} | null | undefined): PartSuggestHit | null {
  if (!row) return null;
  const pn = String(row.part_number || '').trim();
  const desc = String(row.name || row.description || '').trim();
  if (!pn && !desc) return null;
  const cost = Number(row.unit_cost);
  const sale = Number(row.sale_price);
  const price = Number.isFinite(cost) && cost > 0 ? cost : Number.isFinite(sale) && sale > 0 ? sale : null;
  const brand = String(row.brand || '').trim();
  return {
    key: `cat-${row.id ?? (pn || desc)}`,
    part_number: pn || desc.slice(0, 48),
    description: [brand, desc].filter(Boolean).join(' · ') || pn,
    unit_price: price,
    source: 'catalog',
  };
}

export function fromMarketplaceRow(row: {
  id?: string | number | null;
  title?: string | null;
  description?: string | null;
  part_number?: string | null;
  manufacturer?: string | null;
  price?: number | string | null;
  details?: Record<string, unknown> | null;
} | null | undefined): PartSuggestHit | null {
  if (!row) return null;
  const details = row.details && typeof row.details === 'object' ? row.details : null;
  const pn = String(row.part_number || details?.sku || '').trim();
  const title = String(row.title || '').trim();
  const desc = title || String(row.description || '').trim();
  if (!pn && !desc) return null;
  const price = Number(row.price);
  const brand = String(row.manufacturer || '').trim();
  return {
    key: `mkt-${row.id ?? (pn || desc)}`,
    part_number: pn || desc.slice(0, 48),
    description: [brand, desc].filter(Boolean).join(' · ') || pn,
    unit_price: Number.isFinite(price) && price > 0 ? price : null,
    source: 'marketplace',
  };
}

export function mergePartSuggests(hits: PartSuggestHit[]): PartSuggestHit[] {
  const seen = new Set<string>();
  const out: PartSuggestHit[] = [];
  const ranked = [...hits].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'catalog' ? -1 : 1;
    return a.part_number.localeCompare(b.part_number);
  });
  for (const h of ranked) {
    const k = h.part_number.trim().toLowerCase();
    if (k) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(h);
  }
  return out;
}

export function filterPartSuggests(hits: PartSuggestHit[], query: string, limit = 12): PartSuggestHit[] {
  const s = query.trim().toLowerCase();
  const pool = !s
    ? hits
    : hits.filter((h) =>
        [h.part_number, h.description].join(' ').toLowerCase().includes(s)
      );
  return mergePartSuggests(pool).slice(0, limit);
}

export function exactPartSuggest(hits: PartSuggestHit[], partNumber: string): PartSuggestHit | null {
  const s = partNumber.trim().toLowerCase();
  if (!s) return null;
  return (
    hits.find((h) => h.source === 'catalog' && h.part_number.trim().toLowerCase() === s) ||
    hits.find((h) => h.part_number.trim().toLowerCase() === s) ||
    null
  );
}

export function sourceLabel(source: PartSuggestHit['source']): string {
  return source === 'marketplace' ? 'Marketplace' : 'Catalog';
}
