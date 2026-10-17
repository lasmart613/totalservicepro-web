/**
 * Shared CRM customer information form + create/update payload.
 * Used by Customer Directory (add) and customer profile (edit).
 * Inserts/updates `organizations` (type=customer) and links via `organization_customers`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  charLimitFromError,
  insertOmittingCharOverflow,
  missingColumn,
  shortTicketPrefix,
  stripOverflowingAddressFields,
  updateOmittingCharOverflow,
} from './char-overflow.ts';
import { isBlobLogoUrl, uploadCustomerLogo } from './customer-logo.ts';
import {
  applyDirectoryContactToLinked,
  emptyDirectoryContacts,
  ensurePrimaryDirectoryRole,
  hydrateDirectoryContacts,
  persistDirectoryContacts,
  roleDisplayName,
  serializeDirectoryContacts,
  type DirectoryContactsState,
  type DirectoryContactRow,
} from './customer-contacts.ts';
import { normalizeRegionInput } from './geo.ts';
import { syncPrimaryLocationFromForm } from './customer-locations.ts';
import { emptySocialFields, type SocialFormFields } from './social-links.ts';
import { chunkIds, fetchAllPages, uniqueLinkedIds } from './supabase/paginate.ts';

export const CUSTOMER_BIZ_TYPES = [
  'Medical Spa',
  'Dermatology Clinic',
  'Plastic Surgery Center',
  'Hair Removal Clinic',
  'Cosmetic Surgery Center',
  'Wellness Center',
  'Hospital / Health System',
  'Other',
] as const;

export const CUSTOMER_SPECIALTIES = [
  'Hair Removal',
  'Skin Resurfacing',
  'Tattoo Removal',
  'Vascular Lesions',
  'Pigmentation',
  'Body Contouring',
  'Anti-aging / Wrinkles',
  'Acne Treatment',
  'Scar Revision',
  'Nail Fungus',
  'Photodynamic Therapy',
  'Fractional Laser',
  'RF Microneedling',
  'IPL Photofacial',
  'Laser Lipolysis',
] as const;

export type CustomerInfoFormValues = {
  name: string;
  biz_type: string;
  website: string;
  notes: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  contact_name: string;
  directory: DirectoryContactsState;
  specialties: string[];
  logo_url: string;
} & SocialFormFields;

export function emptyCustomerForm(): CustomerInfoFormValues {
  return {
    name: '',
    biz_type: '',
    website: '',
    notes: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    contact_name: '',
    directory: emptyDirectoryContacts(),
    specialties: [],
    logo_url: '',
    ...emptySocialFields(),
  };
}

export function validateCustomerForm(form: CustomerInfoFormValues): string | null {
  if (!form.name.trim()) return 'Business name is required';
  return null;
}

/** Columns that may be missing on older DB schemas — strip and retry. */
const OPTIONAL_ORG_COLUMNS = [
  'biz_type',
  'facility_type',
  'specialties',
  'contact_name',
  'website',
  'notes',
  'zip',
  'email',
  'created_by',
  'is_active',
  'updated_at',
  'logo_url',
  'x_url',
  'instagram_url',
  'facebook_url',
  'tiktok_url',
  'youtube_url',
  'linkedin_url',
  'yelp_url',
  'threads_url',
  'directory_contacts',
] as const;

export function customerOrgPayload(
  form: CustomerInfoFormValues,
  extras?: Record<string, unknown>
): Record<string, unknown> {
  const biz = form.biz_type.trim() || null;
  const region = normalizeRegionInput(form.state);
  const directory = ensurePrimaryDirectoryRole(form.directory || emptyDirectoryContacts());
  const primaryName = directory.primaryRole
    ? roleDisplayName(directory.roles[directory.primaryRole])
    : '';
  const row: Record<string, unknown> = {
    name: form.name.trim(),
    address: form.address.trim() || null,
    city: form.city.trim() || null,
    state: region.state,
    zip: form.zip.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    website: form.website.trim() || null,
    notes: form.notes.trim() || null,
    biz_type: biz,
    facility_type: biz,
    // Live specialties is text[]. Omit an empty array; never send a string.
    ...(form.specialties.length ? { specialties: form.specialties } : {}),
    contact_name: primaryName || form.contact_name.trim() || null,
    directory_contacts: serializeDirectoryContacts(directory),
    logo_url: form.logo_url.trim() && !isBlobLogoUrl(form.logo_url) ? form.logo_url.trim() : null,
    ...extras,
  };
  return finalizeOrganizationPayload(row);
}

