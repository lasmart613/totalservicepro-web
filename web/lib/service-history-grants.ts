/**
 * Owner-consent service history sharing (migration 000920, H2).
 *
 * A customer facility (owner) decides whether another service company can see
 * its past service history. Default is locked. Grants are written only through
 * the grant_service_history / revoke_service_history RPCs, and a grantee reads
 * history only through get_shared_service_history, which returns the safe
 * columns below (never notes, prices, PDFs, signatures, contacts).
 *
 * 000921: a shop linked through organization_customers sees only reports it
 * wrote; clinic owners/admins list and remove linked shops here too.
 * service_company_name is the real organizations.name of the shop that wrote
 * the report; report_company_name_text is the free text typed on the report
 * header (may differ). Show the real name; label the header text as such.
 *
 * A serial match alone never grants access (H2).
 */

/** Columns get_shared_service_history returns. Anything else stays private. */
export const SHARED_HISTORY_COLUMNS = [
  'id',
  'report_number',
  'status',
  'service_type',
  'model_type',
  'equipment_name',
  'equipment_type',
  'serial_number',
  'equipment_id',
  'date_out',
  'next_pm_due',
  'created_at',
  'finalized_at',
  /** organizations.name of the shop that wrote the report (authoritative). */
  'service_company_name',
  /** Free text typed on the report header (tech_company_name); not verified. */
  'report_company_name_text',
  'service_organization_id',
  'customer_organization_id',
] as const;

export type SharedHistoryRow = { [K in (typeof SHARED_HISTORY_COLUMNS)[number]]?: unknown };

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => any };

function orgId(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Owner/admin of ownerOrg shares its history with shopOrg (optionally one laser). */
export async function grantServiceHistory(
  client: RpcClient,
  ownerOrg: string | number,
  shopOrg: string | number,
  equipmentId?: string | number | null
): Promise<{ id: number | null; error: string | null }> {
  const owner = orgId(ownerOrg);
  const shop = orgId(shopOrg);
  if (!owner || !shop) return { id: null, error: 'owner and service company are required' };
  if (owner === shop) return { id: null, error: 'an organization cannot grant itself' };
  const { data, error } = await client.rpc('grant_service_history', {
    p_owner_org: owner,
    p_grantee_shop: shop,
    p_equipment_id: orgId(equipmentId ?? null),
  });
  if (error) return { id: null, error: error.message || String(error) };
  return { id: data == null ? null : Number(data), error: null };
}

/** Owner/admin revokes a grant. Takes effect on the grantee's next read. */
export async function revokeServiceHistory(
  client: RpcClient,
  grantId: string | number
): Promise<{ revoked: boolean; error: string | null }> {
  const id = orgId(grantId);
  if (!id) return { revoked: false, error: 'grant id is required' };
  const { data, error } = await client.rpc('revoke_service_history', { p_grant_id: id });
  if (error) return { revoked: false, error: error.message || String(error) };
  return { revoked: data === true, error: null };
}

export type SharedHistoryPage = {
  rows: SharedHistoryRow[];
  /** Matching reports in total (all pages). */
  total: number;
  /** True when more rows exist past this page. */
  truncated: boolean;
  /** True when offset is at or past the end (rows empty, total still set). */
  pastEnd: boolean;
};

const PAGE_MAX = 500;

/**
 * History another facility shared with the caller's active shop (000921 pages:
 * p_limit 1..500, default 200). Empty when locked or revoked.
 */
export async function loadSharedServiceHistory(
  client: RpcClient,
  ownerOrg: string | number,
  equipmentId?: string | number | null,
  page: { limit?: number; offset?: number } = {}
): Promise<SharedHistoryPage> {
  const empty: SharedHistoryPage = { rows: [], total: 0, truncated: false, pastEnd: false };
  const owner = orgId(ownerOrg);
  if (!owner) return empty;
  const limit = Math.min(Math.max(Math.trunc(page.limit ?? 200) || 1, 1), PAGE_MAX);
  const offset = Math.max(Math.trunc(page.offset ?? 0) || 0, 0);
  try {
    const { data, error } = await client.rpc('get_shared_service_history', {
      p_owner_org: owner,
      p_equipment_id: orgId(equipmentId ?? null),
      p_limit: limit,
      p_offset: offset,
    });
    if (error || !Array.isArray(data)) return empty;
    if (!data.length && offset > 0) {
      // A page past the end has no rows to carry total_count: ask page 1 for it.
      const first = await client.rpc('get_shared_service_history', {
        p_owner_org: owner,
        p_equipment_id: orgId(equipmentId ?? null),
        p_limit: 1,
        p_offset: 0,
      });
      const head = !first?.error && Array.isArray(first?.data) ? first.data[0] : null;
      const total = head ? Number(head.total_count ?? 0) : 0;
      return { rows: [], total, truncated: false, pastEnd: total > 0 };
    }
    const total = data.length ? Number(data[0]?.total_count ?? data.length) : 0;
    // Defense in depth: keep only the documented safe columns.
    const rows = data.map((row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const k of SHARED_HISTORY_COLUMNS) if (k in row) out[k] = row[k];
      return out as SharedHistoryRow;
    });
    return { rows, total, truncated: offset + rows.length < total, pastEnd: false };
  } catch (e) {
    console.warn('loadSharedServiceHistory', e);
    return empty;
  }
}

