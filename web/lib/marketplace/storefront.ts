/**
 * Optional public storefronts for Premium / Team parts suppliers.
 * Free sellers cannot enable a storefront or bulk-upload inventory.
 * Team (and Enterprise) keep featured placement — not a paid-ads system.
 */

import { currentOrgPlan, orgIsPaid, orgIsTopPaid, type OrgPlanFields } from '../org-plan.ts';
import { isSupplierOrgType } from '../org-types.ts';
import { canManageOrgListings, type ListingActor } from './ownership.ts';
import { isSupplier, type OrgTypeLike, type RoleLike } from '../roles.ts';

export const STOREFRONT_PATH_PREFIX = '/marketplace/sellers';
export const STOREFRONT_SETTINGS_PATH = '/marketplace/storefront';

/** Locked 2026-08-23: Free = one smaller photo; Premium/Team = multiple hi-res. */
export const FREE_LISTING_PHOTO_LIMIT = 1;
export const PAID_LISTING_PHOTO_LIMIT = 8;

export const STOREFRONT_BIO_MAX = 800;
export const STOREFRONT_SLUG_MAX = 60;

const RESERVED_SLUGS = new Set([
  'new',
  'settings',
  'template',
  'uploads',
  'featured',
  'index',
  'me',
  'storefront',
]);

export type SellerStorefrontFields = OrgPlanFields & {
  id?: string | number | null;
  name?: string | null;
  type?: string | null;
  logo_url?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
  storefront_enabled?: boolean | null;
  storefront_slug?: string | null;
  storefront_bio?: string | null;
};

export function isPartsSupplierOrg(orgType?: OrgTypeLike): boolean {
  return isSupplierOrgType(orgType);
}

/**
 * Premium, Team, Enterprise, complimentary Premium (is_premium / unexpired
 * premium_until), and named paid plans. Free stays out.
 */
export function supplierHasPaidStorefrontPlan(
  org: OrgPlanFields | null | undefined,
  now: Date = new Date()
): boolean {
  return orgIsPaid(org, now);
}

export function canEnableSupplierStorefront(
  role?: RoleLike,
  orgType?: OrgTypeLike,
  org?: OrgPlanFields | null,
  now: Date = new Date()
): boolean {
  if (!isSupplier(role, orgType) && !isSupplierOrgType(orgType)) return false;
  return supplierHasPaidStorefrontPlan(org, now);
}

/** Same gate as storefront — bulk CSV/XLSX is for Premium/Team storefront sellers. */
export function canBulkUploadSupplierInventory(
  role?: RoleLike,
  orgType?: OrgTypeLike,
  org?: OrgPlanFields | null,
  now: Date = new Date()
): boolean {
  return canEnableSupplierStorefront(role, orgType, org, now);
}

/** Team / Enterprise parts suppliers get the light Featured seller badge. */
export function supplierGetsFeaturedPlacement(
  orgType?: OrgTypeLike,
  org?: OrgPlanFields | null
): boolean {
  if (!isSupplierOrgType(orgType)) return false;
  return orgIsTopPaid(org);
}

export function listingPhotoLimit(org?: OrgPlanFields | null, now: Date = new Date()): number {
  return orgIsPaid(org, now) ? PAID_LISTING_PHOTO_LIMIT : FREE_LISTING_PHOTO_LIMIT;
}

export function storefrontPath(slug: string): string {
  return `${STOREFRONT_PATH_PREFIX}/${encodeURIComponent(slug)}`;
}

export function slugifyStorefront(value: unknown): string {
  const raw = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, STOREFRONT_SLUG_MAX)
    .replace(/-+$/g, '');
  return raw;
}

export function isValidStorefrontSlug(value: unknown): boolean {
  const slug = String(value || '')
    .trim()
    .toLowerCase();
  if (slug.length < 2 || slug.length > STOREFRONT_SLUG_MAX) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function uniqueStorefrontSlug(name: unknown, orgId?: string | number | null): string {
  const base = slugifyStorefront(name) || (orgId != null ? `seller-${orgId}` : '');
  if (isValidStorefrontSlug(base)) return base;
  const fallback = orgId != null ? `seller-${orgId}` : 'seller';
  return isValidStorefrontSlug(fallback) ? fallback : `seller-${String(orgId || 'org').replace(/[^a-z0-9]/gi, '')}`;
}

export function clipStorefrontBio(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, STOREFRONT_BIO_MAX);
}

export function storefrontDisplayName(org: SellerStorefrontFields | null | undefined): string {
  const name = String(org?.name || '').trim();
  return name || 'Parts seller';
}

export function storefrontAbout(org: SellerStorefrontFields | null | undefined): string {
  const bio = clipStorefrontBio(org?.storefront_bio);
  if (bio) return bio;
  return clipStorefrontBio(org?.notes);
}

export function isPublicStorefront(org: SellerStorefrontFields | null | undefined, now: Date = new Date()): boolean {
  if (!org?.storefront_enabled) return false;
  if (!isSupplierOrgType(org.type)) return false;
  if (!supplierHasPaidStorefrontPlan(org, now)) return false;
  return isValidStorefrontSlug(org.storefront_slug);
}

export function canManageSupplierStorefront(actor: ListingActor | null | undefined, orgType?: OrgTypeLike): boolean {
  if (!actor?.userId) return false;
  if (!isSupplier(actor.role, orgType || actor.orgType) && !isSupplierOrgType(orgType || actor.orgType)) {
    return false;
  }
  return canManageOrgListings(actor.role, orgType || actor.orgType);
}

export function publicStorefrontContact(
  org: SellerStorefrontFields | null | undefined,
  signedIn: boolean
): { website: string | null; email: string | null; phone: string | null } {
  if (!signedIn) {
    return { website: null, email: null, phone: null };
  }
  const website = String(org?.website || '').trim() || null;
  const email = String(org?.email || '').trim() || null;
  const phone = String(org?.phone || '').trim() || null;
  return { website, email, phone };
}

/** Public storefront URL. Guests may open it; prices/contact still follow marketplace guest rules. */
export function storefrontHref(slug: string | null | undefined): string | null {
  if (!slug || !isValidStorefrontSlug(slug)) return null;
  return storefrontPath(slug);
}

export type PublicSellerCard = {
  slug: string;
  name: string;
  bio: string;
  logoUrl: string | null;
  featured: boolean;
  href: string;
};

export function toPublicSellerCard(org: SellerStorefrontFields, now: Date = new Date()): PublicSellerCard | null {
  if (!isPublicStorefront(org, now)) return null;
  const slug = String(org.storefront_slug || '').trim().toLowerCase();
  return {
    slug,
    name: storefrontDisplayName(org),
    bio: storefrontAbout(org),
    logoUrl: String(org.logo_url || '').trim() || null,
    featured: supplierGetsFeaturedPlacement(org.type, org),
    href: storefrontPath(slug),
  };
}

export function sortFeaturedSellersFirst<T extends { featured?: boolean; name?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

export function namedPlanForCopy(org?: OrgPlanFields | null): 'free' | 'premium' | 'team' | 'enterprise' {
  return currentOrgPlan(org);
}
