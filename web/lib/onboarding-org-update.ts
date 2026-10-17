import { isOwnerOrgType, isServiceOrgType, isSupplierOrgType } from '@/lib/org-types';

/**
 * 000919 rev 2: organizations.type is fixed after insert for clients
 * (organizations_guard_privilege raises 42501 on any change). Onboarding
 * re-saves an existing org, so it never sends `type` on update. A real
 * change of product (clinic <-> service company <-> supplier) is refused here,
 * before anything is written; support changes it with the service role.
 */
export type OnboardingOrgUpdate =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

function family(type?: string | null): string {
  if (isOwnerOrgType(type)) return 'owner';
  if (isServiceOrgType(type)) return 'service';
  if (isSupplierOrgType(type)) return 'supplier';
  return `other:${String(type || '').toLowerCase().trim()}`;
}

/** Client-only columns never sent on an onboarding update. */
const NEVER_ON_UPDATE = ['type', 'created_by', 'creator_shop_org_id', 'id'];

export function onboardingOrgUpdatePayload(
  payload: Record<string, unknown>,
  existingType: string | null | undefined
): OnboardingOrgUpdate {
  const wanted = payload.type == null ? null : String(payload.type);
  if (existingType && wanted && family(existingType) !== family(wanted)) {
    return {
      ok: false,
      error:
        'Your organization is already set up as a different kind of account. ' +
        'Its type cannot be changed here; contact support to change it.',
    };
  }
  const out: Record<string, unknown> = { ...payload };
  for (const key of NEVER_ON_UPDATE) delete out[key];
  return { ok: true, payload: out };
}
