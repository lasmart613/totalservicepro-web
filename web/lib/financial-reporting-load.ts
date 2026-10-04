/**
 * Read-only shop financial rows for the active organization.
 * Uses the caller's Supabase client (their JWT and existing RLS). No writes.
 */

import { fetchAllPages } from './supabase/paginate.ts';
import {
  invoiceColumnFlags,
  type EstimateSourceRow,
  type InvoiceColumnFlags,
  type InvoiceSourceRow,
  type PurchaseOrderSourceRow,
} from './financial-reporting.ts';

export type FinancePage = {
  data?: unknown;
  error?: { message?: string } | null;
};

export type FinanceQuery = {
  select: (columns: string) => FinanceQuery;
  eq: (column: string, value: unknown) => FinanceQuery;
  order: (column: string, options?: { ascending?: boolean }) => FinanceQuery;
  range: (from: number, to: number) => PromiseLike<FinancePage>;
};

export type FinanceClient = {
  from: (table: string) => FinanceQuery;
};

export type ShopFinancialSources = {
  invoices: InvoiceSourceRow[] | null;
  invoiceIssue: string | null;
  invoiceColumns: InvoiceColumnFlags;
  purchaseOrders: PurchaseOrderSourceRow[] | null;
  purchaseOrderIssue: string | null;
  estimates: EstimateSourceRow[] | null;
  estimateIssue: string | null;
};

const INVOICE_SELECTS = [
  'id, invoice_number, status, customer_name, total, subtotal, tax, amount_paid, paid_at, payment_method, invoice_date, due_date, created_at, organization_id, invoice_data',
  'id, invoice_number, status, customer_name, total, subtotal, tax, invoice_date, due_date, created_at, organization_id, invoice_data',
  'id, status, customer_name, total, created_at, organization_id, invoice_data',
  'id, status, customer_name, total, created_at, organization_id',
] as const;

const PURCHASE_ORDER_SELECTS = [
  'id, po_number, status, supplier_name, total, po_date, created_at, organization_id',
  'id, status, total, created_at, organization_id',
] as const;

const ESTIMATE_SELECTS = [
  'id, estimate_number, status, customer_name, total, created_at, organization_id',
  'id, status, customer_name, total, created_at, organization_id',
] as const;

function isMissingTable(message?: string | null): boolean {
  return /relation .* does not exist|could not find the table|Could not find the table|schema cache/i.test(
    String(message || '')
  );
}

function isColumnError(message?: string | null): boolean {
  return /column|schema cache|does not exist/i.test(String(message || ''));
}

async function selectOrgRows(
  client: FinanceClient,
  table: string,
  organizationId: string | number,
  selects: readonly string[]
): Promise<{ rows: unknown[] | null; columns: string; issue: string | null }> {
  let lastError = '';
  for (const columns of selects) {
    const { data, error } = await fetchAllPages<unknown>(async (from, to) => {
      const res = await client
        .from(table)
        .select(columns)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .range(from, to);
      return {
        data: (res.data as unknown[] | null) ?? null,
        error: res.error || null,
      };
    });
    if (!error) return { rows: data, columns, issue: null };
    lastError = error.message || `${table} query failed`;
    if (isMissingTable(lastError) && !/column/i.test(lastError)) {
      return { rows: null, columns: '', issue: lastError };
    }
    if (!isColumnError(lastError)) return { rows: null, columns: '', issue: lastError };
  }
  return { rows: null, columns: '', issue: lastError || `${table} query failed` };
}

export async function loadShopFinancialSources(
  client: FinanceClient,
  organizationId: string | number
): Promise<ShopFinancialSources> {
  const [invoices, purchaseOrders, estimates] = await Promise.all([
    selectOrgRows(client, 'service_invoices', organizationId, INVOICE_SELECTS),
    selectOrgRows(client, 'purchase_orders', organizationId, PURCHASE_ORDER_SELECTS),
    selectOrgRows(client, 'service_estimates', organizationId, ESTIMATE_SELECTS),
  ]);

  return {
    invoices: (invoices.rows as InvoiceSourceRow[] | null) ?? null,
    invoiceIssue: invoices.issue,
    invoiceColumns: invoiceColumnFlags(invoices.columns),
    purchaseOrders: (purchaseOrders.rows as PurchaseOrderSourceRow[] | null) ?? null,
    purchaseOrderIssue: purchaseOrders.issue,
    estimates: (estimates.rows as EstimateSourceRow[] | null) ?? null,
    estimateIssue: estimates.issue,
  };
}
