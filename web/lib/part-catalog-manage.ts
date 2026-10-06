/** Who may archive a catalog part or delete its vendor rows. */

export const VENDOR_REMOVE_ERROR = "Couldn't remove this vendor.";
export const PART_ARCHIVE_ERROR = "Couldn't archive this part.";

export type CatalogMembership = {
  user_id?: string | null;
  organization_id?: number | string | null;
  role?: string | null;
};

export function isSameOrgCatalogAdmin(role: string | null | undefined): boolean {
  const value = String(role || '').toLowerCase();
  return value === 'admin' || value === 'company_admin';
}

/**
 * Part creator, or an admin/company_admin who shares an organization_memberships
 * row with that creator. user_profiles.organization_id is not an input.
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
  const adminOrgs = new Set(
    input.memberships
      .filter((row) => String(row.user_id || '') === userId && isSameOrgCatalogAdmin(row.role))
      .map((row) => String(row.organization_id ?? ''))
      .filter(Boolean)
  );
  if (!adminOrgs.size) return false;
  return input.memberships.some(
    (row) => String(row.user_id || '') === createdBy && adminOrgs.has(String(row.organization_id ?? ''))
  );
}

/** PostgREST delete/update with .select() returns the rows actually changed. */
export function changedRowCount(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}
