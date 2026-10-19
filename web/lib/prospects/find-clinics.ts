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

export type ProspectPayload = {
  tier: 'free' | 'premium';
  total: number;
  free_limit: number;
  clinics: ProspectClinic[];
  aggregates: ProspectAggregate[];
  /** Free only (server-set). null for Premium: no upgrade CTA. */
  locked: { area: number; total: number } | null;
};

export type ProspectLoad =
  | { ok: true; data: ProspectPayload }
  | { ok: false; reason: 'unavailable' | 'not_service_org' | 'error'; message?: string };

export function parseProspectResponse(data: unknown, error: { message?: string; code?: string } | null): ProspectLoad {
  if (error) {
    const msg = error.message || '';
    if (error.code === 'PGRST202' || /find_clinic_prospects|does not exist|schema cache/i.test(msg)) {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: false, reason: 'error', message: msg };
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
      aggregates: Array.isArray(j.aggregates) ? (j.aggregates as ProspectAggregate[]) : [],
      locked:
        j.tier !== 'premium' && j.locked && typeof j.locked === 'object'
          ? {
              area: Number((j.locked as Record<string, unknown>).area) || 0,
              total: Number((j.locked as Record<string, unknown>).total) || 0,
            }
          : null,
    },
  };
}

/** Message key for an add_prospect_customer() refusal. */
export function addErrorKey(code: unknown): string {
  switch (code) {
    case 'not_admin':
      return 'Only owners and admins can add customers.';
    case 'daily_cap':
      return 'You reached today’s limit for adding clinics. Try again tomorrow.';
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
