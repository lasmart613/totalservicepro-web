/**
 * Manuals library access by org type.
 * Owners / clinics: Operators only. Service companies: both. Suppliers: neither.
 */
import { manualLibraryShelf, type ManualCatalogFields, type ManualLibraryShelf } from './manual-catalog.ts';
import {
  canAccessManualsPage,
  canAccessOperatorsManuals,
  canAccessRepairAi,
  canAccessServiceManuals,
  type OrgTypeLike,
  type RoleLike,
} from './roles.ts';

export const SERVICE_MANUALS_FORBIDDEN = 'Service manuals are for service companies.';
export const MANUALS_UNAVAILABLE = 'Manuals are not available for this account.';

export function manualsAccess(role?: RoleLike, orgType?: OrgTypeLike) {
  const service = canAccessServiceManuals(role, orgType);
  const operators = canAccessOperatorsManuals(role, orgType);
  return {
    service,
    operators,
    page: canAccessManualsPage(role, orgType),
    defaultLibrary: (service ? 'service' : 'operators') as ManualLibraryShelf,
  };
}

export function canAccessManualLibraryShelf(
  role: RoleLike,
  orgType: OrgTypeLike,
  shelf: ManualLibraryShelf
): boolean {
  if (shelf === 'service') return canAccessServiceManuals(role, orgType);
  return canAccessOperatorsManuals(role, orgType);
}

export function mayOpenManual(
  role: RoleLike,
  orgType: OrgTypeLike,
  manual: ManualCatalogFields | null | undefined
): boolean {
  if (!manual) return canAccessServiceManuals(role, orgType);
  return canAccessManualLibraryShelf(role, orgType, manualLibraryShelf(manual));
}

/** Shared catalog books (AI Assistant dropdown), not private org uploads. */
export function isSharedCatalogPath(path: unknown): boolean {
  const p = String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase();
  return p.startsWith('shared/');
}

/**
 * Signed-in Repair-AI (service-company) members may open a shared/catalog
 * manual in the in-app viewer without a company-library slot — same books
 * they can already scope in AI Assistant. Still never a public PDF.
 */
export function mayViewAiScopedManual(opts: {
  role?: RoleLike;
  orgType?: OrgTypeLike;
  storagePath?: string | null;
  inLibrary?: boolean;
}): boolean {
  if (opts.inLibrary) return true;
  if (!canAccessRepairAi(opts.role, opts.orgType)) return false;
  return isSharedCatalogPath(opts.storagePath);
}

export function manualsForbiddenMessage(role?: RoleLike, orgType?: OrgTypeLike): string {
  if (canAccessOperatorsManuals(role, orgType) && !canAccessServiceManuals(role, orgType)) {
    return SERVICE_MANUALS_FORBIDDEN;
  }
  return MANUALS_UNAVAILABLE;
}

export function filterManualsForCaller<T extends ManualCatalogFields>(
  role: RoleLike,
  orgType: OrgTypeLike,
  rows: T[]
): T[] {
  const access = manualsAccess(role, orgType);
  if (!access.page) return [];
  if (access.service) return rows;
  return rows.filter((row) => manualLibraryShelf(row) === 'operators');
}
