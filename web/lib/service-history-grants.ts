/**
 * Owner-consent service history sharing (migration 000920, H2).
 *
 * A customer facility (owner) decides whether another service company can see
 * its past service history. Default is locked. Grants are written only through
 * the grant_service_history / revoke_service_history RPCs, and a grantee reads
 * history only through get_shared_service_history, which returns the safe
 * columns below (never notes, prices, PDFs, signatures, contacts).
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
  'service_company_name',
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

/** History another facility shared with the caller's active shop. Empty when locked. */
export async function loadSharedServiceHistory(
  client: RpcClient,
  ownerOrg: string | number,
  equipmentId?: string | number | null
): Promise<SharedHistoryRow[]> {
  const owner = orgId(ownerOrg);
  if (!owner) return [];
  try {
    const { data, error } = await client.rpc('get_shared_service_history', {
      p_owner_org: owner,
      p_equipment_id: orgId(equipmentId ?? null),
    });
    if (error || !Array.isArray(data)) return [];
    // Defense in depth: keep only the documented safe columns.
    return data.map((row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const k of SHARED_HISTORY_COLUMNS) if (k in row) out[k] = row[k];
      return out as SharedHistoryRow;
    });
  } catch (e) {
    console.warn('loadSharedServiceHistory', e);
    return [];
  }
}
