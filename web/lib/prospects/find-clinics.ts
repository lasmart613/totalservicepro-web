/**
 * Shapes returned by public.find_clinic_prospects() (000929). The server
 * decides tier and fields; the client only renders what it got.
 */

export type ProspectClinic = {
  id: number | string;
  name: string | null;
  type?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  contact_name?: string | null;
  laser_models?: string | null;
  facility_type?: string | null;
  is_customer?: boolean | null;
  local?: boolean | null;
};

export type ProspectAggregate = { country: string | null; city: string | null; count: number };

export type ProspectCountryCount = { country: string | null; count: number };
export type ProspectCityCount = { city: string; count: number };
export type ProspectPage = { limit: number; offset: number; filtered_total: number; has_more: boolean };

/**
 * Rows the client requests per page (p_limit). The RPC separately clamps
 * p_limit to a hard maximum of 100, so this is a request, not the cap.
 */
export const PROSPECT_PAGE_SIZE = 50;

export type ProspectPayload = {
  tier: 'free' | 'premium';
  total: number;
  free_limit: number;
  clinics: ProspectClinic[];
  /** Free: gated rows by (country, city), top 300 groups. Premium: []. */
  aggregates: ProspectAggregate[];
  /** Server GROUP BY counts per country (Free: gated rows; Premium: whole pool). */
  country_counts: ProspectCountryCount[];
  /** Premium: cities within the selected country, top 300. */
  city_counts: ProspectCityCount[];
  page: ProspectPage;
  /** Free only (server-set). null for Premium: no upgrade CTA. */
  locked: { area: number; total: number } | null;
  /** The caller's own location as the server saw it (000933). null from an older RPC. */
  viewer: ProspectViewer | null;
};

export type ProspectViewer = {
  /** The org has any of country, state or city. */
  has_location: boolean;
  /** Pool clinics in the viewer's country; null when the org has no country. */
  country_pool: number | null;
};

export type ProspectLoad =
  | { ok: true; data: ProspectPayload }
  | { ok: false; reason: 'unavailable' | 'not_service_org' | 'error'; message?: string };

/** Our RPCs; only these being missing means "migration not applied yet". */
const PROSPECT_RPCS = ['find_clinic_prospects', 'add_prospect_customer'];

/**
 * True only when PostgREST says the function itself is missing (PGRST202), or
 * Postgres says one of OUR two functions does not exist. Any other error, even
 * one mentioning "does not exist" (a table/column inside the RPC), is real.
 */
export function isRpcMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  const msg = error.message || '';
  return PROSPECT_RPCS.some((fn) =>
    new RegExp(`function\\s+(public\\.)?${fn}\\b[^]*?does not exist|could not find the function\\s+(public\\.)?${fn}\\b`, 'i').test(msg),
  );
}

export function parseProspectResponse(data: unknown, error: { message?: string; code?: string } | null): ProspectLoad {
  if (error) {
    const msg = error.message || '';
    if (isRpcMissing(error)) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'error', message: msg || error.code || 'unknown error' };
  }
  const j = (data || {}) as Record<string, unknown>;
  if (j.error === 'not_service_org' || j.error === 'no_org') return { ok: false, reason: 'not_service_org' };
  if (j.error) return { ok: false, reason: 'error', message: String(j.error) };
  return {
    ok: true,
    data: {
      tier: j.tier === 'premium' ? 'premium' : 'free',
      total: Number(j.total) || 0,
      free_limit: Number(j.free_limit) || 20,
      clinics: Array.isArray(j.clinics) ? (j.clinics as ProspectClinic[]) : [],
      aggregates: Array.isArray(j.area_counts) ? (j.area_counts as ProspectAggregate[]) : [],
      country_counts: Array.isArray(j.country_counts) ? (j.country_counts as ProspectCountryCount[]) : [],
      city_counts: Array.isArray(j.city_counts) ? (j.city_counts as ProspectCityCount[]) : [],
      page: {
        limit: Number((j.page as Record<string, unknown> | undefined)?.limit) || 0,
        offset: Number((j.page as Record<string, unknown> | undefined)?.offset) || 0,
        filtered_total: Number((j.page as Record<string, unknown> | undefined)?.filtered_total) || 0,
        has_more: (j.page as Record<string, unknown> | undefined)?.has_more === true,
      },
      locked:
        j.tier !== 'premium' && j.locked && typeof j.locked === 'object'
          ? {
              area: Number((j.locked as Record<string, unknown>).area) || 0,
              total: Number((j.locked as Record<string, unknown>).total) || 0,
            }
          : null,
      viewer: parseViewer(j.viewer),
    },
  };
}

function parseViewer(v: unknown): ProspectViewer | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.has_location !== 'boolean') return null;
  const n = o.country_pool;
  return {
    has_location: o.has_location,
    country_pool: typeof n === 'number' && Number.isFinite(n) ? n : null,
  };
}

export const EMPTY_NO_LOCATION = 'No clinics near your address yet. Add your city, state and country in Company Profile.';
export const EMPTY_COUNTRY_NOT_IN_POOL = 'We don’t have clinics in your country yet. More regions are coming.';
export const EMPTY_NO_COUNTRY = 'No clinics near you yet. Add your country in Company Profile so we can match clinics in your area.';
export const EMPTY_FILTERS = 'No clinics match these filters.';

/**
 * Copy for an empty clinic list. Only an org with no location at all is told
 * to add an address; an org whose country has no pool clinics yet is told so.
 */
export function emptyStateKey(data: ProspectPayload | null): string {
  if (data?.tier === 'premium') return EMPTY_FILTERS;
  const v = data?.viewer;
  if (!v || !v.has_location) return EMPTY_NO_LOCATION;
  if (v.country_pool === 0) return EMPTY_COUNTRY_NOT_IN_POOL;
  if (v.country_pool === null) return EMPTY_NO_COUNTRY;
  return EMPTY_NO_LOCATION;
}

/** Message key for an add_prospect_customer() refusal. */
export function addErrorKey(code: unknown): string {
  switch (code) {
    case 'not_admin':
      return 'Only owners and admins can add customers.';
    case 'premium_required':
      return 'Adding clinics to your customers requires Premium.';
    case 'not_service_org':
      return 'Only service companies can add clinics as customers.';
    case 'no_org':
    case 'not_authenticated':
      return 'Join or create a company before adding customers.';
    case 'daily_cap':
      // Rolling 24 h cap (50 per org), not a calendar day.
      return 'You reached the limit for adding clinics in the last 24 hours. You can add more clinics once 24 hours have passed since your earlier adds.';
    default:
      return 'Could not add this clinic.';
  }
}

/** Upgrade CTA counts, or null when no CTA may show (Premium / nothing gated). */
export function upgradeCta(data: ProspectPayload | null): { area: number; total: number } | null {
  if (!data || data.tier !== 'free' || !data.locked) return null;
  if (data.locked.total <= 0) return null;
  return data.locked;
}
