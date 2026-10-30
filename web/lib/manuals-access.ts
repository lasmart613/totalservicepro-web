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

/** Viewer state when the manual is not in the company library. */
export const ADD_TO_LIBRARY_TO_OPEN = 'Add to library to open';

/** Thrown when a URL response must not be rendered because the manual is not in the library. */
export class LibraryAddRequiredError extends Error {
  freeIncomplete: boolean;

  constructor(freeIncomplete = false) {
    super(ADD_TO_LIBRARY_TO_OPEN);
    this.name = 'LibraryAddRequiredError';
    this.freeIncomplete = freeIncomplete;
  }
}

/**
 * Every manual, including incomplete ones, must be in the company library
 * before it can be opened. Incomplete manuals are free to add and do not use
 * a slot; that does not skip this prompt. A URL with in_library false is not
 * a grant.
 */
export function companyLibraryOpenNeedsAdd(opts: {
  owned: boolean;
  /** Ignored. Incomplete manuals no longer open without a library row. */
  incomplete?: boolean;
  /** Ignored. free_incomplete describes the slot, not permission to open. */
  freeIncomplete?: unknown;
  requiresAdd?: unknown;
  suggestAdd?: unknown;
  inLibrary?: unknown;
  error?: unknown;
}): boolean {
  if (!opts.owned) return true;
  if (opts.requiresAdd === true) return true;
  if (opts.suggestAdd === true || opts.inLibrary === false) return true;
  return /not in company library|access denied|add to library to open/i.test(String(opts.error || ''));
}

/**
 * True when get-manual-url (or the file proxy) must not be shown.
 * Covers 403 requires_add and a 200 that still says the manual is not in the library.
 */
export function viewerBlockedUntilLibraryAdd(
  body:
    | {
        requires_add?: unknown;
        requiresAdd?: unknown;
        in_library?: unknown;
        inLibrary?: unknown;
        suggest_add?: unknown;
        suggestAdd?: unknown;
        free_incomplete?: unknown;
      }
    | null
    | undefined,
): boolean {
  if (!body || typeof body !== 'object') return false;
  if (body.requires_add === true || body.requiresAdd === true) return true;
  if (body.suggest_add === true || body.suggestAdd === true) return true;
  if (body.in_library === false || body.inLibrary === false) return true;
  return false;
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
 * A manual can be opened only when it is already in the caller's library.
 * Repair AI access and a shared/ catalog path do not replace that row.
 */
export function mayViewAiScopedManual(opts: {
  role?: RoleLike;
  orgType?: OrgTypeLike;
  storagePath?: string | null;
  inLibrary?: boolean;
}): boolean {
  void opts.role;
  void opts.orgType;
  void opts.storagePath;
  return opts.inLibrary === true;
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
