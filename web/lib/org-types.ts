/**
 * Organization types for Total Service Pro.
 *
 * Product model — one type per organization (no multi-type, no tags):
 * - service_company — Repair Service Provider (RSP)
 * - parts_supplier / vendor — parts/consumables suppliers
 * - manufacturer — laser OEM / factory (Candela, Sciton, Cynosure, …)
 * - Owner-side (equipment operators / holders):
 *     customer | laser_clinic | laser_rental | laser_reseller
 *
 * Laser Rental and Laser Reseller are NOT service companies.
 * They are owner-side: they own/hold lasers (My Lasers, post service needs, award bids).
 * Reseller may also list systems on marketplace (same as owners today).
 *
 * Manufacturer is first-class. Do not treat it as a second tag on service_company.
 * Existing imported OEM service contacts stay service_company until a later flip.
 */

export const SERVICE_ORG_TYPES = ['service_company'] as const;

export const SUPPLIER_ORG_TYPES = ['parts_supplier', 'vendor'] as const;

/** Laser OEM / factory — not a service company, clinic, or parts supplier. */
export const MANUFACTURER_ORG_TYPES = ['manufacturer'] as const;

/** All org types that use the facility / laser-owner product persona */
export const OWNER_ORG_TYPES = [
  'customer',
  'laser_clinic',
  'laser_rental',
  'laser_reseller',
] as const;

/**
 * Live + first-class organizations.type values.
 * Keep every live value: customer, service_company, parts_supplier,
 * laser_clinic, laser_rental, laser_reseller, manufacturer.
 */
export const ORG_TYPES = [
  'customer',
  'service_company',
  'parts_supplier',
  'laser_clinic',
  'laser_rental',
  'laser_reseller',
  'manufacturer',
] as const;

export type OwnerOrgType = (typeof OWNER_ORG_TYPES)[number];
export type ServiceOrgType = (typeof SERVICE_ORG_TYPES)[number];
export type SupplierOrgType = (typeof SUPPLIER_ORG_TYPES)[number];
export type ManufacturerOrgType = (typeof MANUFACTURER_ORG_TYPES)[number];
export type KnownOrgType = (typeof ORG_TYPES)[number];

export type OrgType =
  | OwnerOrgType
  | ServiceOrgType
  | SupplierOrgType
  | ManufacturerOrgType
  | string;

export function isOwnerOrgType(type?: string | null): boolean {
  const t = (type || '').toLowerCase().trim();
  return (OWNER_ORG_TYPES as readonly string[]).includes(t);
}

export function isSupplierOrgType(type?: string | null): boolean {
  const t = (type || '').toLowerCase().trim();
  return (SUPPLIER_ORG_TYPES as readonly string[]).includes(t);
}

export function isServiceOrgType(type?: string | null): boolean {
  const t = (type || '').toLowerCase().trim();
  return t === 'service_company' || t === 'service';
}

export function isManufacturerOrgType(type?: string | null): boolean {
  const t = (type || '').toLowerCase().trim();
  return (MANUFACTURER_ORG_TYPES as readonly string[]).includes(t);
}

/** Customer directory / CRM — all owner-side orgs service companies may link */
export const CRM_CUSTOMER_ORG_TYPES = [...OWNER_ORG_TYPES] as const;

export const OWNER_ORG_TYPE_OPTIONS: {
  value: OwnerOrgType;
  label: string;
  description: string;
}[] = [
  {
    value: 'customer',
    label: 'Laser Clinic / Medical Practice',
    description: 'Hospital, med spa, clinic, or private practice that owns lasers for patient care.',
  },
  {
    value: 'laser_rental',
    label: 'Laser Rental Company',
    description:
      'Owns a fleet of lasers rented to clinics or events. Uses My Lasers, posts service needs, awards bids.',
  },
  {
    value: 'laser_reseller',
    label: 'Laser Reseller',
    description:
      'Buys/sells laser systems (new or used). Tracks inventory in My Lasers and can list systems on the Marketplace.',
  },
  {
    value: 'laser_clinic',
    label: 'Laser Clinic (legacy)',
    description: 'Legacy type — treated the same as Laser Clinic / Medical Practice.',
  },
];

/** Choices shown on signup (exclude pure legacy option) */
export const OWNER_ORG_TYPE_SIGNUP_OPTIONS = OWNER_ORG_TYPE_OPTIONS.filter(
  (o) => o.value !== 'laser_clinic'
);

export function ownerOrgTypeLabel(type?: string | null): string {
  const t = (type || '').toLowerCase().trim();
  const hit = OWNER_ORG_TYPE_OPTIONS.find((o) => o.value === t);
  if (hit) return hit.label;
  if (t === 'customer') return 'Laser Owner / Facility';
  return type || 'Organization';
}

export function defaultJobTitleForOwnerOrgType(type?: string | null): string {
  const t = (type || '').toLowerCase().trim();
  if (t === 'laser_rental') return 'Rental Company Manager';
  if (t === 'laser_reseller') return 'Reseller / Inventory Manager';
  return 'Facility / Equipment Manager';
}
