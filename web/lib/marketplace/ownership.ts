/**
 * Who may edit / unpublish a marketplace listing.
 * Owners (seller_id / created_by) and org admins of the seller org.
 */

import { sameOrg } from '../org-membership.ts';
import { isAdmin, isSupplier, normalizeRole, type OrgTypeLike, type RoleLike } from '../roles.ts';

export type ListingOwnershipFields = {
  seller_id?: string | null;
  created_by?: string | null;
  organization_id?: string | number | null;
};

export type ListingActor = {
  userId?: string | null;
  orgId?: string | number | null;
  role?: RoleLike;
  orgType?: OrgTypeLike;
  membershipOrgIds?: Array<string | number | null | undefined>;
};

/** Statuses that stay off the public marketplace (sold can still show as sold-out). */
const HIDDEN_PUBLIC_STATUS = new Set(['removed', 'expired', 'inactive', 'closed', 'draft']);

export function isPublicListingStatus(status?: string | null): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  if (!s) return true;
  return !HIDDEN_PUBLIC_STATUS.has(s);
}

export function isListingOwner(listing: ListingOwnershipFields | null | undefined, userId?: string | null): boolean {
  if (!listing || !userId) return false;
  return listing.seller_id === userId || listing.created_by === userId;
}

/**
 * Roles that may manage every listing for their supplier org
 * (not just rows they personally created).
 */
export function canManageOrgListings(role?: RoleLike, orgType?: OrgTypeLike): boolean {
  const r = normalizeRole(role);
  if (isAdmin(role)) return true;
  if (r === 'owner' || r === 'parts_supplier' || r === 'supplier') return true;
  if (isSupplier(role, orgType)) return true;
  return false;
}

export function actorBelongsToListingOrg(
  listing: ListingOwnershipFields | null | undefined,
  actor: ListingActor
): boolean {
  if (!listing || listing.organization_id == null) return false;
  if (sameOrg(listing.organization_id, actor.orgId)) return true;
  return (actor.membershipOrgIds || []).some((id) => sameOrg(id, listing.organization_id));
}

export function canManageMarketplaceListing(
  listing: ListingOwnershipFields | null | undefined,
  actor: ListingActor
): boolean {
  if (!listing || !actor.userId) return false;
  if (isListingOwner(listing, actor.userId)) return true;
  if (!canManageOrgListings(actor.role, actor.orgType)) return false;
  return actorBelongsToListingOrg(listing, actor);
}