/**
 * Live organizations columns (PostgREST schema cache).
 * Social URL columns and country are not on the table — sending them is a
 * PGRST204 per column, and a new customer with a state used to burn 9 of those
 * (8 social nulls + country) before the insert succeeded.
 * There is no contact or organization_type column.
 * list_in_directory and storefront_enabled are boolean NOT NULL default false.
 */
const ORG_COLUMNS_NOT_ON_LIVE = new Set([
  'country',
  'country_code',
  'currency',
  'postal_code',
  'contact',
  'contact_person',
  'organization_type',
  'x_url',
  'instagram_url',
  'facebook_url',
  'tiktok_url',
  'youtube_url',
  'linkedin_url',
  'yelp_url',
  'threads_url',
]);

const ORG_TYPE_VALUES = new Set([
  'service_company',
  'vendor',
  'parts_supplier',
  'customer',
  'laser_clinic',
  'laser_rental',
  'laser_reseller',
]);

const ORG_TEXT_ARRAYS = ['supported_brands', 'service_territories', 'specialties'] as const;

function asOrgTextArray(val: unknown): string[] | undefined {
  if (val == null || val === '') return undefined;
  const items = Array.isArray(val) ? val : typeof val === 'string' ? val.split(/[,|]/) : [];
  const out = items.map((item) => String(item).trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function asOrgJsonObject(val: unknown): Record<string, unknown> | undefined {
  if (val == null || val === '') return undefined;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
  return undefined;
}

/** Shape an organizations insert/update so the first PostgREST call matches live columns. */
export function finalizeOrganizationPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (ORG_COLUMNS_NOT_ON_LIVE.has(key)) continue;
    if (key === 'list_in_directory' || key === 'storefront_enabled') {
      if (typeof val === 'boolean') out[key] = val;
      continue;
    }
    if ((ORG_TEXT_ARRAYS as readonly string[]).includes(key)) {
      const arr = asOrgTextArray(val);
      if (arr) out[key] = arr;
      continue;
    }
    if (key === 'directory_contacts') {
      const json = asOrgJsonObject(val);
      if (json) out[key] = json;
      continue;
    }
    if (key === 'ticket_prefix') {
      out[key] = shortTicketPrefix(typeof val === 'string' ? val : '');
      continue;
    }
    if (key === 'type') {
      const t = String(val ?? '').trim();
      out[key] = ORG_TYPE_VALUES.has(t) ? t : 'customer';
      continue;
    }
    out[key] = val;
  }
  return out;
}

export function directoryFormFromOrg(
  org: Record<string, unknown>,
  contactRows?: DirectoryContactRow[] | null
): DirectoryContactsState {
  return hydrateDirectoryContacts({
    directoryContacts: org.directory_contacts,
    contactRows,
  });
}

export async function persistCustomerLogo(
  supabase: SupabaseClient,
  customerId: string | number,
  logoFile: File | null | undefined
): Promise<string | null> {
  if (!logoFile) return null;
  const url = await uploadCustomerLogo(supabase, customerId, logoFile);
  const { error } = await updateOmittingCharOverflow(
    supabase,
    'organizations',
    { logo_url: url },
    { column: 'id', value: customerId }
  );
  if (error && !missingColumn(error)) {
    throw new Error(error.message || 'Logo uploaded but could not be saved on the customer');
  }
  return url;
}

/** Organization columns create_shop_customer_org writes itself. */
const SHOP_CUSTOMER_RPC_COLUMNS = new Set([
  'name', 'type', 'created_by', 'address', 'city', 'state', 'phone', 'laser_models', 'facility_type',
  // Not sent afterwards either: the row has the defaults / trigger values.
  'is_active', 'ticket_prefix',
]);

function textOrNull(value: unknown): string | null {
  const text = value == null ? '' : String(value).trim();
  return text ? text : null;
}