export type LinkedShop = {
  shop_org_id: number;
  shop_name: string | null;
  linked_at: string | null;
  first_service_date: string | null;
  /** Set when the owner removed this shop and blocked it (and the clinic's creator) from re-linking. */
  removed_at: string | null;
};

/** Owner/admin of a facility: service companies linked to it (and removed ones). */
export async function listLinkedServiceShops(
  client: RpcClient,
  ownerOrg: string | number
): Promise<{ shops: LinkedShop[]; error: string | null }> {
  const owner = orgId(ownerOrg);
  if (!owner) return { shops: [], error: 'facility is required' };
  const { data, error } = await client.rpc('list_linked_service_shops', { p_owner_org: owner });
  if (error) return { shops: [], error: error.message || String(error) };
  return { shops: Array.isArray(data) ? data : [], error: null };
}

/**
 * Owner/admin removes a linked shop. By default the shop (and the clinic's
 * creator, from any shop) cannot re-link itself. revokeGrants also revokes the
 * shop's active service-history grants from this facility in the same step.
 */
export async function removeLinkedServiceShop(
  client: RpcClient,
  ownerOrg: string | number,
  shopOrg: string | number,
  opts: { block?: boolean; revokeGrants?: boolean } = {}
): Promise<{ removed: boolean; error: string | null }> {
  const owner = orgId(ownerOrg);
  const shop = orgId(shopOrg);
  if (!owner || !shop) return { removed: false, error: 'facility and service company are required' };
  const { data, error } = await client.rpc('remove_linked_service_shop', {
    p_owner_org: owner,
    p_shop: shop,
    p_block: opts.block !== false,
    p_revoke_grants: opts.revokeGrants === true,
  });
  if (error) return { removed: false, error: error.message || String(error) };
  return { removed: data === true, error: null };
}

/** Owner/admin lifts a removal block (does not re-create the link). */
export async function allowLinkedServiceShop(
  client: RpcClient,
  ownerOrg: string | number,
  shopOrg: string | number
): Promise<{ allowed: boolean; error: string | null }> {
  const owner = orgId(ownerOrg);
  const shop = orgId(shopOrg);
  if (!owner || !shop) return { allowed: false, error: 'facility and service company are required' };
  const { data, error } = await client.rpc('allow_linked_service_shop', { p_owner_org: owner, p_shop: shop });
  if (error) return { allowed: false, error: error.message || String(error) };
  return { allowed: data === true, error: null };
}

export type MyServiceHistoryGrant = {
  id: number;
  owner_org_id: number;
  owner_name: string | null;
  equipment_id: number | null;
  granted_at: string;
  revoked_at: string | null;
};

/** Grantee shop: grants made to the caller's active shop (no user ids). */
export async function listMyServiceHistoryGrants(client: RpcClient): Promise<MyServiceHistoryGrant[]> {
  try {
    const { data, error } = await client.rpc('list_my_service_history_grants');
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch (e) {
    console.warn('listMyServiceHistoryGrants', e);
    return [];
  }
}
