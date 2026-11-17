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

export const SUPPLIER_ORG_TYPES = ['parts_supplier', 'supplier', 'vendor'] as const;

/** One page plus a probe row. The extra row is not shown; it only means another page exists. */
export function supplierResultPage(
  rows: SupplierSearchRow[],
  pageSize = LINKED_CUSTOMER_DROPDOWN_LIMIT
): { shown: SupplierSearchRow[]; hasMore: boolean } {
  return {
    shown: rows.slice(0, pageSize),
    hasMore: rows.length > pageSize,
  };
}

/** The typed name matches exactly one row. Two matches stay unpicked. */
export function exactSupplierByName(
  rows: SupplierSearchRow[],
  typed: string
): SupplierSearchRow | null {
  const key = typed.trim().toLowerCase();
  if (!key) return null;
  const hits = rows.filter((row) => row.name.trim().toLowerCase() === key);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Auto-pick uses the text in the box now, not the query that started the request.
 * A click already made is left alone. "Acme" results must not replace "Acme Parts".
 */
export function supplierPickForCurrentText(
  rows: SupplierSearchRow[],
  currentText: string,
  explicitPick: boolean
): SupplierSearchRow | null {
  if (explicitPick) return null;
  return exactSupplierByName(rows, currentText);
}

export function mergePinnedSupplier(
  rows: SupplierSearchRow[],
  pinned: SupplierSearchRow | null | undefined
): SupplierSearchRow[] {
  if (!pinned || pinned.id == null || !pinned.name.trim()) return rows;
  if (rows.some((row) => String(row.id) === String(pinned.id))) return rows;
  return [pinned, ...rows];
}

export async function searchSupplierOrgs(
  supabase: Rpc,
  query: string,
  opts?: { offset?: number; limit?: number }
): Promise<SupplierSearch> {
  const raw = clampCustomerSearch(query);
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
  const limit = opts?.limit ?? LINKED_CUSTOMER_DROPDOWN_LIMIT;
  try {
    const res = await supabase.rpc('search_supplier_orgs', {
      p_query: raw,
      p_limit: limit,
      p_offset: offset,
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
  } catch (e) {
    console.warn('supplier search', e);
    return { ok: false };
  }
}

type OrgRead = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => Promise<{ data?: Record<string, unknown> | null; error?: { message?: string } | null }>;
      };
    };
  };
};

/** One supplier row by id. Row security on organizations still applies. */
export async function loadSupplierById(
  supabase: OrgRead,
  id: string | number
): Promise<{ ok: true; supplier: SupplierSearchRow | null } | { ok: false }> {
  try {
    const res = await supabase
      .from('organizations')
      .select('id, name, address, city, state, zip, phone, email, type')
      .eq('id', id)
      .maybeSingle();
    if (res?.error) {
      console.warn('supplier by id', res.error);
      return { ok: false };
    }
    const row = res?.data;
    if (!row) return { ok: true, supplier: null };
    const type = String(row.type || '').trim().toLowerCase();
    if (!SUPPLIER_ORG_TYPES.includes(type as (typeof SUPPLIER_ORG_TYPES)[number])) {
      return { ok: true, supplier: null };
    }
    return { ok: true, supplier: rowFrom(row) };
  } catch (e) {
    console.warn('supplier by id', e);
    return { ok: false };
  }
}
