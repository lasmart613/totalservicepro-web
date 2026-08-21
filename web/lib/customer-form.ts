/**
 * Shared CRM customer information form + create/update payload.
 * Used by Customer Directory (add) and customer profile (edit).
 * Inserts/updates `organizations` (type=customer) and links via `organization_customers`.
 */

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
    ...extras,
  };
}

function missingColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

type SupabaseLike = {
  from: (table: string) => any;
};

/**
 * Create a customer org and link it to the caller's service company.
 * Same tables as the former Company Profile CRM path: organizations + organization_customers.
 */
export async function createLinkedCustomer(
  supabase: SupabaseLike,
  opts: {
    serviceOrgId: string | number;
    form: CustomerInfoFormValues;
    createdBy?: string | null;
  }
): Promise<{ id: string | number }> {
  const err = validateCustomerForm(opts.form);
  if (err) throw new Error(err);
  if (!opts.serviceOrgId) throw new Error('Your organization is not loaded yet.');

  let payload: Record<string, unknown> = customerOrgPayload(opts.form, {
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

  const { error: linkErr } = await supabase.from('organization_customers').insert({
    service_organization_id: opts.serviceOrgId,
    customer_organization_id: created.id,
    ...(opts.createdBy ? { created_by: opts.createdBy } : {}),
  });
  if (linkErr && !/duplicate|unique|23505/i.test(linkErr.message || '')) {
    // Customer row exists; still surface the link failure so Directory can show a reason.
    console.warn('organization_customers link failed:', linkErr);
    throw new Error(linkErr.message || 'Customer created but could not be linked to your directory');
  }

  return created;
}

export async function updateCustomerOrg(
  supabase: SupabaseLike,
  customerId: string | number,
  form: CustomerInfoFormValues
): Promise<Record<string, unknown>> {
  const err = validateCustomerForm(form);
  if (err) throw new Error(err);

  let payload: Record<string, unknown> = customerOrgPayload(form, {
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
  return payload;
}

export { OPTIONAL_ORG_COLUMNS };
