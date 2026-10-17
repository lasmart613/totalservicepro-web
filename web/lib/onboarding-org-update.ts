/**
 * 000919 rev 2: organizations.type is fixed after insert for clients
 * (organizations_guard_privilege raises 42501 on any change). Onboarding
 * re-saves an existing org, so it never sends `type` on update. Any real
 * change (clinic <-> service company <-> supplier, and within the clinic group
 * too, e.g. laser_clinic -> laser_rental) is refused here with a message,
 * before anything is written, never dropped silently; support changes it with
 * the service role. Legacy spellings (service, vendor, supplier) count as unchanged.
 */
export type OnboardingOrgUpdate =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/** Legacy spellings of the same type; anything else must match exactly. */
function canonicalType(type?: string | null): string {
  const t = String(type || '').toLowerCase().trim();
  if (t === 'service') return 'service_company';
  if (t === 'vendor' || t === 'supplier') return 'parts_supplier';
  return t;
}

/** Client-only columns never sent on an onboarding update. */
const NEVER_ON_UPDATE = ['type', 'created_by', 'creator_shop_org_id', 'id'];

export function onboardingOrgUpdatePayload(
  payload: Record<string, unknown>,
  existingType: string | null | undefined
): OnboardingOrgUpdate {
  const wanted = payload.type == null ? null : String(payload.type);
  if (existingType && wanted && canonicalType(existingType) !== canonicalType(wanted)) {
    return {
      ok: false,
      error:
        'Your organization is already set up as a different type of account. ' +
        'Its type cannot be changed here; contact support to change it.',
    };
  }
  const out: Record<string, unknown> = { ...payload };
  for (const key of NEVER_ON_UPDATE) delete out[key];
  return { ok: true, payload: out };
}
