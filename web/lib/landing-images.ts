/** Intrinsic sizes for public/landing stills. Used for CLS + srcset. */
export const LANDING_SHOT_SIZE: Record<string, { width: number; height: number }> = {
  '/landing/dashboard.webp': { width: 1400, height: 860 },
  '/landing/directory.webp': { width: 1400, height: 1070 },
  '/landing/marketplace.webp': { width: 1400, height: 1070 },
  '/landing/parts.webp': { width: 1400, height: 980 },
  '/landing/reports.webp': { width: 1400, height: 900 },
  '/landing/schedule.webp': { width: 1400, height: 1180 },
  '/landing/team-equipment.webp': { width: 1400, height: 720 },
  '/landing/ticket-assign.webp': { width: 1400, height: 860 },
  '/landing/app-calcs.webp': { width: 390, height: 844 },
  '/landing/app-hub.webp': { width: 390, height: 844 },
  '/landing/app-reports.webp': { width: 390, height: 844 },
};

const PHONE_FILE = /^app-.*\.webp$/;

/** Product stills that have a Farsi, Spanish, and French version. Photos and store badges stay shared. */
const LOCALIZED_LANDING_SHOTS = new Set([
  '/landing/dashboard.webp',
  '/landing/directory.webp',
  '/landing/marketplace.webp',
  '/landing/parts.webp',
  '/landing/reports.webp',
  '/landing/schedule.webp',
  '/landing/team-equipment.webp',
  '/landing/ticket-assign.webp',
  '/landing/app-calcs.webp',
  '/landing/app-hub.webp',
]);

export type LandingShotLocale = 'en' | 'fa' | 'es' | 'fr';

/** English path, or the same file under /landing/fa|es|fr when that language is open. */
export function localizedLandingSrc(src: string, locale: LandingShotLocale): string {
  if (locale === 'en' || !LOCALIZED_LANDING_SHOTS.has(src)) return src;
  return `/landing/${locale}/${src.slice('/landing/'.length)}`;
}

/** Half-width still for srcset (desktop screenshots only). */
export function landingHalfSrc(src: string): string | null {
  if (!src.endsWith('.webp')) return null;
  const file = src.slice(src.lastIndexOf('/') + 1);
  if (PHONE_FILE.test(file)) return null;
  if (src.includes('hero-bg-')) return null;
  return src.replace(/\.webp$/, '-700.webp');
}

export function landingSrcSet(src: string): string | undefined {
  const half = landingHalfSrc(src);
  if (!half) return undefined;
  return `${half} 700w, ${src} 1400w`;
}

export function landingSizes(kind: 'hero' | 'gallery' | 'role' | 'phone'): string {
  if (kind === 'phone') return '(max-width: 999px) min(240px, 34vw), 240px';
  if (kind === 'role') return '(max-width: 999px) 92vw, 30vw';
  if (kind === 'gallery') return '(max-width: 799px) 92vw, 46vw';
  return '(max-width: 799px) 92vw, (max-width: 999px) 92vw, 46vw';
}
