/**
 * Country pills for Find clinics. Counts come only from rows the page shows
 * (the server already returned exactly what the caller may see).
 */

export const ALL_COUNTRIES = '__all__';

export type CountryPill = { key: string; country: string | null; count: number };

type HasCountry = { country?: string | null };

function keyFor(country: string | null | undefined): string | null {
  const c = typeof country === 'string' ? country.trim() : '';
  return c ? c : null;
}

/**
 * [All, ...countries by count desc then name]. Rows without a country count
 * toward All only. `weight` lets aggregate rows ({country, count}) be fed in.
 */
export function countryPills<T extends HasCountry>(
  rows: readonly T[],
  weight: (row: T) => number = () => 1,
): CountryPill[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const w = Math.max(0, Number(weight(row)) || 0);
    total += w;
    const k = keyFor(row.country);
    if (k) counts.set(k, (counts.get(k) || 0) + w);
  }
  const pills = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([country, count]) => ({ key: country, country, count }));
  return [{ key: ALL_COUNTRIES, country: null, count: total }, ...pills];
}

export function filterByCountry<T extends HasCountry>(rows: readonly T[], selected: string): T[] {
  if (!selected || selected === ALL_COUNTRIES) return rows.slice();
  return rows.filter((r) => keyFor(r.country) === selected);
}

/** Distinct non-empty cities (case-insensitive), sorted. */
export function cityOptions<T extends { city?: string | null }>(rows: readonly T[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const c = typeof r.city === 'string' ? r.city.trim() : '';
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function filterByCity<T extends { city?: string | null }>(rows: readonly T[], city: string): T[] {
  const want = city.trim().toLowerCase();
  if (!want) return rows.slice();
  return rows.filter((r) => (typeof r.city === 'string' ? r.city.trim().toLowerCase() : '') === want);
}

/** Arrow-key roving focus for a pill row; RTL flips Left/Right. */
export function nextPillIndex(current: number, key: string, length: number, rtl: boolean): number {
  if (length <= 0) return -1;
  const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === fwd) return (current + 1) % length;
  if (key === back) return (current - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return current;
}
