/**
 * Add a marketplace listing onto a service invoice as a line item.
 * Line items live in service_invoices.invoice_data (JSON), so the listing
 * reference is an extra key on the line — no schema migration.
 *
 * Writes go through the same service_invoices insert/update the invoice form
 * uses (writeWithColumnRetry + allocateDocNumber). Send and Stripe pay are
 * unchanged; the shop reviews the draft on the existing edit page.
 */

import { isServiceOrgType } from '../org-types.ts';
import { listingPriceDollars, type MarketplaceListingLike } from '../marketplace/parts.ts';
import {
  collectableInvoiceDataFields,
  resolveInvoiceCollectable,
} from './invoice-collectable.ts';
import {
  lineItemsSubtotal,
  money,
  parseJsonField,
  recomputeExt,
  type LineItem,
} from './save-helpers.ts';

export type ListingInvoiceSource = {
  id?: string | number | null;
  title?: string | null;
  part_number?: string | null;
  price?: number | string | null;
  price_type?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  details?: Record<string, unknown> | null;
};

export type ListingInvoiceCustomer = {
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

/** Active organization is a service company. Role is not consulted. */
export function canAddListingToInvoice(orgType?: string | null): boolean {
  return isServiceOrgType(orgType);
}

export function invoiceEditPath(id: string | number): string {
  return `/invoices/new?id=${encodeURIComponent(String(id))}`;
}

export function isDraftInvoiceStatus(status: unknown): boolean {
  const s = String(status ?? 'draft').trim().toLowerCase();
  return s === '' || s === 'draft';
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function partNumberFromListing(listing: ListingInvoiceSource): string {
  const direct = String(listing.part_number || '').trim();
  if (direct) return direct;
  const details = listing.details;
  if (details && typeof details === 'object') {
    const sku = (details as { sku?: unknown }).sku;
    if (sku != null && String(sku).trim()) return String(sku).trim();
  }
  return '';
}

function listingTitle(listing: ListingInvoiceSource): string {
  const title = String(listing.title || '').trim();
  return title || 'Marketplace item';
}

export function lineItemFromStored(raw: unknown, index = 0): LineItem {
  const li = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const line = recomputeExt({
    id: li.id != null && String(li.id).trim() ? String(li.id) : `LI${index + 1}`,
    part_number: String(li.part_number || ''),
    description: String(li.description || ''),
    qty: Number(li.qty) || 0,
    unit_price: Number(li.unit_price) || 0,
    ext: Number(li.ext) || 0,
  });
  const listingId = li.marketplace_listing_id;
  if (listingId != null && String(listingId).trim()) {
    line.marketplace_listing_id = String(listingId).trim();
  }
  return line;
}

/** Blank starter row the invoice form inserts. Qty alone does not make it real. */
export function isPlaceholderInvoiceLine(li: Partial<LineItem>): boolean {
  if (li.marketplace_listing_id) return false;
  const part = String(li.part_number || '').trim();
  const description = String(li.description || '').trim();
  const price = Number(li.unit_price) || 0;
  const ext = Number(li.ext) || 0;
  return !part && !description && price === 0 && ext === 0;
}

export function parseInvoiceQty(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function listingToInvoiceLine(
  listing: ListingInvoiceSource,
  qty: number,
  lineId?: string
): LineItem {
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const unit = listingPriceDollars(listing as MarketplaceListingLike) ?? 0;
  const line: LineItem = {
    id: lineId || `MKT${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    part_number: partNumberFromListing(listing),
    description: listingTitle(listing),
    qty: quantity,
    unit_price: roundMoney(unit),
    ext: 0,
  };
  if (listing.id != null && String(listing.id).trim()) {
    line.marketplace_listing_id = String(listing.id).trim();
  }
  return recomputeExt(line);
}

export function appendListingLine(existing: unknown, line: LineItem): LineItem[] {
  const raw = Array.isArray(existing) ? existing : [];
  const kept = raw
    .map((row, i) => lineItemFromStored(row, i))
    .filter((row) => !isPlaceholderInvoiceLine(row));
  return [...kept, recomputeExt(line)];
}

export function invoiceTotalsFromLines(
  lines: LineItem[],
  tax: unknown
): { subtotal: number; tax: number; total: number } {
  const subtotal = lineItemsSubtotal(lines);
  const taxN = roundMoney(Number(tax) || 0);
  return { subtotal, tax: taxN, total: roundMoney(subtotal + taxN) };
}

/**
 * Patch for an existing draft. Only line items, subtotal, and total change.
 * Stripe keys, status, and amount paid stay on the row / inside invoice_data.
 */
function previousInvoiceTotal(
  row: { total?: unknown },
  stored: Record<string, unknown>,
  tax: unknown
): number {
  const column = Number(row.total);
  if (Number.isFinite(column) && column > 0) return roundMoney(column);
  const fromJson = Number(stored.total);
  if (Number.isFinite(fromJson) && fromJson > 0) return roundMoney(fromJson);
  const raw = Array.isArray(stored.line_items) ? stored.line_items : [];
  const lines = raw
    .map((item, i) => lineItemFromStored(item, i))
    .filter((item) => !isPlaceholderInvoiceLine(item));
  return invoiceTotalsFromLines(lines, tax).total;
}

/**
 * A saved invoice always stores dueNow. When that amount already covered the
 * whole total, the new line stays on the amount due now. A real deposit split
 * (due now below the old total) keeps its deposit; the new line increases the
 * remainder the shop can release later.
 */
function applyCollectableAfterAppend(
  stored: Record<string, unknown>,
  next: Record<string, unknown>,
  oldTotal: number,
  newTotal: number
) {
  const hasSplit =
    'dueNow' in stored || 'deferred' in stored || 'partsDeposit' in stored || 'deferredReleased' in stored;
  if (!hasSplit) return;
  const deferred = roundMoney(Number(stored.deferred) || 0);
  const dueNow = stored.dueNow == null ? oldTotal : roundMoney(Number(stored.dueNow) || 0);
  const fullCharge = deferred <= 0.004 && dueNow + 0.004 >= oldTotal;
  if (fullCharge) {
    next.dueNow = newTotal;
    next.deferred = 0;
    if ('partsDeposit' in stored) next.partsDeposit = 0;
    return;
  }
  if ('deferred' in stored) next.deferred = roundMoney(Math.max(0, newTotal - dueNow));
}

export function mergeListingOntoDraft(
  row: { invoice_data?: unknown; tax?: unknown; amount_paid?: unknown; total?: unknown },
  line: LineItem
): { invoice_data: Record<string, unknown>; subtotal: number; total: number } {
  const stored = parseJsonField(row.invoice_data);
  const oldTotal = previousInvoiceTotal(row, stored, row.tax);
  const lines = appendListingLine(stored.line_items, line);
  const totals = invoiceTotalsFromLines(lines, row.tax);
  const paidRaw = Number(row.amount_paid);
  const received =
    Number.isFinite(paidRaw) && paidRaw > 0
      ? roundMoney(paidRaw)
      : roundMoney(Number(stored.deposit) || 0);
  const next: Record<string, unknown> = {
    ...stored,
    line_items: lines,
    balanceDue: Math.max(0, roundMoney(totals.total - received)),
  };
  applyCollectableAfterAppend(stored, next, oldTotal, totals.total);
  if ('total' in stored) next.total = totals.total;
  if ('subtotal' in stored) next.subtotal = totals.subtotal;
  return {
    invoice_data: next,
    subtotal: totals.subtotal,
    total: totals.total,
  };
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function buildNewListingInvoicePayload(input: {
  orgId: string | number;
  userId: string;
  customer: ListingInvoiceCustomer;
  listing: ListingInvoiceSource;
  qty: number;
  invoiceNumber: string;
  now?: Date;
}): Record<string, unknown> {
  const line = listingToInvoiceLine(input.listing, input.qty);
  const totals = invoiceTotalsFromLines([line], 0);
  const now = input.now ?? new Date();
  const invoiceDate = ymd(now);
  const splitFields = collectableInvoiceDataFields(
    resolveInvoiceCollectable({
      total: totals.total,
      amountPaid: 0,
      invoice_data: {
        partsDeposit: 0,
        dueNow: totals.total,
        deferred: 0,
        deferredReleased: false,
      },
    })
  );
  return {
    customer_name: String(input.customer.name || '').trim(),
    organization_id: input.orgId,
    customer_organization_id: input.customer.id,
    estimate_id: null,
    invoice_date: invoiceDate,
    due_date: null,
    description: null,
    subtotal: totals.subtotal,
    tax: 0,
    total: totals.total,
    status: 'draft',
    amount_paid: 0,
    paid_at: null,
    payment_method: null,
    invoice_number: input.invoiceNumber,
    created_by: input.userId,
    created_at: now.toISOString(),
    invoice_data: {
      line_items: [line],
      ...splitFields,
      deposit: 0,
      depositDate: null,
      depositMethod: null,
      manufacturer: input.listing.manufacturer || '',
      model: input.listing.model || '',
      serial: input.listing.serial_number || '',
      invoice_number: input.invoiceNumber,
      invNumber: input.invoiceNumber,
      custAddress: input.customer.address || '',
      custCity: input.customer.city || '',
      custState: input.customer.state || '',
      custZip: input.customer.zip || '',
      custPhone: input.customer.phone || '',
      custEmail: input.customer.email || '',
      custContact: input.customer.contact || '',
    },
  };
}

export function draftInvoiceOptionLabel(row: {
  invoice_number?: string | null;
  customer_name?: string | null;
  total?: number | null;
  invoice_data?: unknown;
}): string {
  const data = parseJsonField(row.invoice_data);
  const num = String(row.invoice_number || data.invoice_number || data.invNumber || '').trim();
  const who = String(row.customer_name || 'No customer').trim() || 'No customer';
  return [num || 'Draft', who, money(Number(row.total) || 0)].join(' · ');
}
