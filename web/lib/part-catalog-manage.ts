/** Who may archive a catalog part or delete its vendor rows. */

export const VENDOR_REMOVE_ERROR = "Couldn't remove this vendor.";
export const VENDOR_ADD_ERROR = "Couldn't add this vendor.";
export const VENDOR_PREFER_ERROR = "Couldn't update this vendor.";
export const PART_ARCHIVE_ERROR = "Couldn't archive this part.";
export const CATALOG_SAVE_ERROR = "Couldn't save this part.";
export const STOCK_SAVE_ERROR = "Couldn't save stock.";

export type CatalogMembership = {
  user_id?: string | null;
  organization_id?: number | string | null;
  role?: string | null;
  is_home?: boolean | null;
};

export function isSameOrgCatalogAdmin(role: string | null | undefined): boolean {
  const value = String(role || '').toLowerCase();
  return value === 'admin' || value === 'company_admin';
}

/**
 * Part creator, or an admin/company_admin of the creator's home organization.
 * A membership in some other shared org does not count.
 */
export function canArchiveCatalogPart(input: {
  userId: string | null | undefined;
  createdBy: string | null | undefined;
  memberships: CatalogMembership[];
}): boolean {
  const userId = String(input.userId || '');
  const createdBy = String(input.createdBy || '');
  if (!userId || !createdBy) return false;
  if (userId === createdBy) return true;
  const homeOrgs = new Set(
    input.memberships
      .filter((row) => String(row.user_id || '') === createdBy && row.is_home === true)
      .map((row) => String(row.organization_id ?? ''))
      .filter(Boolean)
  );
  if (!homeOrgs.size) return false;
  return input.memberships.some(
    (row) =>
      String(row.user_id || '') === userId &&
      isSameOrgCatalogAdmin(row.role) &&
      homeOrgs.has(String(row.organization_id ?? ''))
  );
}

/** PostgREST delete/update with .select() returns the rows actually changed. */
export function changedRowCount(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}

export async function postPartsJson(
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; error: string }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) console.error('[parts-catalog]', path, res.status, json.error || '');
  return { ok: res.ok, status: res.status, error: json.error || '' };
}