/** Same caps as create_shop_customer_org (000919): longer is refused with 22001. */
export const SHOP_CUSTOMER_TEXT_CAPS = {
  name: 200,
  address: 500,
  city: 100,
  state: 100,
  phone: 50,
  laserModels: 1000,
  facilityType: 100,
} as const;

const SHOP_CUSTOMER_CAP_LABELS: Record<keyof typeof SHOP_CUSTOMER_TEXT_CAPS, string> = {
  name: 'Customer name',
  address: 'Address',
  city: 'City',
  state: 'State',
  phone: 'Phone',
  laserModels: 'Laser models',
  facilityType: 'Facility type',
};

/** First field over its cap, as a user-facing message; null when all fit. */
export function shopCustomerTextTooLong(fields: Partial<Record<keyof typeof SHOP_CUSTOMER_TEXT_CAPS, string | null>>): string | null {
  for (const key of Object.keys(SHOP_CUSTOMER_TEXT_CAPS) as (keyof typeof SHOP_CUSTOMER_TEXT_CAPS)[]) {
    const value = fields[key];
    if (value != null && value.length > SHOP_CUSTOMER_TEXT_CAPS[key]) {
      return `${SHOP_CUSTOMER_CAP_LABELS[key]} is too long (max ${SHOP_CUSTOMER_TEXT_CAPS[key]} characters).`;
    }
  }
  return null;
}

/**
 * Create a customer org for a service company: organizations row and its
 * organization_customers link in ONE transaction (create_shop_customer_org,
 * 000917/000919). The caller must be a current member of that service
 * company; created_by is the caller. Throws with the database message on any
 * error, so nothing is created half-way and nothing fails silently. Never
 * insert a customer org from the browser and link it in a second request: an
 * unlinked shop-created org was founder-claimable after the creator left.
 */
export async function createShopCustomerOrg(
  supabase: Pick<SupabaseClient, 'rpc'>,
  opts: {
    serviceOrgId: string | number | null | undefined;
    name: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    phone?: string | null;
    laserModels?: string | null;
    facilityType?: string | null;
  }
): Promise<number> {
  if (opts.serviceOrgId == null || opts.serviceOrgId === '') {
    throw new Error('Your organization is not loaded yet.');
  }
  const name = textOrNull(opts.name);
  if (!name) throw new Error('Customer name is required.');
  const fields = {
    name,
    address: textOrNull(opts.address),
    city: textOrNull(opts.city),
    state: textOrNull(opts.state),
    phone: textOrNull(opts.phone),
    laserModels: textOrNull(opts.laserModels),
    facilityType: textOrNull(opts.facilityType) || 'Clinic',
  };
  const tooLong = shopCustomerTextTooLong(fields);
  if (tooLong) throw new Error(tooLong);
  // Over 30 creates per user per hour the RPC raises PT429 (HTTP 429); its
  // message is shown as is.
  const { data, error } = await supabase.rpc('create_shop_customer_org', {
    p_service_org: Number(opts.serviceOrgId),
    p_name: fields.name,
    p_address: fields.address,
    p_city: fields.city,
    p_state: fields.state,
    p_phone: fields.phone,
    p_laser_models: fields.laserModels,
    p_facility_type: fields.facilityType,
  });
  if (error) throw new Error(error.message || 'Failed to add customer');
  const id = Number(data);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Failed to add customer');
  return id;
}

/**
 * Create a customer org and link it to the caller's service company.
 * Org + link are one RPC transaction (createShopCustomerOrg); the remaining
 * form fields are then written to the new, already-linked row. If that second
 * write fails the customer still exists (linked), and detailsWarning says so.
 */
