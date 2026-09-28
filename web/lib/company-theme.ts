/**
 * Company brand colors for invoices, estimates, service reports, and
 * customer emails. One resolver: getCompanyTheme(orgId).
 *
 * Free organizations always receive the RepairPlanet fallback, even when
 * color columns are populated. Text on a brand color is white or ink,
 * whichever meets the higher WCAG contrast ratio.
 */

import { orgIsPaid, type OrgPlanFields } from './org-plan.ts';

export const TEXT_LIGHT = '#FFFFFF';
export const TEXT_DARK = '#111827';

export type ContrastText = typeof TEXT_LIGHT | typeof TEXT_DARK;

export type CompanyTheme = {
  primary: string;
  accent: string;
  onPrimary: ContrastText;
  onAccent: ContrastText;
  logoUrl: string | null;
  companyName: string;
  /** True only when a paid org has at least one stored brand color. */
  branded: boolean;
};

export type BrandColorPreset = {
  id: string;
  label: string;
  primary: string;
  accent: string;
};

/** Six starting palettes. RepairPlanet ink + gold is the first. */
export const BRAND_COLOR_PRESETS: readonly BrandColorPreset[] = [
  { id: 'midnight-gold', label: 'Midnight Gold', primary: '#111827', accent: '#FBBF24' },
  { id: 'ocean', label: 'Ocean', primary: '#0C4A6E', accent: '#38BDF8' },
  { id: 'forest', label: 'Forest', primary: '#14532D', accent: '#86EFAC' },
  { id: 'crimson', label: 'Crimson', primary: '#7F1D1D', accent: '#FB7185' },
  { id: 'violet', label: 'Violet', primary: '#4C1D95', accent: '#C4B5FD' },
  { id: 'copper', label: 'Copper', primary: '#3F2E23', accent: '#E8A87C' },
];

export const REPAIR_PLANET_THEME: CompanyTheme = {
  primary: '#111827',
  accent: '#FBBF24',
  onPrimary: TEXT_LIGHT,
  onAccent: TEXT_DARK,
  logoUrl: null,
  companyName: 'Total Service Pro',
  branded: false,
};

export type CompanyThemeSource = OrgPlanFields & {
  name?: string | null;
  company_name?: string | null;
  logo_url?: string | null;
  brand_primary_color?: string | null;
  brand_accent_color?: string | null;
};

const THEME_SELECTS = [
  'name, logo_url, brand_primary_color, brand_accent_color, is_premium, subscription_tier, plan, premium_until, premium_grant',
  'name, logo_url, is_premium, subscription_tier, plan, premium_until, premium_grant',
  'name, logo_url, is_premium, subscription_tier, plan',
  'name, logo_url, is_premium',
  'logo_url, is_premium',
  'is_premium',
] as const;

type MaybeSingleResult = Promise<{
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
}>;

export type CompanyThemeClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string | number
      ) => {
        maybeSingle: () => MaybeSingleResult;
      };
    };
  };
};

