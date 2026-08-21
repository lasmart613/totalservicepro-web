/**
 * Shared CRM customer information form + create/update payload.
 * Used by Customer Directory (add) and customer profile (edit).
 * Inserts/updates `organizations` (type=customer) and links via `organization_customers`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isBlobLogoUrl, uploadCustomerLogo } from '@/lib/customer-logo';

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
};

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
] as const;

export function customerOrgPayload(
  form: CustomerInfoFormValues,
  extras?: Record<string, unknown>
): Record<string, unknown> {
  const biz = form.biz_type.trim() || null;
  return {
    name: form.name.trim(),
    address: form.address.trim() || null,
    city: form.city.trim() || null,
    state: form.state.trim() || null,
    zip: form.zip.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    website: form.website.trim() || null,
    notes: form.notes.trim() || null,
    biz_type: biz,
    facility_type: biz,
    specialties: form.specialties,
    contact_name: form.contact_name.trim() || null,
    logo_url: form.logo_url.trim() && !isBlobLogoUrl(form.logo_url) ? form.logo_url.trim() : null,
    ...extras,
  };
}

function missingColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

/**
 * Create a customer org and link it to the caller's service company.
 * Same tables as the former Company Profile CRM path: organizations + organization_customers.
 */
export async function persistCustomerLogo(
  supabase: SupabaseClient,
  customerId: string | number,
  logoFile: File | null | undefined
): Promise<string | null> {
  if (!logoFile) return null;
  const url = await uploadCustomerLogo(supabase, customerId, logoFile);
  const { error } = await supabase.from('organizations').update({ logo_url: url }).eq('id', customerId);
  if (error && !missingColumn(error.message)) {
    throw new Error(error.message || 'Logo uploaded but could not be saved on the customer');
  }
  return url;
}

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
    ...(opts.createdBy ? { created_by: opts.createdBy } : {}),
  });

  let created: { id: string | number } | null = null;
  let lastError: { message?: string } | null = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await supabase
      .from('organizations')
      .insert(payload)
      .select('id')
      .single();
    if (!error && data?.id != null) {
      created = data;
      lastError = null;
      break;
    }
    lastError = error;
    const col = missingColumn(error?.message);
    if (col && col in payload) {
      delete payload[col];
      continue;
    }
    break;
  }

  if (lastError || !created) {
    throw new Error(lastError?.message || 'Failed to add customer');
  }

  const linkPayload: Record<string, unknown> = {
    service_organization_id: opts.serviceOrgId,
    customer_organization_id: created.id,
    ...(opts.createdBy ? { created_by: opts.createdBy } : {}),
  };
  let linkErr = (await supabase.from('organization_customers').insert(linkPayload)).error;
  if (linkErr && missingColumn(linkErr.message) === 'created_by' && 'created_by' in linkPayload) {
    delete linkPayload.created_by;
    linkErr = (await supabase.from('organization_customers').insert(linkPayload)).error;
  }
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
  let lastError: { message?: string } | null = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const { error } = await supabase.from('organizations').update(payload).eq('id', customerId);
    if (!error) {
      lastError = null;
      break;
    }
    lastError = error;
    const col = missingColumn(error?.message);
    if (col && col in payload) {
      delete payload[col];
      continue;
    }
    break;
  }

  if (lastError) throw new Error(lastError.message || 'Save failed');

  if (opts?.logoFile) {
    const url = await persistCustomerLogo(supabase, customerId, opts.logoFile);
    if (url) payload.logo_url = url;
  }

  return payload;
}

export { OPTIONAL_ORG_COLUMNS };
