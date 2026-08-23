/**
 * Guest (logged-out) company directory.
 * Real Organizations rows are shown as cards, but PII is replaced with
 * placeholders so names / phones / addresses never reach the DOM.
 */

import { orgTypeLabel } from '../labels.ts';
import { isServiceOrgType } from '../org-types.ts';

export { GUEST_SIGNUP_HREF } from '../marketplace/guest.ts';

export const GUEST_NAME_PLACEHOLDER = '••••••••';
export const GUEST_PHONE_PLACEHOLDER = '(•••) •••-••••';
export const GUEST_EMAIL_PLACEHOLDER = '••••@••••.•••';
export const GUEST_ADDRESS_PLACEHOLDER = '•••• ••••••••';
export const GUEST_INITIALS_PLACEHOLDER = '••';
export const GUEST_CONTACT_PLACEHOLDER = '•••• ••••';

/** First-page size for the public directory (within the 24–48 card target). */
export const GUEST_DIRECTORY_PAGE_SIZE = 36;
export const GUEST_DIRECTORY_MAX_PAGE_SIZE = 48;

export type DirectoryFilterKey =
  | 'all'
  | 'service'
  | 'clinics'
  | 'reseller'
  | 'rental'
  | 'supplier';

export type DirectoryOrgLike = {
  id?: number | string | null;
  name?: string | null;
  type?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo_url?: string | null;
  description?: string | null;
  contact_name?: string | null;
  contact_person?: string | null;
  is_active?: boolean | null;
};

export type GuestDirectoryCard = {
  id: number | string;
  type: string | null;
  typeLabel: string;
  region: string | null;
  name: typeof GUEST_NAME_PLACEHOLDER;
  initials: typeof GUEST_INITIALS_PLACEHOLDER;
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  hasAddress: boolean;
  phone: typeof GUEST_PHONE_PLACEHOLDER | null;
  email: typeof GUEST_EMAIL_PLACEHOLDER | null;
  address: typeof GUEST_ADDRESS_PLACEHOLDER | null;
};

const PII_KEYS = [
  'name',
  'city',
  'state',
  'address',
  'zip',
  'phone',
  'email',
  'website',
  'logo_url',
  'description',
  'contact_name',
  'contact_person',
] as const;

/** US Census regions — state/city themselves are identifying, the region is not. */
const STATE_TO_REGION: Record<string, string> = {
  CT: 'Northeast',
  ME: 'Northeast',
  MA: 'Northeast',
  NH: 'Northeast',
  RI: 'Northeast',
  VT: 'Northeast',
  NJ: 'Northeast',
  NY: 'Northeast',
  PA: 'Northeast',
  IL: 'Midwest',
  IN: 'Midwest',
  MI: 'Midwest',
  OH: 'Midwest',
  WI: 'Midwest',
  IA: 'Midwest',
  KS: 'Midwest',
  MN: 'Midwest',
  MO: 'Midwest',
  NE: 'Midwest',
  ND: 'Midwest',
  SD: 'Midwest',
  DE: 'South',
  FL: 'South',
  GA: 'South',
  MD: 'South',
  NC: 'South',
  SC: 'South',
  VA: 'South',
  WV: 'South',
  AL: 'South',
  KY: 'South',
  MS: 'South',
  TN: 'South',
  AR: 'South',
  LA: 'South',
  OK: 'South',
  TX: 'South',
  DC: 'South',
  AZ: 'West',
  CO: 'West',
  ID: 'West',
  MT: 'West',
  NV: 'West',
  NM: 'West',
  UT: 'West',
  WY: 'West',
  AK: 'West',
  CA: 'West',
  HI: 'West',
  OR: 'West',
  WA: 'West',
  AB: 'Canada',
  BC: 'Canada',
  MB: 'Canada',
  NB: 'Canada',
  NL: 'Canada',
  NS: 'Canada',
  NT: 'Canada',
  NU: 'Canada',
  ON: 'Canada',
  PE: 'Canada',
  QC: 'Canada',
  SK: 'Canada',
  YT: 'Canada',
};

