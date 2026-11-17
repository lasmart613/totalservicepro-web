/**
 * Parts-supplier picker. One RPC. Rows stay in the server's A-to-Z order.
 */

import { clampCustomerSearch, LINKED_CUSTOMER_DROPDOWN_LIMIT } from './customer-form.ts';

export type SupplierSearchRow = {
  id: string | number;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type SupplierSearch =
  | { ok: true; suppliers: SupplierSearchRow[] }
  | { ok: false };

type Rpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

function rowFrom(raw: Record<string, unknown> | null | undefined): SupplierSearchRow | null {
  if (!raw || raw.id == null || !String(raw.name || '').trim()) return null;
  return {
    id: raw.id as string | number,
    name: String(raw.name).trim(),
    address: (raw.address as string | null) ?? null,
    city: (raw.city as string | null) ?? null,
    state: (raw.state as string | null) ?? null,
    zip: (raw.zip as string | null) ?? null,
    phone: (raw.phone as string | null) ?? null,
    email: (raw.email as string | null) ?? null,
  };
}

export async function searchSupplierOrgs(supabase: Rpc, query: string): Promise<SupplierSearch> {
  const raw = clampCustomerSearch(query);
  const res = await supabase.rpc('search_supplier_orgs', {
    p_query: raw,
    p_limit: LINKED_CUSTOMER_DROPDOWN_LIMIT,
  });
  if (res?.error) {
    console.warn('supplier search', res.error);
    return { ok: false };
  }
  const rows = Array.isArray(res?.data) ? res.data : [];
  const suppliers: SupplierSearchRow[] = [];
  for (const row of rows) {
    const opt = rowFrom(row as Record<string, unknown>);
    if (opt) suppliers.push(opt);
  }
  return { ok: true, suppliers };
}