export async function createLinkedCustomer(
  supabase: SupabaseClient,
  opts: {
    serviceOrgId: string | number;
    form: CustomerInfoFormValues;
    /** Ignored: the RPC sets created_by to the signed-in caller. */
    createdBy?: string | null;
    logoFile?: File | null;
  }
): Promise<{ id: string | number; logoWarning?: string; detailsWarning?: string }> {
  const err = validateCustomerForm(opts.form);
  if (err) throw new Error(err);
  if (!opts.serviceOrgId) throw new Error('Your organization is not loaded yet.');

  const payload: Record<string, unknown> = customerOrgPayload(opts.form);
  const id = await createShopCustomerOrg(supabase, {
    serviceOrgId: opts.serviceOrgId,
    name: String(payload.name || opts.form.name),
    address: payload.address as string | null,
    city: payload.city as string | null,
    state: payload.state as string | null,
    phone: payload.phone as string | null,
    facilityType: payload.facility_type as string | null,
  });
  const created = { id: id as string | number };

  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SHOP_CUSTOMER_RPC_COLUMNS.has(key)) details[key] = value;
  }
  let detailsWarning: string | undefined;
  if (Object.keys(details).length) {
    const { error: detailErr } = await updateOmittingCharOverflow(
      supabase,
      'organizations',
      details,
      { column: 'id', value: created.id },
      { maxAttempts: 24 }
    );
    if (detailErr) {
      console.warn('customer details after create', detailErr);
      detailsWarning = `Customer added, but some details were not saved: ${detailErr.message || 'unknown error'}`;
    }
  }

  let logoWarning: string | undefined;
  if (opts.logoFile) {
    try {
      await persistCustomerLogo(supabase, created.id, opts.logoFile);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('customer logo upload', e);
      logoWarning = message || 'Customer saved, but the logo did not upload.';
    }
  }

  try {
    await persistDirectoryContacts(
      supabase,
      created.id,
      ensurePrimaryDirectoryRole(opts.form.directory || emptyDirectoryContacts())
    );
  } catch (e) {
    console.warn('directory contacts sync', e);
  }

  try {
    await syncPrimaryLocationFromForm(supabase, created.id, opts.form);
  } catch (e) {
    console.warn('primary location sync', e);
  }

  return {
    ...created,
    ...(logoWarning ? { logoWarning } : {}),
    ...(detailsWarning ? { detailsWarning } : {}),
  };
}

export async function updateCustomerOrg(
  supabase: SupabaseClient,
  customerId: string | number,
  form: CustomerInfoFormValues,
  opts?: { logoFile?: File | null }
): Promise<Record<string, unknown>> {
  const err = validateCustomerForm(form);
  if (err) throw new Error(err);

  const payload: Record<string, unknown> = customerOrgPayload(form, {
    updated_at: new Date().toISOString(),
  });
  const { error } = await updateOmittingCharOverflow(
    supabase,
    'organizations',
    payload,
    { column: 'id', value: customerId },
    { maxAttempts: 24 }
  );
  if (error) throw new Error(error.message || 'Save failed');

  if (opts?.logoFile) {
    const url = await persistCustomerLogo(supabase, customerId, opts.logoFile);
    if (url) payload.logo_url = url;
  }

  try {
    await persistDirectoryContacts(
      supabase,
      customerId,
      ensurePrimaryDirectoryRole(form.directory || emptyDirectoryContacts())
    );
  } catch (e) {
    console.warn('directory contacts sync', e);
  }

  try {
    await syncPrimaryLocationFromForm(supabase, customerId, form);
  } catch (e) {
    console.warn('primary location sync', e);
  }

  return payload;
}

export {
  OPTIONAL_ORG_COLUMNS,
  charLimitFromError,
  insertOmittingCharOverflow,
  shortTicketPrefix,
  stripOverflowingAddressFields,
};

const LINKED_CUSTOMER_TYPES = ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller'];

export const LINKED_CUSTOMER_DROPDOWN_LIMIT = 12;

export type LinkedCustomerOpt = {
  id: string | number;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  contact?: string | null;
  contactRole?: string | null;
  /** organizations.phone before directory-contact override. */
  officePhone?: string | null;
  /** organization_customers.created_at — used only for empty-dropdown recency. */
  linkedAt?: string | null;
};

type LinkRow = { customer_organization_id?: string | number | null; created_at?: string | null };

function latestLinkedAt(links: LinkRow[] | null | undefined): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of links || []) {
    const id = row?.customer_organization_id;
    if (id == null || !row.created_at) continue;
    const key = String(id);
    const prev = latest.get(key);
    if (!prev || row.created_at > prev) latest.set(key, row.created_at);
  }
  return latest;
}