export function normalizeHex(value: unknown): string | null {
  let raw = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (!raw) return null;
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    raw = raw
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

export function hexToRgb(value: unknown): { r: number; g: number; b: number } | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function channelLuminance(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(value: unknown): number {
  const rgb = hexToRgb(value);
  if (!rgb) return 0;
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** WCAG contrast ratio between two colors (1 to 21). */
export function contrastRatio(a: unknown, b: unknown): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastCheck = {
  text: ContrastText;
  ratio: number;
  /** Normal text AA is 4.5:1. */
  aa: boolean;
  /** Normal text AAA is 7:1. */
  aaa: boolean;
};

/**
 * Pick white or RepairPlanet ink, whichever contrasts more with the background.
 * AA/AAA flags describe that chosen pair.
 */
export function contrastCheck(background: unknown): ContrastCheck {
  const bg = normalizeHex(background) || TEXT_DARK;
  const white = contrastRatio(TEXT_LIGHT, bg);
  const dark = contrastRatio(TEXT_DARK, bg);
  const text: ContrastText = white >= dark ? TEXT_LIGHT : TEXT_DARK;
  const ratio = text === TEXT_LIGHT ? white : dark;
  const rounded = Math.round(ratio * 100) / 100;
  return {
    text,
    ratio: rounded,
    aa: ratio >= 4.5,
    aaa: ratio >= 7,
  };
}

export function pickContrastText(background: unknown): ContrastText {
  return contrastCheck(background).text;
}

/** Accent paint on a colored bar. Falls back when the pair misses AA. */
export function readableOn(color: string, background: string, fallback: ContrastText): string {
  return contrastRatio(color, background) >= 4.5 ? color : fallback;
}

export type ThemeScope = 'document' | 'email';

/** Section rules follow the accent on documents. Emails keep the RepairPlanet gold rule. */
export function themeAccentForScope(
  theme: CompanyTheme | null | undefined,
  scope?: ThemeScope | null
): string {
  if (theme?.branded && scope !== 'email') return theme.accent;
  return '#FBBF24';
}

/** Paid plan check used by the branding UI and by document rendering. */
export function companyBrandingEnabled(org: OrgPlanFields | null | undefined): boolean {
  return orgIsPaid(org);
}

export function resolveCompanyTheme(org: CompanyThemeSource | null | undefined): CompanyTheme {
  const logoUrl = String(org?.logo_url || '').trim() || null;
  const companyName =
    String(org?.name || org?.company_name || '').trim() || REPAIR_PLANET_THEME.companyName;
  const base: CompanyTheme = {
    ...REPAIR_PLANET_THEME,
    logoUrl,
    companyName,
    branded: false,
  };
  if (!companyBrandingEnabled(org)) return base;
  const primary = normalizeHex(org?.brand_primary_color);
  const accent = normalizeHex(org?.brand_accent_color);
  if (!primary && !accent) return base;
  const chosenPrimary = primary || REPAIR_PLANET_THEME.primary;
  const chosenAccent = accent || REPAIR_PLANET_THEME.accent;
  return {
    primary: chosenPrimary,
    accent: chosenAccent,
    onPrimary: pickContrastText(chosenPrimary),
    onAccent: pickContrastText(chosenAccent),
    logoUrl,
    companyName,
    branded: true,
  };
}

function missingThemeColumn(message?: string): boolean {
  return /brand_primary_color|brand_accent_color|subscription_tier|premium_until|premium_grant|\bplan\b|logo_url|\bname\b|column/i.test(
    message || ''
  );
}

/**
 * Load one organization's theme. Missing color columns fall back to
 * RepairPlanet. Unknown or empty ids do too.
 */
export async function getCompanyTheme(
  orgId: string | number | null | undefined,
  client: CompanyThemeClient
): Promise<CompanyTheme> {
  if (orgId == null || String(orgId).trim() === '') return { ...REPAIR_PLANET_THEME };
  let lastError: { message?: string } | null = null;
  for (const columns of THEME_SELECTS) {
    const { data, error } = await client
      .from('organizations')
      .select(columns)
      .eq('id', orgId)
      .maybeSingle();
    if (!error) return resolveCompanyTheme((data || null) as CompanyThemeSource | null);
    lastError = error;
    if (!missingThemeColumn(error.message)) break;
  }
  if (lastError?.message) {
    console.warn('[company-theme] organizations brand columns unavailable', lastError.message);
  }
  return { ...REPAIR_PLANET_THEME };
}

export type SuggestedBrandColors = {
  primary: string;
  accent: string;
};

function quantizeChannel(channel: number): number {
  return Math.round(channel / 16) * 16;
}

/**
 * Two dominant colors from raw RGBA pixels. Near-white and near-black
 * pixels are ignored so a logo's paper background does not win.
 */
export function suggestBrandColorsFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number
): SuggestedBrandColors | null {
  if (!data || width < 1 || height < 1) return null;
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const step = Math.max(1, Math.floor((width * height) / 4000));
  for (let i = 0; i < width * height; i += step) {
    const offset = i * 4;
    const a = data[offset + 3];
    if (a < 128) continue;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const lum = relativeLuminance(
      `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
    );
    if (lum > 0.92 || lum < 0.04) continue;
    const qr = Math.min(255, quantizeChannel(r));
    const qg = Math.min(255, quantizeChannel(g));
    const qb = Math.min(255, quantizeChannel(b));
    const key = `${qr},${qg},${qb}`;
    const prev = buckets.get(key);
    if (prev) prev.count += 1;
    else buckets.set(key, { count: 1, r: qr, g: qg, b: qb });
  }
  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (!ranked.length) return null;
  const toHex = (c: { r: number; g: number; b: number }) =>
    `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  const primary = ranked[0];
  const accent =
    ranked.find((c, index) => {
      if (index === 0) return false;
      const dist = Math.abs(c.r - primary.r) + Math.abs(c.g - primary.g) + Math.abs(c.b - primary.b);
      return dist >= 48;
    }) || ranked[1] || null;
  if (!accent) return null;
  return { primary: toHex(primary), accent: toHex(accent) };
}

/** Browser-only. Returns null when the image cannot be read (CORS or decode). */
export async function suggestBrandColorsFromUrl(src: string): Promise<SuggestedBrandColors | null> {
  if (typeof document === 'undefined' || !src) return null;
  try {
    const image = await loadImage(src);
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data;
    return suggestBrandColorsFromPixels(pixels, size, size);
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('logo image failed'));
    image.src = src;
  });
}
