/**
 * Country list for organizations.country (000929). The database stores the
 * full English name; the ISO code is only used to localize the label with
 * Intl.DisplayNames. Keep names identical to the backfill one-off
 * ('United States', 'United Arab Emirates', ...).
 */

export const COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'AR', name: 'Argentina' }, { code: 'AU', name: 'Australia' }, { code: 'AT', name: 'Austria' },
  { code: 'BH', name: 'Bahrain' }, { code: 'BE', name: 'Belgium' }, { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' }, { code: 'CL', name: 'Chile' }, { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' }, { code: 'CR', name: 'Costa Rica' }, { code: 'CZ', name: 'Czechia' },
  { code: 'DK', name: 'Denmark' }, { code: 'DO', name: 'Dominican Republic' }, { code: 'EG', name: 'Egypt' },
  { code: 'FI', name: 'Finland' }, { code: 'FR', name: 'France' }, { code: 'DE', name: 'Germany' },
  { code: 'GR', name: 'Greece' }, { code: 'HK', name: 'Hong Kong' }, { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' }, { code: 'IR', name: 'Iran' }, { code: 'IQ', name: 'Iraq' },
  { code: 'IE', name: 'Ireland' }, { code: 'IL', name: 'Israel' }, { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' }, { code: 'JO', name: 'Jordan' }, { code: 'KW', name: 'Kuwait' },
  { code: 'LB', name: 'Lebanon' }, { code: 'MY', name: 'Malaysia' }, { code: 'MX', name: 'Mexico' },
  { code: 'MA', name: 'Morocco' }, { code: 'NL', name: 'Netherlands' }, { code: 'NZ', name: 'New Zealand' },
  { code: 'NG', name: 'Nigeria' }, { code: 'NO', name: 'Norway' }, { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' }, { code: 'PA', name: 'Panama' }, { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' }, { code: 'PL', name: 'Poland' }, { code: 'PT', name: 'Portugal' },
  { code: 'PR', name: 'Puerto Rico' }, { code: 'QA', name: 'Qatar' }, { code: 'RO', name: 'Romania' },
  { code: 'SA', name: 'Saudi Arabia' }, { code: 'SG', name: 'Singapore' }, { code: 'ZA', name: 'South Africa' },
  { code: 'KR', name: 'South Korea' }, { code: 'ES', name: 'Spain' }, { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' }, { code: 'TW', name: 'Taiwan' }, { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Turkey' }, { code: 'AE', name: 'United Arab Emirates' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' }, { code: 'VE', name: 'Venezuela' }, { code: 'VN', name: 'Vietnam' },
];

const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));

/** Trimmed known English name, or null. Unknown free text is dropped. */
export function normalizeCountryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const hit = BY_NAME.get(raw.trim().toLowerCase());
  return hit ? hit.name : null;
}

export function countryCode(name: string | null | undefined): string | null {
  if (!name) return null;
  return BY_NAME.get(String(name).trim().toLowerCase())?.code ?? null;
}

/** Label in the UI language when Intl supports it; the English name otherwise. */
export function countryLabel(name: string, locale: string = 'en'): string {
  const code = countryCode(name);
  if (!code || locale === 'en') return name;
  try {
    const dn = new Intl.DisplayNames([locale], { type: 'region' });
    return dn.of(code) || name;
  } catch {
    return name;
  }
}

/** Options sorted by the localized label. value is always the English name. */
export function countryOptions(locale: string = 'en'): { value: string; label: string }[] {
  const out = COUNTRIES.map((c) => ({ value: c.name, label: countryLabel(c.name, locale) }));
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(locale);
  } catch {
    collator = new Intl.Collator('en');
  }
  return out.sort((a, b) => collator.compare(a.label, b.label));
}
