'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { allocateDocNumber } from '@/lib/billing/doc-numbers';
import {
  buildNewListingInvoicePayload,
  draftInvoiceOptionLabel,
  invoiceEditPath,
  isDraftInvoiceStatus,
  listingToInvoiceLine,
  mergeListingOntoDraft,
  parseInvoiceQty,
  type ListingInvoiceSource,
} from '@/lib/billing/listing-invoice';
import { money, writeWithColumnRetry } from '@/lib/billing/save-helpers';
import {
  filterLinkedCustomers,
  loadLinkedCustomerOrgs,
  matchLinkedCustomer,
  type LinkedCustomerOpt,
} from '@/lib/customer-form';
import { formatListingPrice } from '@/lib/marketplace/parts';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useServiceCompanyOrg } from '@/lib/use-service-company-org';

type DraftRow = {
  id: string | number;
  customer_name?: string | null;
  status?: string | null;
  total?: number | null;
  invoice_number?: string | null;
  invoice_data?: unknown;
};

type Props = {
  listing: ListingInvoiceSource;
  className?: string;
  label?: string;
};

export function AddListingToInvoiceButton({
  listing,
  className = 'btn btn-secondary w-full',
  label = 'Add to invoice',
}: Props) {
  const org = useServiceCompanyOrg();
  const [open, setOpen] = useState(false);
  if (!org.ready || org.orgId == null || !org.userId) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <AddListingToInvoiceDialog
          listing={listing}
          orgId={org.orgId}
          userId={org.userId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddListingToInvoiceDialog({
  listing,
  orgId,
  userId,
  onClose,
}: {
  listing: ListingInvoiceSource;
  orgId: string | number;
  userId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [customers, setCustomers] = useState<LinkedCustomerOpt[]>([]);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const modeTouched = useRef(false);
  const [draftId, setDraftId] = useState('');
  const [custSearch, setCustSearch] = useState('');
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [customer, setCustomer] = useState<LinkedCustomerOpt | null>(null);
  const [qtyText, setQtyText] = useState('1');

  const preview = useMemo(() => listingToInvoiceLine(listing, parseInvoiceQty(qtyText) || 1, 'preview'), [listing, qtyText]);
  const priceLabel = formatListingPrice({
    price: listing.price,
    price_type: listing.price_type,
  });
  const filteredCustomers = useMemo(
    () => filterLinkedCustomers(customers, custSearch, 12),
    [customers, custSearch]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [draftRes, linked] = await Promise.all([
          supabase
            .from('service_invoices')
            .select('id, customer_name, status, total, invoice_number, invoice_data, created_at')
            .eq('organization_id', orgId)
            .eq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(100),
          loadLinkedCustomerOrgs(supabase, orgId),
        ]);
        if (!alive) return;
        const rows = ((draftRes.data || []) as DraftRow[]).filter((row) =>
          isDraftInvoiceStatus(row.status)
        );
        setDrafts(rows);
        setCustomers(linked);
        if (rows[0]) setDraftId(String(rows[0].id));
        if (!modeTouched.current) setMode(rows.length ? 'existing' : 'new');
      } catch (e) {
        console.warn('add listing to invoice load', e);
        if (alive) toast.error('Could not load invoices');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId, supabase]);

  async function submit() {
    if (saving) return;
    const qty = parseInvoiceQty(qtyText);
    if (qty == null) {
      toast.error('Enter a quantity of at least 1');
      return;
    }
    setSaving(true);
    try {
      let id: string | number | null = null;
      if (mode === 'existing') {
        if (!draftId) {
          toast.error('Choose a draft invoice');
          setSaving(false);
          return;
        }
        const { data, error } = await supabase
          .from('service_invoices')
          .select('id, status, tax, total, amount_paid, invoice_data')
          .eq('id', draftId)
          .maybeSingle();
        if (error || !data) throw new Error(error?.message || 'Could not load that invoice');
        if (!isDraftInvoiceStatus(data.status)) {
          toast.error('That invoice is no longer a draft. Pick another one or create a new invoice.');
          setSaving(false);
          return;
        }
        const patch = mergeListingOntoDraft(data, listingToInvoiceLine(listing, qty));
        const result = await writeWithColumnRetry(supabase, 'service_invoices', patch, data.id);
        if (result.error) throw result.error;
        id = result.id || data.id;
      } else {
        const chosen = customer || matchLinkedCustomer(customers, custSearch);
        if (!chosen || !chosen.name.trim()) {
          toast.error('Choose a customer');
          setSaving(false);
          return;
        }
        const invoiceNumber = await allocateDocNumber(supabase, {
          orgId,
          kind: 'INV',
          date: new Date(),
        });
        if (!invoiceNumber) throw new Error('Could not allocate an invoice number. Try again.');
        const payload = buildNewListingInvoicePayload({
          orgId,
          userId,
          customer: chosen,
          listing,
          qty,
          invoiceNumber,
        });
        const result = await writeWithColumnRetry(supabase, 'service_invoices', payload, null);
        if (result.error) throw result.error;
        id = result.id;
      }
      if (id == null) throw new Error('Invoice was not saved');
      toast.success('Added to invoice');
      router.push(invoiceEditPath(id));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || 'Could not add this item to an invoice');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border2)] rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-listing-invoice-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id="add-listing-invoice-title" className="font-extrabold text-lg text-[var(--gold)]">
              Add to invoice
            </h2>
            <p className="text-xs text-[var(--text3)] mt-1">
              Adds this listing as a line on a draft invoice. You can adjust it, then send and collect payment the usual way.
            </p>
          </div>
          <button
            type="button"
            className="text-[var(--text3)] hover:text-[var(--text)] text-xl leading-none px-1"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface3)] p-3 mb-4 text-sm">
          <div className="font-semibold break-words">{preview.description}</div>
          {preview.part_number ? (
            <div className="text-[var(--text3)] mt-1">PN: {preview.part_number}</div>
          ) : null}
          <div className="mt-1 text-[var(--gold)] font-semibold">
            {priceLabel === 'Contact for price' ? 'No list price — unit price starts at $0.00' : `${priceLabel} each`}
          </div>
        </div>

        <div className="mb-4">
          <label className="label" htmlFor="listing-invoice-qty">
            Quantity
          </label>
          <input
            id="listing-invoice-qty"
            className="input"
            type="number"
            inputMode="decimal"
            min={1}
            step="1"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
          />
          <p className="text-xs text-[var(--text3)] mt-1">
            Line total {money(preview.ext)}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            className={mode === 'existing' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => {
              modeTouched.current = true;
              setMode('existing');
            }}
          >
            Existing draft
          </button>
          <button
            type="button"
            className={mode === 'new' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => {
              modeTouched.current = true;
              setMode('new');
            }}
          >
            New invoice
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--text3)] mb-4">Loading invoices…</p>
        ) : mode === 'existing' ? (
          <div className="mb-4">
            <label className="label" htmlFor="listing-invoice-draft">
              Draft invoice
            </label>
            {drafts.length === 0 ? (
              <p className="text-sm text-[var(--text3)]">
                No draft invoices for your organization.{' '}
                <button
                  type="button"
                  className="text-[var(--gold)] hover:underline"
                  onClick={() => {
                    modeTouched.current = true;
                    setMode('new');
                  }}
                >
                  Create a new invoice
                </button>
              </p>
            ) : (
              <select
                id="listing-invoice-draft"
                className="input"
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
              >
                {drafts.map((row) => (
                  <option key={String(row.id)} value={String(row.id)}>
                    {draftInvoiceOptionLabel(row)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <div className="mb-4 relative">
            <label className="label" htmlFor="listing-invoice-customer">
              Customer
            </label>
            <input
              id="listing-invoice-customer"
              className="input"
              value={custSearch}
              onChange={(e) => {
                setCustSearch(e.target.value);
                setCustomer(null);
                setShowCustDrop(true);
              }}
              onFocus={() => setShowCustDrop(true)}
              placeholder="Type customer name…"
              autoComplete="off"
            />
            {showCustDrop && filteredCustomers.length > 0 && (
              <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--border2)] bg-[var(--surface3)]">
                {filteredCustomers.map((c) => (
                  <button
                    key={String(c.id)}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-[var(--surface)] text-sm"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setCustomer(c);
                      setCustSearch(c.name);
                      setShowCustDrop(false);
                    }}
                  >
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-[var(--text3)]">
                      {[c.city, c.state].filter(Boolean).join(', ') || 'Linked customer'}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!loading && customers.length === 0 && (
              <p className="text-xs text-[var(--text3)] mt-2">
                No customers linked yet.{' '}
                <Link href="/customers" className="text-[var(--gold)] hover:underline">
                  Add one in the customer directory
                </Link>
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={saving || loading}>
            {saving ? 'Adding…' : 'Add and open invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
