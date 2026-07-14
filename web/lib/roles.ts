/**
 * Role helpers for Total Service Pro web (Android WebView parity).
 * Treat admin ≡ company_admin.
 */

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
    r === 'engineer'
  );
}

/** Facility owner / laser clinic user */
export function isOwnerish(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  const r = normalizeRole(role);
  if (r === 'owner' || r === 'customer') return true;
  const t = normalizeOrgType(orgType);
  return t === 'customer';
}

/** Parts supplier / vendor */
export function isSupplier(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  const r = normalizeRole(role);
  if (r === 'parts_supplier' || r === 'supplier') return true;
  const t = normalizeOrgType(orgType);
  return t === 'parts_supplier' || t === 'vendor';
}

/** Service company (RSP) — not owner/clinic and not supplier */
export function isServiceCompany(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  if (isOwnerish(role, orgType) || isSupplier(role, orgType)) return false;
  const t = normalizeOrgType(orgType);
  if (t === 'service_company') return true;
  const r = normalizeRole(role);
  return (
    isPro(role) ||
    r === 'dispatcher' ||
    r === 'billing_manager' ||
    r === 'scheduler' ||
    r === 'crm'
  );
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
