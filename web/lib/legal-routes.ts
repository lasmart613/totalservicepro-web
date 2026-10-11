/**
 * Public legal pages for the website and the Android app.
 * These URLs must render with no session and must not be sent to onboarding.
 * English only: language prefixes stay on the unprefixed path.
 */

export const LEGAL_CONTACT_EMAIL = 'contact@medicalrepairnetwork.com';
export const LEGAL_POSTAL_ADDRESS = '3349 Somis Rd, Somis, CA 93066-9997';
export const LEGAL_EFFECTIVE_DATE = 'October 11, 2026';

/** Days to finish a verified account-deletion request. */
export const ACCOUNT_DELETION_DAYS = 30;

export const LEGAL_PRODUCT = 'Total Service Pro';
export const LEGAL_NETWORK = 'Medical Repair Network';
export const LEGAL_SITE_NAME = 'RepairPlanet';
export const LEGAL_ORIGIN = 'https://repairplanet.net';

/** Pages that render without auth. Keep these out of PUBLIC_PATHS. */
export const LEGAL_PUBLIC_PATHS = ['/privacy', '/delete-account', '/terms'] as const;

export type LegalPublicPath = (typeof LEGAL_PUBLIC_PATHS)[number];

const LEGAL_PUBLIC_SET = new Set<string>(LEGAL_PUBLIC_PATHS);

/**
 * Aliases that must land on the privacy policy.
 * /legal/privacy was also a 404 on the Play checklist (11 Oct 2026).
 */
export const LEGAL_REDIRECTS: Record<string, LegalPublicPath> = {
  '/privacy-policy': '/privacy',
  '/legal/privacy': '/privacy',
};

export function normalizeLegalPath(pathname: string): string {
  const path = String(pathname || '').split('?')[0].split('#')[0] || '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

export function isPublicLegalPath(pathname: string): boolean {
  return LEGAL_PUBLIC_SET.has(normalizeLegalPath(pathname));
}

/** Permanent redirect target, or null when the path should render. */
export function legalRedirectDestination(pathname: string): string | null {
  return LEGAL_REDIRECTS[normalizeLegalPath(pathname)] ?? null;
}

export function legalMailto(subject: string): string {
  return `mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
