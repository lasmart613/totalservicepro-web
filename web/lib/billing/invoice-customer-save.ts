import { parseJsonField } from './save-helpers.ts';

/**
 * Customer fields the invoice editor writes onto service_invoices.
 * The search hit is copied here in the click handler, and save reads this
 * object, so a later invoice reload cannot put the previous clinic back
 * into the payload.
 */

export type InvoiceCustomerDraft = {
  name: string;
  orgId: string | number | null;
  address: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  fax: string;
  email: string;
  contact: string;
};

export function emptyInvoiceCustomerDraft(): InvoiceCustomerDraft {
  return {
    name: '',
    orgId: null,
    address: '',
    addressLine2: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    fax: '',
    email: '',
    contact: '',
  };
}

export function invoiceCustomerDraftFromHit(hit: {
  id: string | number;
  name: string;
  address?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  contact?: string | null;
}): InvoiceCustomerDraft {
  return {
    name: String(hit.name || '').trim(),
    orgId: hit.id,
    address: String(hit.address || ''),
    addressLine2: String(hit.addressLine2 || ''),
    city: String(hit.city || ''),
    state: String(hit.state || ''),
    zip: String(hit.zip || ''),
    phone: String(hit.phone || ''),
    fax: String(hit.fax || ''),
    email: String(hit.email || ''),
    contact: String(hit.contact || ''),
  };
}

export function invoiceCustomerDraftFromRow(row: {
  customer_name?: string | null;
  customer_organization_id?: string | number | null;
  invoice_data?: unknown;
}): InvoiceCustomerDraft {
  const data = parseJsonField(row.invoice_data);
  const text = (key: string) => String(data[key] || '');
  return {
    name: String(row.customer_name || '').trim(),
    orgId: row.customer_organization_id ?? null,
    address: text('custAddress'),
    addressLine2: text('custAddressLine2'),
    city: text('custCity'),
    state: text('custState'),
    zip: text('custZip'),
    phone: text('custPhone'),
    fax: text('custFax'),
    email: text('custEmail'),
    contact: text('custContact'),
  };
}

export function sameInvoiceCustomer(a: InvoiceCustomerDraft, b: InvoiceCustomerDraft): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    String(a.orgId ?? '') === String(b.orgId ?? '') &&
    a.address === b.address &&
    a.addressLine2 === b.addressLine2 &&
    a.city === b.city &&
    a.state === b.state &&
    a.zip === b.zip &&
    a.phone === b.phone &&
    a.fax === b.fax &&
    a.email === b.email &&
    a.contact === b.contact
  );
}

/** Columns and invoice_data keys a customer pick must change on the next save. */
export function invoiceCustomerWrite(draft: InvoiceCustomerDraft): {
  customer_name: string;
  customer_organization_id: string | number | null;
  invoiceData: Pick<
    InvoiceCustomerDraft,
    'address' | 'addressLine2' | 'city' | 'state' | 'zip' | 'phone' | 'fax' | 'email' | 'contact'
  >;
} {
  return {
    customer_name: draft.name.trim(),
    customer_organization_id: draft.orgId ?? null,
    invoiceData: {
      address: draft.address,
      addressLine2: draft.addressLine2,
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
      phone: draft.phone,
      fax: draft.fax,
      email: draft.email,
      contact: draft.contact,
    },
  };
}

/**
 * Saved: a write returned a row.
 * Unchanged: the editor did not call the database.
 * Failed: a write was attempted and no row came back.
 */
export function invoiceSaveToast(input: { unchanged: boolean; persisted: boolean }): 'saved' | 'unchanged' | 'failed' {
  if (input.unchanged) return 'unchanged';
  if (!input.persisted) return 'failed';
  return 'saved';
}
