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

const PHONE_PREFIX = '/landing/app-';

/** Half-width still for srcset (desktop screenshots only). */
export function landingHalfSrc(src: string): string | null {
  if (!src.endsWith('.webp')) return null;
  if (src.startsWith(PHONE_PREFIX)) return null;
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
