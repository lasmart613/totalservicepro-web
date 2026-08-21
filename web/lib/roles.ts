/**
 * Role helpers for Total Service Pro web (Android WebView parity).
 * Treat admin ≡ company_admin.
 *
 * Owner-side org types (same product persona — My Lasers, post service needs):
 *   customer | laser_clinic | laser_rental | laser_reseller
 * See lib/org-types.ts.
 */

import {
  isOwnerOrgType,
  isServiceOrgType,
  isSupplierOrgType,
} from '@/lib/org-types';

export type RoleLike = string | null | undefined;
export type OrgTypeLike = string | null | undefined;

export function normalizeRole(role?: RoleLike): string {
  return (role || '').toLowerCase().trim();
}

export function normalizeOrgType(orgType?: OrgTypeLike): string {
  return (orgType || '').toLowerCase().trim();
}

/** admin ≡ company_admin */
export function isAdmin(role?: RoleLike): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'company_admin';
}

/**
 * Pro / service-company operational roles.
 * Includes: admin, company_admin, service_manager, fse, engineer.
 */
export function isPro(role?: RoleLike): boolean {
  const r = normalizeRole(role);
  return (
    r === 'admin' ||
    r === 'company_admin' ||
    r === 'service_manager' ||
    r === 'fse' ||
    r === 'engineer' ||
    r === 'dispatcher' ||
    r === 'scheduler'
  );
}

/**
 * Facility / equipment holder persona:
 * clinics, practices, laser rental companies, laser resellers.
 * Role owner/customer OR org.type in OWNER_ORG_TYPES.
 */
export function isOwnerish(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  const r = normalizeRole(role);
  if (r === 'owner' || r === 'customer') return true;
  return isOwnerOrgType(orgType);
}

/** Parts supplier / vendor */
export function isSupplier(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  const r = normalizeRole(role);
  if (r === 'parts_supplier' || r === 'supplier') return true;
  return isSupplierOrgType(orgType);
}

/** Service company (RSP) — not owner-side and not supplier */
export function isServiceCompany(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  if (isOwnerish(role, orgType) || isSupplier(role, orgType)) return false;
  if (isServiceOrgType(orgType)) return true;
  const r = normalizeRole(role);
  return (
    isPro(role) ||
    r === 'dispatcher' ||
    r === 'billing_manager' ||
    r === 'scheduler' ||
    r === 'crm'
  );
}

/**
 * Create or edit CRM customers (Customer Directory).
 * Service-company staff only — suppliers may view, owners use their own profile.
 */
export function canAddCustomers(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  if (isOwnerish(role, orgType) || isSupplier(role, orgType)) return false;
  return isServiceCompany(role, orgType) || normalizeOrgType(orgType) === 'service_company';
}

/** Company / facility / supplier profile access */
export function canAccessCompanyProfile(role?: RoleLike): boolean {
  const r = normalizeRole(role);
  return (
    isAdmin(role) ||
    r === 'service_manager' ||
    r === 'owner' ||
    r === 'customer' ||
    r === 'parts_supplier' ||
    r === 'supplier'
  );
}

/** Create / manage service tickets (service org roles) */
export function canCreateTickets(role?: RoleLike): boolean {
  const r = normalizeRole(role);
  return isPro(role) || r === 'dispatcher' || r === 'scheduler';
}

/** Bid on marketplace needs (service pros incl. admin) */
export function canBidMarketplace(role?: RoleLike): boolean {
  return isPro(role);
}

/**
 * Post marketplace needs / demand.
 * Owners post service needs; suppliers post parts/consumables needs or offers.
 */
export function canPostMarketplaceNeed(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  return isOwnerish(role, orgType) || isSupplier(role, orgType);
}

/**
 * Accept bids on own posts (facility owners + suppliers).
 */
export function canAcceptBids(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  return isOwnerish(role, orgType) || isSupplier(role, orgType);
}

/** Convenience: dashboard persona */
export type DashboardPersona = 'service' | 'owner' | 'supplier';

export function getDashboardPersona(role?: RoleLike, orgType?: OrgTypeLike): DashboardPersona {
  if (isOwnerish(role, orgType)) return 'owner';
  if (isSupplier(role, orgType)) return 'supplier';
  return 'service';
}
