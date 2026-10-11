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

export async function loadFounderClaimState(
  admin: FounderClaimAdmin,
  orgId: number | string,
  userId: string
): Promise<{ callerIsMember: boolean | null; orgHasMembers: boolean | null; orgHasServiceLink: boolean | null }> {
  const q = (table: string) => admin.from(table) as Query;
  const [mine, anyMember, link] = await Promise.all([
    q('organization_memberships').select('user_id').eq('organization_id', orgId).eq('user_id', userId).limit(1),
    q('organization_memberships').select('user_id').eq('organization_id', orgId).limit(1),
    q('organization_customers').select('id').eq('customer_organization_id', orgId).limit(1),
  ]);
  const m = rows(mine);
  const a = rows(anyMember);
  const l = rows(link);
  return {
    callerIsMember: m == null ? null : m.length > 0,
    orgHasMembers: a == null ? null : a.length > 0,
    orgHasServiceLink: l == null ? null : l.length > 0,
  };
}