const STATE_NAME_TO_REGION: Record<string, string> = {
  connecticut: 'Northeast',
  maine: 'Northeast',
  massachusetts: 'Northeast',
  'new hampshire': 'Northeast',
  'rhode island': 'Northeast',
  vermont: 'Northeast',
  'new jersey': 'Northeast',
  'new york': 'Northeast',
  pennsylvania: 'Northeast',
  illinois: 'Midwest',
  indiana: 'Midwest',
  michigan: 'Midwest',
  ohio: 'Midwest',
  wisconsin: 'Midwest',
  iowa: 'Midwest',
  kansas: 'Midwest',
  minnesota: 'Midwest',
  missouri: 'Midwest',
  nebraska: 'Midwest',
  'north dakota': 'Midwest',
  'south dakota': 'Midwest',
  delaware: 'South',
  florida: 'South',
  georgia: 'South',
  maryland: 'South',
  'north carolina': 'South',
  'south carolina': 'South',
  virginia: 'South',
  'west virginia': 'South',
  alabama: 'South',
  kentucky: 'South',
  mississippi: 'South',
  tennessee: 'South',
  arkansas: 'South',
  louisiana: 'South',
  oklahoma: 'South',
  texas: 'South',
  'district of columbia': 'South',
  arizona: 'West',
  colorado: 'West',
  idaho: 'West',
  montana: 'West',
  nevada: 'West',
  'new mexico': 'West',
  utah: 'West',
  wyoming: 'West',
  alaska: 'West',
  california: 'West',
  hawaii: 'West',
  oregon: 'West',
  washington: 'West',
  alberta: 'Canada',
  'british columbia': 'Canada',
  manitoba: 'Canada',
  'new brunswick': 'Canada',
  'newfoundland and labrador': 'Canada',
  'nova scotia': 'Canada',
  ontario: 'Canada',
  'prince edward island': 'Canada',
  quebec: 'Canada',
  saskatchewan: 'Canada',
};

export function regionFromState(state?: string | null): string | null {
  const raw = String(state || '').trim();
  if (!raw) return null;
  const abbr = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (abbr.length === 2 && STATE_TO_REGION[abbr]) return STATE_TO_REGION[abbr];
  const name = raw.toLowerCase().replace(/\./g, '').trim();
  return STATE_NAME_TO_REGION[name] || null;
}

export function guestDirectoryTypeFilter(filter: string | null | undefined): string[] | null {
  switch (String(filter || 'all').toLowerCase()) {
    case 'service':
      return ['service_company', 'service'];
    case 'clinics':
      return ['customer', 'laser_clinic'];
    case 'reseller':
      return ['laser_reseller'];
    case 'rental':
      return ['laser_rental'];
    case 'supplier':
      return ['parts_supplier', 'vendor'];
    default:
      return null;
  }
}

export function matchesGuestDirectoryFilter(
  type: string | null | undefined,
  filter: DirectoryFilterKey
): boolean {
  const t = String(type || '').toLowerCase();
  if (filter === 'service') return isServiceOrgType(t) || t === 'service';
  if (filter === 'clinics') return t === 'customer' || t === 'laser_clinic';
  if (filter === 'reseller') return t === 'laser_reseller';
  if (filter === 'rental') return t === 'laser_rental';
  if (filter === 'supplier') return t === 'parts_supplier' || t === 'vendor';
  return true;
}

function present(value?: string | null): boolean {
  return Boolean(value && String(value).trim());
}

/**
 * Map a real Organizations row to a guest card.
 * Placeholders only — the real name / phone / address / city are dropped.
 */
export function redactDirectoryOrg(org: DirectoryOrgLike): GuestDirectoryCard {
  const id = org.id ?? 'org';
  const type = org.type ? String(org.type) : null;
  const hasPhone = present(org.phone);
  const hasEmail = present(org.email);
  const hasWebsite = present(org.website);
  const hasAddress = present(org.address) || present(org.city) || present(org.zip);
  return {
    id,
    type,
    typeLabel: orgTypeLabel(type) || 'Organization',
    region: regionFromState(org.state),
    name: GUEST_NAME_PLACEHOLDER,
    initials: GUEST_INITIALS_PLACEHOLDER,
    hasPhone,
    hasEmail,
    hasWebsite,
    hasAddress,
    phone: hasPhone ? GUEST_PHONE_PLACEHOLDER : null,
    email: hasEmail ? GUEST_EMAIL_PLACEHOLDER : null,
    address: hasAddress ? GUEST_ADDRESS_PLACEHOLDER : null,
  };
}

export function clampGuestDirectoryPageSize(raw?: string | number | null): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(n)) return GUEST_DIRECTORY_PAGE_SIZE;
  return Math.min(GUEST_DIRECTORY_MAX_PAGE_SIZE, Math.max(1, Math.floor(n)));
}

export function displayGuestDirectoryField(signedIn: boolean, value: string, placeholder: string): string {
  return signedIn ? value : placeholder;
}

/** True if a serialized guest card still contains any identifying string from the source row. */
export function guestCardLeaksPii(card: GuestDirectoryCard, source: DirectoryOrgLike): boolean {
  const blob = JSON.stringify(card).toLowerCase();
  for (const key of PII_KEYS) {
    const raw = source[key];
    const text = String(raw || '').trim().toLowerCase();
    if (text.length >= 3 && blob.includes(text)) return true;
  }
  return false;
}
