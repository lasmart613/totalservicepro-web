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
import { normalizeRegionInput } from './geo.ts';
import { emptySocialFields, socialPayloadFromForm, type SocialFormFields } from './social-links.ts';
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
] as const;

export function customerOrgPayload(
  form: CustomerInfoFormValues,
  extras?: Record<string, unknown>
): Record<string, unknown> {
  const biz = form.biz_type.trim() || null;
  const region = normalizeRegionInput(form.state);
  return {
    name: form.name.trim(),
    address: form.address.trim() || null,
    city: form.city.trim() || null,
    state: region.state,
    // Override a leftover CHAR(3) DEFAULT such as 'United States'.
    ...(region.country ? { country: region.country } : {}),
    zip: form.zip.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    website: form.website.trim() || null,
    notes: form.notes.trim() || null,
    biz_type: biz,
    facility_type: biz,
    // Empty array can still be written into a leftover CHAR(n) specialties column.
    ...(form.specialties.length ? { specialties: form.specialties } : {}),
    contact_name: form.contact_name.trim() || null,
    logo_url: form.logo_url.trim() && !isBlobLogoUrl(form.logo_url) ? form.logo_url.trim() : null,
    ...socialPayloadFromForm(form),
    ...extras,
  };
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

/**
 * Create a customer org and link it to the caller's service company.
 * Same tables as the former Company Profile CRM path: organizations + organization_customers.
 */
export async function createLinkedCustomer(
  supabase: SupabaseClient,
  opts: {
    serviceOrgId: string | number;
    form: CustomerInfoFormValues;
    createdBy?: string | null;
    logoFile?: File | null;
  }
): Promise<{ id: string | number; logoWarning?: string }> {
  const err = validateCustomerForm(opts.form);
  if (err) throw new Error(err);
  if (!opts.serviceOrgId) throw new Error('Your organization is not loaded yet.');

  const payload: Record<string, unknown> = customerOrgPayload(opts.form, {
    type: 'customer',
    is_active: true,
    // Fits CHAR(3) if a trigger/default copies name into ticket_prefix.
    ticket_prefix: shortTicketPrefix(opts.form.name),
    ...(opts.createdBy ? { created_by: opts.createdBy } : {}),
  });

  const { data, error } = await insertOmittingCharOverflow(supabase, 'organizations', payload, {
    select: 'id',
    maxAttempts: 24,
  });
  const created = data?.id != null ? { id: data.id as string | number } : null;
  if (error || !created) {
    throw new Error(error?.message || 'Failed to add customer');
  }

  const linkPayload: Record<string, unknown> = {
    service_organization_id: opts.serviceOrgId,
    customer_organization_id: created.id,
    ...(opts.createdBy ? { created_by: opts.createdBy } : {}),
  };
  const { error: linkErr } = await insertOmittingCharOverflow(
    supabase,
    'organization_customers',
    linkPayload
  );
  if (linkErr && !/duplicate|unique|23505/i.test(linkErr.message || '')) {
    // Customer row exists; still surface the link failure so Directory can show a reason.
    console.warn('organization_customers link failed:', linkErr);
    throw new Error(linkErr.message || 'Customer created but could not be linked to your directory');
  }

  if (opts.logoFile) {
    try {
      await persistCustomerLogo(supabase, created.id, opts.logoFile);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('customer logo upload', e);
      return { id: created.id, logoWarning: message || 'Customer saved, but the logo did not upload.' };
    }
  }

  return created;
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

export const LINKED_CUSTOMER_RECENT_LIMIT = 12;
export const LINKED_CUSTOMER_SEARCH_LIMIT = 20;

const LINKED_CUSTOMER_ORG_SELECT =
  'id, name, address, city, state, zip, phone, email, contact_name';

const LINKED_CUSTOMER_EMBED =
  'customer_organization_id, created_at, organizations:customer_organization_id!inner(id, name, address, city, state, zip, phone, email, contact_name)';

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
};

/** Customers assigned to this service company via organization_customers (Luxor directory, etc.). */
export async function loadLinkedCustomers(
  supabase: SupabaseClient,
  serviceOrgId: string | number
): Promise<LinkedCustomerOpt[]> {
  const { data: links, error: linkErr } = await fetchAllPages<{ customer_organization_id: any }>(
    (from, to) =>
      supabase
        .from('organization_customers')
        .select('customer_organization_id')
        .eq('service_organization_id', serviceOrgId)
        .range(from, to)
  );
  if (linkErr) {
    console.warn('organization_customers load failed:', linkErr);
    return [];
  }

  const customerIds = uniqueLinkedIds(links);
  if (!customerIds.length) return [];

  const orgSelect = 'id, name, address, city, state, zip, phone, email, contact_name, type';
  const rows: any[] = [];
  for (const chunk of chunkIds(customerIds)) {
    let { data, error } = await supabase
      .from('organizations')
      .select(orgSelect)
      .in('id', chunk)
      .in('type', LINKED_CUSTOMER_TYPES);
    if (error) {
      ({ data, error } = await supabase.from('organizations').select(orgSelect).in('id', chunk));
    }
    if (error) {
      console.warn('linked customer orgs load failed:', error);
      break;
    }
    rows.push(...(data || []));
  }

  return rows
    .filter((c) => c?.id != null && String(c.name || '').trim())
    .map((c) => ({
      id: c.id,
      name: String(c.name || '').trim(),
      address: c.address,
      city: c.city,
      state: c.state,
      zip: c.zip,
      phone: c.phone,
      email: c.email,
      contact: c.contact_name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Strip PostgREST `.or()` / `ilike` metacharacters so user input cannot break the filter. */
export function sanitizeIlikeTerm(raw: string): string {
  return String(raw || '')
    .replace(/[%_,.()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapOrgRow(c: any): LinkedCustomerOpt | null {
  if (c?.id == null) return null;
  const name = String(c.name || '').trim();
  if (!name) return null;
  return {
    id: c.id,
    name,
    address: c.address ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
    zip: c.zip ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    contact: c.contact_name ?? c.contact ?? null,
  };
}

function unwrapEmbeddedOrg(row: any): any | null {
  const org = row?.organizations;
  if (!org) return null;
  return Array.isArray(org) ? org[0] || null : org;
}

function mapEmbeddedLinks(rows: any[] | null | undefined): LinkedCustomerOpt[] {
  const seen = new Set<string>();
  const out: LinkedCustomerOpt[] = [];
  for (const row of rows || []) {
    const mapped = mapOrgRow(unwrapEmbeddedOrg(row));
    if (!mapped) continue;
    const key = String(mapped.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }
  return out;
}

async function fetchOrgsByIds(
  supabase: SupabaseClient,
  ids: Array<string | number>
): Promise<LinkedCustomerOpt[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('organizations')
    .select(LINKED_CUSTOMER_ORG_SELECT)
    .in('id', ids);
  if (error) {
    console.warn('linked customer orgs by id failed:', error);
    return [];
  }
  const byId = new Map<string, LinkedCustomerOpt>();
  for (const row of data || []) {
    const mapped = mapOrgRow(row);
    if (mapped) byId.set(String(mapped.id), mapped);
  }
  return ids.map((id) => byId.get(String(id))).filter((c): c is LinkedCustomerOpt => !!c);
}

function applyOrgNameCityOr<T extends { or: (filters: string, opts?: Record<string, string>) => T }>(
  query: T,
  term: string
): T {
  const filter = `name.ilike.%${term}%,city.ilike.%${term}%`;
  return query.or(filter, { referencedTable: 'organizations' });
}

/**
 * Typeahead loader for estimate / invoice / report / ticket company pickers.
 * Empty query → ~12 most recently linked customers (created_at desc, then id desc).
 * Typed query → server-side ilike on org name/city among THIS service org's links (~20).
 * Never dumps the full 1,700+ directory into the client or PostgREST `.in()` URL.
 */
export async function searchLinkedCustomers(
  supabase: SupabaseClient,
  serviceOrgId: string | number,
  query: string,
  opts?: { recentLimit?: number; searchLimit?: number }
): Promise<LinkedCustomerOpt[]> {
  if (serviceOrgId == null || serviceOrgId === '') return [];
  const recentLimit = opts?.recentLimit ?? LINKED_CUSTOMER_RECENT_LIMIT;
  const searchLimit = opts?.searchLimit ?? LINKED_CUSTOMER_SEARCH_LIMIT;
  const term = sanitizeIlikeTerm(query);

  if (!term) {
    let { data: links, error } = await supabase
      .from('organization_customers')
      .select(LINKED_CUSTOMER_EMBED)
      .eq('service_organization_id', serviceOrgId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(recentLimit);

    if (error) {
      ({ data: links, error } = await supabase
        .from('organization_customers')
        .select('customer_organization_id, created_at, id')
        .eq('service_organization_id', serviceOrgId)
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(recentLimit));
      if (error) {
        ({ data: links, error } = await supabase
          .from('organization_customers')
          .select('customer_organization_id, id')
          .eq('service_organization_id', serviceOrgId)
          .order('id', { ascending: false })
          .limit(recentLimit));
      }
      if (error) {
        console.warn('recent linked customers failed:', error);
        return [];
      }
      return fetchOrgsByIds(supabase, uniqueLinkedIds(links));
    }

    const embedded = mapEmbeddedLinks(links);
    if (embedded.length) return embedded;
    return fetchOrgsByIds(supabase, uniqueLinkedIds(links));
  }

  let search = supabase
    .from('organization_customers')
    .select(LINKED_CUSTOMER_EMBED)
    .eq('service_organization_id', serviceOrgId);
  search = applyOrgNameCityOr(search, term);

  let { data: hits, error: searchErr } = await search.limit(searchLimit);

  if (searchErr) {
    let retry = supabase
      .from('organization_customers')
      .select(LINKED_CUSTOMER_EMBED)
      .eq('service_organization_id', serviceOrgId);
    retry = retry.or(`name.ilike.%${term}%,city.ilike.%${term}%`, {
      foreignTable: 'organizations',
    });
    ({ data: hits, error: searchErr } = await retry.limit(searchLimit));
  }

  if (searchErr) {
    console.warn('linked customer search failed:', searchErr);
    return [];
  }

  const embedded = mapEmbeddedLinks(hits);
  if (embedded.length) return embedded;
  return fetchOrgsByIds(supabase, uniqueLinkedIds(hits));
}

export function filterLinkedCustomers(
  customers: LinkedCustomerOpt[],
  query: string,
  limit = 15
): LinkedCustomerOpt[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? customers.filter((c) => {
        const hay = [c.name, c.city, c.state, c.phone, c.email]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
    : customers;
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
