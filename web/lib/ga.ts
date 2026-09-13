import { adsenseAllowedOnHost } from './adsense-host.ts';

/** RepairPlanet GA4 web stream (Living Free - GA4 / property 365480892). */
export const DEFAULT_GA_MEASUREMENT_ID = 'G-GNBJQ2DMQB';

const GA_MEASUREMENT_ID_RE = /^G-[A-Z0-9]+$/;

/** Internal admin / God surfaces — skip so staff work stays out of marketing reports. */
const GA_SKIP_PREFIXES = ['/admin', '/god'];

export function getGaMeasurementId(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  const fromEnv = String(env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '').trim();
  const id = fromEnv || DEFAULT_GA_MEASUREMENT_ID;
  return GA_MEASUREMENT_ID_RE.test(id) ? id : DEFAULT_GA_MEASUREMENT_ID;
}

export function gaSkipsPath(pathname: string | null | undefined): boolean {
  const path = String(pathname || '');
  if (!path) return false;
  return GA_SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Same preview-host gate as AdSense: production + custom domains only. */
export function gaAllowedOnHost(hostname: string | null | undefined): boolean {
  return adsenseAllowedOnHost(hostname);
}

export function shouldLoadGa(input: {
  nodeEnv?: string;
  pathname?: string | null;
  hostname?: string | null;
  measurementId?: string;
}): boolean {
  const nodeEnv = input.nodeEnv ?? (typeof process !== 'undefined' ? process.env.NODE_ENV : '');
  if (nodeEnv !== 'production') return false;
  if (!gaAllowedOnHost(input.hostname)) return false;
  if (gaSkipsPath(input.pathname)) return false;
  const id = input.measurementId ?? getGaMeasurementId();
  return GA_MEASUREMENT_ID_RE.test(id);
}
