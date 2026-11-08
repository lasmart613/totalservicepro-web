/**
 * Manufacturer part numbers are matched after normalization so the same
 * part is not entered twice (spaces, dashes, and case do not create a new row).
 */

export function normalizeMpn(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function mpnKey(brand: string | null | undefined, mpn: string | null | undefined): string {
  return `${String(brand || '').trim().toLowerCase()}|${normalizeMpn(mpn)}`;
}
