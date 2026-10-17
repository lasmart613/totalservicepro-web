/**
 * Membership and service-link state for the founder claim check
 * (founderClaimAllowed). Service-role reads. A read error leaves the value
 * null, and founderClaimAllowed treats null as "not allowed".
 */
type Res = { data: unknown; error: { message?: string } | null };
type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  limit: (n: number) => PromiseLike<Res>;
};
export type FounderClaimAdmin = { from: (table: string) => unknown };

function rows(res: Res): unknown[] | null {
  if (res.error) return null;
  return Array.isArray(res.data) ? res.data : [];
}

const SHOP_ORG_TYPES = new Set(['service_company', 'service']);

/** 000919 not applied yet: organizations.creator_shop_org_id does not exist. */
function missingStampColumn(res: Res): boolean {
  const message = String(res.error?.message || '');
  return /creator_shop_org_id/i.test(message) && /does not exist|could not find|schema cache|42703|PGRST204/i.test(message);
}

/**
 * creatorIsShopMember: the org's creator (the caller: decideFounderLink only
 * lets created_by claim) holds a membership in any service company. With a
 * customer-side org that blocks the founder claim (000917
 * org_founder_claim_allowed): a shop user who added a clinic must never become
 * its owner. A read error leaves it null (fails closed).
 *
 * 000919, so leaving the shop first doesn't help (both refuse any org type):
 * - creatorWasShopMember: organizations.creator_shop_org_id is set (the
 *   creator belonged to a service company when they inserted it as a
 *   customer-side org; stamped by trigger). Before 000919 is applied the
 *   column is missing: false.
 * - orgServed: a service_reports or service_tickets row has
 *   customer_organization_id = the org.
 */
export async function loadFounderClaimState(
  admin: FounderClaimAdmin,
  orgId: number | string,
  userId: string
): Promise<{
  callerIsMember: boolean | null;
  orgHasMembers: boolean | null;
  orgHasServiceLink: boolean | null;
  creatorIsShopMember: boolean | null;
  creatorWasShopMember: boolean | null;
  orgServed: boolean | null;
}> {
  const q = (table: string) => admin.from(table) as Query;
  const [mine, anyMember, link, callerOrgs, stamp, reports, tickets] = await Promise.all([
    q('organization_memberships').select('user_id').eq('organization_id', orgId).eq('user_id', userId).limit(1),
    q('organization_memberships').select('user_id').eq('organization_id', orgId).limit(1),
    q('organization_customers').select('id').eq('customer_organization_id', orgId).limit(1),
    q('organization_memberships').select('organization_id').eq('user_id', userId).limit(50),
    q('organizations').select('creator_shop_org_id').eq('id', orgId).limit(1),
    q('service_reports').select('id').eq('customer_organization_id', orgId).limit(1),
    q('service_tickets').select('id').eq('customer_organization_id', orgId).limit(1),
  ]);
  const m = rows(mine);
  const a = rows(anyMember);
  const l = rows(link);
  const c = rows(callerOrgs);
  let creatorIsShopMember: boolean | null = c == null ? null : false;
  if (c) {
    for (const row of c as Array<{ organization_id?: unknown }>) {
      if (row?.organization_id == null || String(row.organization_id) === String(orgId)) continue;
      const org = rows(await q('organizations').select('type').eq('id', row.organization_id).limit(1));
      if (org == null) {
        creatorIsShopMember = null;
        break;
      }
      const type = String((org[0] as { type?: unknown } | undefined)?.type || '').trim().toLowerCase();
      if (SHOP_ORG_TYPES.has(type)) {
        creatorIsShopMember = true;
        break;
      }
    }
  }
  let creatorWasShopMember: boolean | null;
  if (missingStampColumn(stamp)) {
    creatorWasShopMember = false;
  } else {
    const st = rows(stamp);
    creatorWasShopMember =
      st == null ? null : st.some((row) => (row as { creator_shop_org_id?: unknown })?.creator_shop_org_id != null);
  }
  const r = rows(reports);
  const t = rows(tickets);
  return {
    callerIsMember: m == null ? null : m.length > 0,
    orgHasMembers: a == null ? null : a.length > 0,
    orgHasServiceLink: l == null ? null : l.length > 0,
    creatorIsShopMember,
    creatorWasShopMember,
    orgServed: r == null || t == null ? null : r.length > 0 || t.length > 0,
  };
}