/**
 * Customers assigned to this service company via organization_customers.
 * Pages every link (same as /customers) — never a silent 500 cap.
 */
export async function loadLinkedCustomers(
  supabase: SupabaseClient,
  serviceOrgId: string | number
): Promise<LinkedCustomerOpt[]> {
  let { data: links, error: linkErr } = await fetchAllPages<LinkRow>((from, to) =>
    supabase
      .from('organization_customers')
      .select('customer_organization_id, created_at')
      .eq('service_organization_id', serviceOrgId)
      .range(from, to)
  );
  if (linkErr) {
    ({ data: links, error: linkErr } = await fetchAllPages<LinkRow>((from, to) =>
      supabase
        .from('organization_customers')
        .select('customer_organization_id')
        .eq('service_organization_id', serviceOrgId)
        .range(from, to)
    ));
  }
  if (linkErr) {
    console.warn('organization_customers load failed:', linkErr);
    return [];
  }

  const customerIds = uniqueLinkedIds(links);
  if (!customerIds.length) return [];
  const linkedAt = latestLinkedAt(links);

  const orgSelectFull =
    'id, name, address, city, state, zip, phone, email, contact_name, type, directory_contacts';
  const orgSelect = 'id, name, address, city, state, zip, phone, email, contact_name, type';
  const rows: any[] = [];
  for (const chunk of chunkIds(customerIds)) {
    let { data, error } = await supabase
      .from('organizations')
      .select(orgSelectFull)
      .in('id', chunk)
      .in('type', LINKED_CUSTOMER_TYPES);
    if (error) {
      ({ data, error } = await supabase
        .from('organizations')
        .select(orgSelect)
        .in('id', chunk)
        .in('type', LINKED_CUSTOMER_TYPES));
    }
    if (error) {
      ({ data, error } = await supabase.from('organizations').select(orgSelect).in('id', chunk));
    }
    if (error) {
      console.warn('linked customer orgs load failed:', error);
      break;
    }
    rows.push(...(data || []));
  }

  const contactsByOrg = new Map<string, DirectoryContactRow[]>();
  for (const chunk of chunkIds(customerIds)) {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, title, phone, email, is_primary, organization_id')
        .in('organization_id', chunk)
        .limit(200);
      if (error || !data) continue;
      for (const row of data as Array<DirectoryContactRow & { organization_id?: string | number }>) {
        const key = String(row.organization_id ?? '');
        if (!key) continue;
        const list = contactsByOrg.get(key) || [];
        list.push(row);
        contactsByOrg.set(key, list);
      }
    } catch {
      break;
    }
  }

  return rows
    .filter((c) => c?.id != null && String(c.name || '').trim())
    .map((c) => {
      const applied = applyDirectoryContactToLinked({
        contact_name: c.contact_name,
        email: c.email,
        phone: c.phone,
        directory_contacts: c.directory_contacts,
        contactRows: contactsByOrg.get(String(c.id)) || [],
      });
      return {
        id: c.id,
        name: String(c.name || '').trim(),
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
        phone: applied.phone,
        email: applied.email,
        contact: applied.contact,
        contactRole: applied.contactRole,
        officePhone: c.phone,
        linkedAt: linkedAt.get(String(c.id)) || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Alias used by estimate / invoice / report company pickers. */
export const loadLinkedCustomerOrgs = loadLinkedCustomers;

export function filterLinkedCustomers(
  customers: LinkedCustomerOpt[],
  query: string,
  limit = LINKED_CUSTOMER_DROPDOWN_LIMIT
): LinkedCustomerOpt[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? customers.filter((c) => {
        const hay = [c.name, c.city, c.state, c.phone, c.email, c.contact]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
    : [...customers].sort((a, b) => {
        const at = a.linkedAt || '';
        const bt = b.linkedAt || '';
        if (at !== bt) return bt.localeCompare(at);
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  // Slice is UI-only. The caller must keep the full loaded set uncapped.
  return list.slice(0, limit);
}

export function matchLinkedCustomer(
  customers: LinkedCustomerOpt[],
  name: string
): LinkedCustomerOpt | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return customers.find((c) => c.name.trim().toLowerCase() === key) || null;
}
