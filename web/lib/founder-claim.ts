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

/**
 * creatorIsShopMember: the org's creator (the caller: decideFounderLink only
 * lets created_by claim) holds a membership in any service company. With a
 * customer-side org that blocks the founder claim (000917
 * org_founder_claim_allowed): a shop user who added a clinic must never become
 * its owner. A read error leaves it null (fails closed).
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
}> {
  const q = (table: string) => admin.from(table) as Query;
  const [mine, anyMember, link, callerOrgs] = await Promise.all([
    q('organization_memberships').select('user_id').eq('organization_id', orgId).eq('user_id', userId).limit(1),
    q('organization_memberships').select('user_id').eq('organization_id', orgId).limit(1),
    q('organization_customers').select('id').eq('customer_organization_id', orgId).limit(1),
    q('organization_memberships').select('organization_id').eq('user_id', userId).limit(50),
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
  return {
    callerIsMember: m == null ? null : m.length > 0,
    orgHasMembers: a == null ? null : a.length > 0,
    orgHasServiceLink: l == null ? null : l.length > 0,
    creatorIsShopMember,
  };
}
