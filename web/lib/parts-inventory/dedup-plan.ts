/**
 * Reviewable plan for duplicate normalized MPNs within one manufacturer.
 * Does not delete rows. Conflicting descriptions are flagged, not merged.
 */

export type CatalogDedupRow = {
  id: number | string;
  brand: string | null;
  mpn_normalized: string;
  part_number?: string | null;
  name?: string | null;
  description?: string | null;
};

export type DedupFk = 'part_vendors' | 'part_catalog_availability' | 'organization_parts' | 'device_bom' | 'inventory_stock' | 'inventory_transactions';

export type DedupGroupPlan = {
  brand: string;
  mpn_normalized: string;
  action: 'keep' | 'merge_ready' | 'review';
  keeper_id: number | string | null;
  loser_ids: Array<number | string>;
  remap: { table: DedupFk; from_id: number | string; to_id: number | string }[];
  conflicts: string[];
};

const FK_TABLES: DedupFk[] = [
  'part_vendors',
  'part_catalog_availability',
  'organization_parts',
  'device_bom',
  'inventory_stock',
  'inventory_transactions',
];

function textOf(row: CatalogDedupRow): string {
  return String(row.description || row.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function planMpnDedup(rows: CatalogDedupRow[]): DedupGroupPlan[] {
  const groups = new Map<string, CatalogDedupRow[]>();
  for (const row of rows) {
    const mpn = String(row.mpn_normalized || '').trim();
    const brand = String(row.brand || '').trim().toLowerCase();
    if (!mpn || !brand) continue;
    const key = `${brand}|${mpn}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  const plans: DedupGroupPlan[] = [];
  for (const [key, list] of groups) {
    const [brand, mpn] = key.split('|');
    const ordered = [...list].sort((a, b) => Number(a.id) - Number(b.id));
    if (ordered.length < 2) {
      plans.push({
        brand,
        mpn_normalized: mpn,
        action: 'keep',
        keeper_id: ordered[0]?.id ?? null,
        loser_ids: [],
        remap: [],
        conflicts: [],
      });
      continue;
    }
    const keeper = [...ordered].sort((a, b) => textOf(b).length - textOf(a).length || Number(a.id) - Number(b.id))[0];
    const keeperText = textOf(keeper);
    const conflicts = ordered
      .filter((row) => row.id !== keeper.id)
      .map((row) => textOf(row))
      .filter((value) => value && value !== keeperText);
    const losers = ordered.filter((row) => row.id !== keeper.id);
    const action = conflicts.length ? 'review' : 'merge_ready';
    plans.push({
      brand,
      mpn_normalized: mpn,
      action,
      keeper_id: keeper.id,
      loser_ids: losers.map((row) => row.id),
      remap:
        action === 'merge_ready'
          ? losers.flatMap((row) => FK_TABLES.map((table) => ({ table, from_id: row.id, to_id: keeper.id })))
          : [],
      conflicts,
    });
  }
  return plans.sort((a, b) => a.brand.localeCompare(b.brand) || a.mpn_normalized.localeCompare(b.mpn_normalized));
}
