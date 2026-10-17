import { userIsShopMember, type FounderClaimAdmin } from '@/lib/founder-claim';
import type { AuthzFailure } from '@/lib/tenant-lockdown';

/**
 * POST /api/org/founder, new-org path (000919 rev 3, QA #309 H3).
 *
 * The route inserts the org and its owner membership with the service role,
 * so RLS (organizations_insert_customer_side_not_shop_member,
 * membership_insert_allowed) does not apply there. This mirrors it before the
 * insert:
 * - orgType must be one of the signup types (allow-list; prod 180 days: only
 *   these six).
 * - A customer-side org can't be founded by a current member of a service
 *   company: otherwise a shop tech becomes the owner of a "clinic", links it
 *   to the shop, lets the shop write reports against it, leaves, and keeps
 *   reading them. Unknown membership state fails closed.
 * After the insert the route also runs founderClaimAllowed on the new row,
 * like the existing-org path (that catches a stamped row from a race).
 */
export const FOUNDER_SIGNUP_ORG_TYPES = [
  'service_company',
  'customer',
  'laser_clinic',
  'laser_rental',
  'laser_reseller',
  'parts_supplier',
] as const;

const CUSTOMER_SIDE = new Set(['customer', 'laser_clinic', 'laser_rental', 'laser_reseller']);

export function founderSignupOrgType(raw: unknown): string | null {
  const t = String(raw ?? '').toLowerCase().trim();
  return (FOUNDER_SIGNUP_ORG_TYPES as readonly string[]).includes(t) ? t : null;
}

export const SHOP_MEMBER_CUSTOMER_ORG_ERROR =
  'You belong to a service company, so you cannot set up a clinic account yourself. ' +
  'Add the customer from your company, or ask the clinic to sign up and send them an owner invite.';

export async function checkFounderNewOrg(
  admin: FounderClaimAdmin,
  input: { userId: string; orgType: unknown }
): Promise<{ ok: true; orgType: string } | AuthzFailure> {
  const orgType = founderSignupOrgType(input.orgType);
  if (!orgType) {
    return { ok: false, status: 400, error: 'Unsupported organization type.' };
  }
  if (CUSTOMER_SIDE.has(orgType)) {
    const shop = await userIsShopMember(admin, input.userId);
    if (shop !== false) {
      return { ok: false, status: 403, error: SHOP_MEMBER_CUSTOMER_ORG_ERROR };
    }
  }
  return { ok: true, orgType };
}
