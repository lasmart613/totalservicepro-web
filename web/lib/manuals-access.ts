/**
 * Manuals library access by org type.
 * Owners / clinics: Operators only. Service companies: both. Suppliers: neither.
 */
import { manualLibraryShelf, type ManualCatalogFields, type ManualLibraryShelf } from './manual-catalog.ts';
import {
  canAccessManualsPage,
  canAccessOperatorsManuals,
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
