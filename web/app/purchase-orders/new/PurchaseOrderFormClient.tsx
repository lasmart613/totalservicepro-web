'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { allocateDocNumber } from '@/lib/billing/doc-numbers';
import { buildPurchaseOrderHtml, type DocCompany } from '@/lib/billing/doc-html';
import { isValidOnFileEmail, sendBillingDocEmail } from '@/lib/billing/send-doc-email';
import { fetchAllPages } from '@/lib/supabase/paginate';
import {
  coerceOrgId,
  emptyLineItem,
  isValidOrgId,
  lineItemsSubtotal,
  money,
  parseJsonField,
  recomputeExt,
  writeWithColumnRetry,
  type LineItem,
} from '@/lib/billing/save-helpers';

type SupplierOpt = {
  id: string | number;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  zip?: string | null;
};

function todayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export default function PurchaseOrderFormClient() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editIdParam = searchParams.get('id');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [savedId, setSavedId] = useState<string | number | null>(editIdParam);
  const [userOrgId, setUserOrgId] = useState<string | number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [docNumber, setDocNumber] = useState('');
  const [status, setStatus] = useState('draft');
  const [company, setCompany] = useState<DocCompany>({});

  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [supSearch, setSupSearch] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierOrgId, setSupplierOrgId] = useState<string | number | null>(null);
  const [supAddress, setSupAddress] = useState('');
  const [supCity, setSupCity] = useState('');
  const [supState, setSupState] = useState('');
  const [supZip, setSupZip] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');

  const [poDate, setPoDate] = useState(todayYmd());
  const [neededBy, setNeededBy] = useState('');
  const [shipTo, setShipTo] = useState('');
  const [description, setDescription] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem('LI')]);
  const [tax, setTax] = useState(0);
  const [totalOverride, setTotalOverride] = useState<number | null>(null);

  const subtotal = useMemo(() => lineItemsSubtotal(lineItems), [lineItems]);
  const computedTotal = useMemo(
    () => Math.round((subtotal + (Number(tax) || 0)) * 100) / 100,
    [subtotal, tax]
  );
  const total = totalOverride != null ? totalOverride : computedTotal;

  const filteredSuppliers = useMemo(() => {
    const q = supSearch.trim().toLowerCase();
    const list = !q
      ? suppliers
      : suppliers.filter((s) =>
          [s.name, s.city, s.state, s.email, s.phone]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q)
        );
    if (
      supplierOrgId != null &&
      !list.some((s) => String(s.id) === String(supplierOrgId))
    ) {
      const selected = suppliers.find((s) => String(s.id) === String(supplierOrgId));
      if (selected) return [selected, ...list];
    }
    return list;
  }, [suppliers, supSearch, supplierOrgId]);

  const loadSuppliers = useCallback(async () => {
    const { data, error } = await fetchAllPages<SupplierOpt>(async (from, to) => {
      const res = await supabase
        .from('organizations')
        .select('id, name, address, city, state, phone, email')
        .in('type', ['parts_supplier', 'vendor'])
        .order('name', { ascending: true })
        .range(from, to);
      return { data: (res.data || []) as SupplierOpt[], error: res.error };
    });
    if (error) console.warn('load suppliers', error);
    setSuppliers(data || []);
  }, [supabase]);

  const applySupplier = (s: SupplierOpt) => {
    setSupplierName(s.name);
    setSupplierOrgId(s.id);
    setSupSearch(s.name);
    setSupAddress(s.address || '');
    setSupCity(s.city || '');
    setSupState(s.state || '');
    setSupZip(s.zip || '');
    setSupPhone(s.phone || '');
    setSupEmail(s.email || '');
  };

  const clearSupplier = () => {
    setSupplierName('');
    setSupplierOrgId(null);
    setSupSearch('');
    setSupAddress('');
    setSupCity('');
    setSupState('');
    setSupZip('');
    setSupPhone('');
    setSupEmail('');
  };

  const loadPo = useCallback(
    async (id: string, orgId: string | number) => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error || !data) {
        toast.error('Could not load purchase order');
        return;
      }
      setSavedId(data.id);
      setStatus(data.status || 'draft');
      setSupplierName(data.supplier_name || '');
      setSupSearch(data.supplier_name || '');
      setSupplierOrgId(data.supplier_organization_id || null);
      setSupEmail(data.supplier_email || '');
      setPoDate(data.po_date ? String(data.po_date).slice(0, 10) : todayYmd());
      setNeededBy(data.needed_by ? String(data.needed_by).slice(0, 10) : '');
      setDescription(data.description || '');
      setTax(Number(data.tax) || 0);
      if (data.total != null) setTotalOverride(Number(data.total));
      const pdata = parseJsonField(data.po_data);
      setDocNumber(data.po_number || pdata.po_number || pdata.poNumber || '');
      setShipTo(pdata.shipTo || '');
      if (pdata.supAddress) setSupAddress(pdata.supAddress);
      if (pdata.supCity) setSupCity(pdata.supCity);
      if (pdata.supState) setSupState(pdata.supState);
      if (pdata.supZip) setSupZip(pdata.supZip);
      if (pdata.supPhone) setSupPhone(pdata.supPhone);
      const lines = Array.isArray(pdata.line_items) ? pdata.line_items : [];
      if (lines.length) {
        setLineItems(
          lines.map((li: any, i: number) =>
            recomputeExt({
              id: li.id || `LI${i + 1}`,
              part_number: li.part_number || '',
              description: li.description || '',
              qty: Number(li.qty) || 1,
              unit_price: Number(li.unit_price) || 0,
              ext: Number(li.ext) || 0,
            })
          )
        );
      }
    },
    [supabase]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.push('/login');
          return;
        }
        setUserId(user.id);
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id, first_name, last_name')
          .eq('id', user.id)
          .maybeSingle();
        const orgId = coerceOrgId(profile?.organization_id);
        setUserOrgId(orgId);
        const techName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
        if (orgId) {
          const { data: org } = await supabase
            .from('organizations')
            .select('name, address, city, state, zip, phone, email, website, logo_url, slogan')
            .eq('id', orgId)
            .maybeSingle();
          setCompany({
            company_name: org?.name || '',
            address: org?.address || '',
            city: org?.city || '',
            state: org?.state || '',
            zip: org?.zip || '',
            phone: org?.phone || '',
            email: org?.email || '',
            website: org?.website || '',
            logo_url: org?.logo_url || '',
            slogan: org?.slogan || '',
            tech_name: techName,
          });
          const ship = [org?.name, org?.address, org?.city, org?.state, org?.zip]
            .filter(Boolean)
            .join(', ');
          setShipTo((prev) => prev || ship);
        }
        await loadSuppliers();
        if (editIdParam && orgId) await loadPo(editIdParam, orgId);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase, router, editIdParam, loadSuppliers, loadPo]);

  function updateLine(id: string, patch: Partial<LineItem>) {
    setTotalOverride(null);
    setLineItems((rows) =>
      rows.map((r) => (r.id === id ? recomputeExt({ ...r, ...patch }) : r))
    );
  }

  async function savePo(
    nextStatus: string,
    opts?: { quiet?: boolean }
  ): Promise<string | number | null> {
    const name = supplierName.trim() || supSearch.trim();
    if (!name) {
      toast.error('Choose a parts supplier');
      return null;
    }
    if (!isValidOrgId(userOrgId)) {
      toast.error('Your account is not linked to a company');
      return null;
    }
    setSaving(true);
    try {
      let num = editIdParam ? docNumber : '';
      if (!num && userOrgId) {
        num = await allocateDocNumber(supabase, {
          orgId: userOrgId,
          kind: 'PO',
          date: poDate || new Date(),
        });
        setDocNumber(num);
      }
      if (!num) throw new Error('Could not allocate a PO number. Try again.');

      const items = lineItems.filter(
        (li) => li.part_number || li.description || li.qty || li.unit_price
      );
      const payload: Record<string, any> = {
        supplier_name: name,
        organization_id: userOrgId,
        supplier_organization_id: supplierOrgId || null,
        supplier_email: supEmail.trim() || null,
        po_date: poDate || todayYmd(),
        needed_by: neededBy || null,
        description: description || null,
        subtotal: Math.round(subtotal * 100) / 100,
        tax: Math.round((Number(tax) || 0) * 100) / 100,
        total: Math.round(total * 100) / 100,
        status: nextStatus,
        po_number: num,
        po_data: {
          line_items: items,
          po_number: num,
          poNumber: num,
          shipTo,
          supAddress,
          supCity,
          supState,
          supZip,
          supPhone,
        },
      };
      if (!savedId) {
        payload.created_by = userId;
        payload.created_at = new Date().toISOString();
      }

      const result = await writeWithColumnRetry(supabase, 'purchase_orders', payload, savedId);
      if (result.error) throw result.error;
      if (result.id) {
        setSavedId(result.id);
        setStatus(nextStatus);
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('id', String(result.id));
          window.history.replaceState({}, '', url.toString());
        } catch {
          /* ignore */
        }
      }
      if (!opts?.quiet) {
        toast.success(nextStatus === 'draft' ? 'PO draft saved' : 'Purchase order saved');
      }
      return result.id || savedId;
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message || String(err)}`);
      return null;
    } finally {
      setSaving(false);
    }
  }

  function buildPoEmailHtml() {
    return buildPurchaseOrderHtml({
      company,
      supplier: {
        name: supplierName.trim() || supSearch.trim(),
        address: supAddress,
        city: supCity,
        state: supState,
        zip: supZip,
        phone: supPhone,
        email: supEmail,
      },
      poNumber: docNumber || 'Draft',
      poDate: poDate || todayYmd(),
      neededBy: neededBy || undefined,
      shipTo: shipTo || undefined,
      description: description || undefined,
      preparedBy: company.tech_name,
      lines: lineItems,
      subtotal,
      tax: Number(tax) || 0,
      total,
    });
  }

  async function finalizeAndEmail() {
    if (!supplierOrgId) {
      toast.error('Pick a parts supplier from the list so we can use their profile email.');
      return;
    }
    if (!isValidOnFileEmail(supEmail)) {
      toast.error('This supplier has no email on their organization profile.');
      return;
    }
    setEmailing(true);
    try {
      const id = await savePo('draft', { quiet: true });
      if (!id) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired — sign in again');
        return;
      }
      const result = await sendBillingDocEmail({
        kind: 'purchase_order',
        accessToken: session.access_token,
        payload: {
          purchase_order_id: id,
          po_number: docNumber,
          supplier_organization_id: supplierOrgId,
          supplier_name: supplierName,
          company_name: company.company_name,
          reply_to: company.email || undefined,
          html: buildPoEmailHtml(),
        },
      });
      if (!result.emailSent) {
        toast.error(result.error || 'Email was not sent. PO remains a draft.');
        return;
      }
      await savePo('sent', { quiet: true });
      toast.success(`Purchase order emailed to ${result.to}`);
    } finally {
      setEmailing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header authPending />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
          Loading purchase order…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="page max-w-3xl mx-auto w-full px-4 py-6 pb-28">
        <div className="mb-4">
          <h1 className="text-2xl font-extrabold">Purchase Order</h1>
          <p className="text-sm text-[var(--text3)]">
            {docNumber ? <span className="text-[var(--gold)] font-bold">{docNumber}</span> : 'Draft'}{' '}
            · emails the address on the supplier profile
          </p>
        </div>

        <section className="card p-4 mb-4">
          <h2 className="font-bold text-[var(--gold)] mb-3">Parts supplier</h2>
          <div>
            <label className="text-xs text-[var(--text3)]">Choose a parts supplier</label>
            <select
              className="input select mt-1"
              value={supplierOrgId != null ? String(supplierOrgId) : ''}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) {
                  clearSupplier();
                  return;
                }
                const s = suppliers.find((x) => String(x.id) === id);
                if (s) applySupplier(s);
              }}
            >
              <option value="">
                {suppliers.length
                  ? `Choose a parts supplier (${filteredSuppliers.length} shown)…`
                  : 'No parts suppliers found'}
              </option>
              {filteredSuppliers.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                  {s.city || s.state ? ` — ${[s.city, s.state].filter(Boolean).join(', ')}` : ''}
                  {s.email ? ` · ${s.email}` : ' · no email'}
                </option>
              ))}
            </select>
            <label className="text-xs text-[var(--text3)] mt-3 block">Type to filter the list</label>
            <input
              className="input mt-1"
              value={supSearch}
              onChange={(e) => {
                const v = e.target.value;
                setSupSearch(v);
                const exact = suppliers.find(
                  (s) => s.name.toLowerCase() === v.trim().toLowerCase()
                );
                if (exact) {
                  applySupplier(exact);
                  return;
                }
                if (!v.trim()) clearSupplier();
              }}
              list="po-supplier-autofill"
              placeholder="Start typing a supplier name…"
              autoComplete="off"
            />
            <datalist id="po-supplier-autofill">
              {suppliers.map((s) => (
                <option key={String(s.id)} value={s.name}>
                  {s.email || [s.city, s.state].filter(Boolean).join(', ')}
                </option>
              ))}
            </datalist>
            <p className="text-[11px] text-[var(--text3)] mt-1">
              Pick from the dropdown or type a name — email fills from their profile.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="text-xs text-[var(--text3)]">Email on supplier profile</label>
              <input className="input mt-1 opacity-90" readOnly value={supEmail || '—'} />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Phone</label>
              <input className="input mt-1 opacity-90" readOnly value={supPhone || '—'} />
            </div>
          </div>
        </section>

        <section className="card p-4 mb-4">
          <h2 className="font-bold text-[var(--gold)] mb-3">PO details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text3)]">PO date</label>
              <input
                className="input mt-1"
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Needed by</label>
              <input
                className="input mt-1"
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-[var(--text3)]">Ship to</label>
            <input
              className="input mt-1"
              value={shipTo}
              onChange={(e) => setShipTo(e.target.value)}
            />
          </div>
          <div className="mt-3">
            <label className="text-xs text-[var(--text3)]">Notes</label>
            <textarea
              className="input mt-1 min-h-[72px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </section>

        <section className="card p-4 mb-4 overflow-x-auto">
          <h2 className="font-bold text-[var(--gold)] mb-3">Line items</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-[var(--text3)]">
                <th className="pb-2">Part #</th>
                <th className="pb-2">Description</th>
                <th className="pb-2 w-16">Qty</th>
                <th className="pb-2 w-24">Price</th>
                <th className="pb-2 w-24">Ext</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id}>
                  <td className="pr-1 pb-2">
                    <input
                      className="input"
                      value={li.part_number}
                      onChange={(e) => updateLine(li.id, { part_number: e.target.value })}
                    />
                  </td>
                  <td className="pr-1 pb-2">
                    <input
                      className="input"
                      value={li.description}
                      onChange={(e) => updateLine(li.id, { description: e.target.value })}
                    />
                  </td>
                  <td className="pr-1 pb-2">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="1"
                      value={li.qty}
                      onChange={(e) => updateLine(li.id, { qty: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="pr-1 pb-2">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={li.unit_price}
                      onChange={(e) =>
                        updateLine(li.id, { unit_price: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="pr-1 pb-2">
                    <input className="input opacity-90" readOnly value={li.ext.toFixed(2)} />
                  </td>
                  <td className="pb-2">
                    <button
                      type="button"
                      className="text-red-400 text-lg px-1"
                      onClick={() =>
                        setLineItems((rows) =>
                          rows.length <= 1 ? [emptyLineItem('LI')] : rows.filter((r) => r.id !== li.id)
                        )
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn btn-secondary text-sm mt-2"
            onClick={() => setLineItems((r) => [...r, emptyLineItem('LI')])}
          >
            + Add line item
          </button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div>
              <label className="text-xs text-[var(--text3)]">Subtotal</label>
              <input className="input mt-1 opacity-90" readOnly value={subtotal.toFixed(2)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Tax</label>
              <input
                className="input mt-1"
                type="number"
                step="0.01"
                min={0}
                value={tax}
                onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
          <div className="text-right mt-3 text-[var(--gold)] font-extrabold text-xl">
            {money(total)}
          </div>
        </section>

        <div className="flex flex-wrap gap-2 sticky bottom-4 z-10">
          <Link href="/purchase-orders" className="btn btn-secondary min-w-[80px] text-center">
            Cancel
          </Link>
          <button
            type="button"
            className="btn btn-secondary min-w-[100px]"
            disabled={saving || emailing}
            onClick={() => savePo('draft')}
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            type="button"
            className="btn btn-primary min-w-[140px]"
            disabled={saving || emailing}
            onClick={() => finalizeAndEmail()}
          >
            {emailing ? 'Emailing…' : 'Finalize & Email'}
          </button>
        </div>
      </div>
    </div>
  );
}
