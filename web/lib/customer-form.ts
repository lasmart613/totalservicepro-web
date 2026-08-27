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
