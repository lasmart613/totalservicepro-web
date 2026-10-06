/**
 * Public site origin for auth redirects and absolute email links.
 *
 * Production uses NEXT_PUBLIC_SITE_URL, then URL.
 * Netlify deploy-preview and branch-deploy builds use DEPLOY_PRIME_URL so
 * invite, claim, and password links stay on that deploy.
 *
 * Client bundles cannot read CONTEXT or DEPLOY_PRIME_URL. next.config writes
 * the same choice into NEXT_PUBLIC_SITE_ORIGIN at build time. Values are
 * public URLs. Read non-public names with bracket access so a bundler does
 * not inline them.
 */

export const PRODUCTION_SITE_ORIGIN = 'https://repairplanet.net';

export type SiteOriginEnv = {
  CONTEXT?: string;
  NETLIFY_CONTEXT?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  URL?: string;
  DEPLOY_PRIME_URL?: string;
  NEXT_PUBLIC_SITE_ORIGIN?: string;
};

type HeaderSource = { headers: { get: (name: string) => string | null } };

function clean(value: string | undefined): string {
  return String(value || '').trim().replace(/\/$/, '');
}

export function resolveSiteOrigin(env: SiteOriginEnv, req?: HeaderSource): string {
  const ctx = clean(env.CONTEXT || env.NETLIFY_CONTEXT).toLowerCase();
  const preview = ctx === 'deploy-preview' || ctx === 'branch-deploy';
  const prime = clean(env.DEPLOY_PRIME_URL);
  const baked = clean(env.NEXT_PUBLIC_SITE_ORIGIN);
  const configured = clean(env.NEXT_PUBLIC_SITE_URL) || clean(env.URL);

  if (preview) {
    if (prime) return prime;
    if (baked) return baked;
  }
  // No CONTEXT in the browser. The build already picked the preview origin.
  if (!ctx && baked) return baked;
  if (configured) return configured;
  if (baked) return baked;

  if (req) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    if (host && !host.includes(' ')) return `${proto}://${host}`.replace(/\/$/, '');
  }
  return PRODUCTION_SITE_ORIGIN;
}

function runtimeValue(name: string): string {
  return String(process.env[name] ?? '').trim();
}

export function currentSiteOriginEnv(): SiteOriginEnv {
  return {
    CONTEXT: runtimeValue('CONTEXT'),
    NETLIFY_CONTEXT: runtimeValue('NETLIFY_CONTEXT'),
    URL: runtimeValue('URL'),
    DEPLOY_PRIME_URL: runtimeValue('DEPLOY_PRIME_URL'),
    NEXT_PUBLIC_SITE_URL: String(process.env.NEXT_PUBLIC_SITE_URL ?? '').trim(),
    NEXT_PUBLIC_SITE_ORIGIN: String(process.env.NEXT_PUBLIC_SITE_ORIGIN ?? '').trim(),
  };
}

export function publicSiteOrigin(req?: HeaderSource): string {
  return resolveSiteOrigin(currentSiteOriginEnv(), req);
}

/** Browser origin when the click is in the page. Otherwise the build/runtime origin. */
export function clientAuthOrigin(): string {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin;
  }
  return publicSiteOrigin();
}
