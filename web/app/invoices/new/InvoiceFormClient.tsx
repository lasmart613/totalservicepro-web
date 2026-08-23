'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { loadLinkedCustomers } from '@/lib/org-customers';
import { allocateDocNumber } from '@/lib/billing/doc-numbers';
import { buildInvoiceHtml, type DocCompany } from '@/lib/billing/doc-html';
import { sendBillingDocEmail } from '@/lib/billing/send-doc-email';
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
import { listManufacturers, listModelsForManufacturer } from '@/lib/laser-catalog';

type CustomerOpt = {
  id: string | number;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  zip?: string | null;
  contact?: string | null;
};

function todayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export default function InvoiceFormClient() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editIdParam = searchParams.get('id');
  const fromEstimateParam = searchParams.get('fromEstimate');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | number | null>(editIdParam);
  const [sourceEstimateId, setSourceEstimateId] = useState<string | number | null>(
    fromEstimateParam
  );
  const [userOrgId, setUserOrgId] = useState<string | number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [docNumber, setDocNumber] = useState('');
  const [status, setStatus] = useState('draft');
  const [company, setCompany] = useState<DocCompany>({});
  const [emailing, setEmailing] = useState(false);

  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [custSearch, setCustSearch] = useState('');
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerOrgId, setCustomerOrgId] = useState<string | number | null>(null);
  const [custAddress, setCustAddress] = useState('');
  const [custCity, setCustCity] = useState('');
  const [custState, setCustState] = useState('');
  const [custZip, setCustZip] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custContact, setCustContact] = useState('');

  const manufacturers = useMemo(() => listManufacturers(), []);
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [pulseCount, setPulseCount] = useState('');
  const models = useMemo(
    () => (manufacturer ? listModelsForManufacturer(manufacturer) : []),
    [manufacturer]
  );

  const [invoiceDate, setInvoiceDate] = useState(todayYmd());
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem('LI')]);
  const [tax, setTax] = useState(0);
  const [totalOverride, setTotalOverride] = useState<number | null>(null);
  const [deposit, setDeposit] = useState(0);
  const [depositDate, setDepositDate] = useState('');
  const [depositMethod, setDepositMethod] = useState('');
  const [partsCatalog, setPartsCatalog] = useState<any[]>([]);

  const subtotal = useMemo(() => lineItemsSubtotal(lineItems), [lineItems]);
  const computedTotal = useMemo(
    () => Math.round((subtotal + (Number(tax) || 0)) * 100) / 100,
    [subtotal, tax]
  );
  const total = totalOverride != null ? totalOverride : computedTotal;
  const balanceDue = Math.max(0, Math.round((total - (Number(deposit) || 0)) * 100) / 100);

  const filteredCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 12);
    return customers
      .filter((c) =>
        [c.name, c.city, c.state, c.phone, c.email]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 12);
  }, [customers, custSearch]);

  const loadCustomers = useCallback(
    async (orgId: string | number) => {
      try {
        const { data: custs } = await loadLinkedCustomers(supabase, orgId, {
          select: 'id, name, address, city, state, phone, email, zip, contact_name',
        });
        setCustomers(
          (custs || []).map((c: any) => ({
            id: c.id,
            name: c.name || '',
            address: c.address,
            city: c.city,
            state: c.state,
            phone: c.phone,
            email: c.email,
            zip: c.zip,
            contact: c.contact_name,
          }))
        );
      } catch {
        setCustomers([]);
      }
    },
    [supabase]
  );

  const loadParts = useCallback(async () => {
    try {
      const res = await supabase
        .from('parts_catalog')
        .select('id, part_number, name, description, brand')
        .eq('is_active', true)
        .order('part_number')
        .limit(500);
      if (!res.error && res.data) {
        setPartsCatalog(res.data);
        return;
      }
      const res2 = await supabase
        .from('parts_catalog')
        .select('id, part_number, name, description')
        .limit(500);
      setPartsCatalog(res2.data || []);
    } catch {
      setPartsCatalog([]);
    }
  }, [supabase]);

  const applyCustomer = (c: CustomerOpt) => {
    setCustomerName(c.name);
    setCustomerOrgId(c.id);
    setCustSearch(c.name);
    setCustAddress(c.address || '');
    setCustCity(c.city || '');
    setCustState(c.state || '');
    setCustZip(c.zip || '');
    setCustPhone(c.phone || '');
    setCustEmail(c.email || '');
    setCustContact(c.contact || '');
    setShowCustDrop(false);
  };

  const loadInvoice = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from('service_invoices')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) {
        toast.error('Could not load invoice');
        return;
      }
      setSavedId(data.id);
      setStatus(data.status || 'draft');
      setCustomerName(data.customer_name || '');
      setCustSearch(data.customer_name || '');
      setCustomerOrgId(data.customer_organization_id || null);
      setSourceEstimateId(data.estimate_id || null);
      setInvoiceDate(
        data.invoice_date
          ? String(data.invoice_date).slice(0, 10)
          : todayYmd()
      );
      setDueDate(data.due_date ? String(data.due_date).slice(0, 10) : '');
      setDescription(data.description || '');
      setTax(Number(data.tax) || 0);
      if (data.total != null) setTotalOverride(Number(data.total));
      const idata = parseJsonField(data.invoice_data);
      setDocNumber(
        data.invoice_number || idata.invoice_number || idata.invNumber || ''
      );
      setManufacturer(idata.manufacturer || '');
      setModel(idata.model || '');
      setSerial(idata.serial || '');
      setPulseCount(idata.pulse_count != null ? String(idata.pulse_count) : '');
      setDeposit(Number(idata.deposit ?? idata.travelDeposit) || 0);
      setDepositDate(idata.depositDate || '');
      setDepositMethod(idata.depositMethod || '');
      if (idata.custAddress) setCustAddress(idata.custAddress);
      if (idata.custCity) setCustCity(idata.custCity);
      if (idata.custState) setCustState(idata.custState);
      if (idata.custZip) setCustZip(idata.custZip);
      if (idata.custPhone) setCustPhone(idata.custPhone);
      if (idata.custEmail) setCustEmail(idata.custEmail);
      if (idata.custContact) setCustContact(idata.custContact);
      const lines = idata.line_items || [];
      if (Array.isArray(lines) && lines.length) {
        setLineItems(
          lines.map((li: any, i: number) =>
            recomputeExt({
              id: li.id || `LI${i + 1}`,
              part_number: li.part_number || '',
              description: li.description || '',
              qty: Number(li.qty) || 0,
              unit_price: Number(li.unit_price) || 0,
              ext: Number(li.ext) || 0,
            })
          )
        );
      }
    },
    [supabase]
  );

  const prefillFromEstimate = useCallback(
    async (estimateId: string) => {
      const { data, error } = await supabase
        .from('service_estimates')
        .select('*')
        .eq('id', estimateId)
        .maybeSingle();
      if (error || !data) {
        toast.error('Could not load estimate for convert');
        return;
      }
      setSourceEstimateId(data.id);
      setCustomerName(data.customer_name || '');
      setCustSearch(data.customer_name || '');
      setCustomerOrgId(data.customer_organization_id || null);
      const ed = parseJsonField(data.estimate_data);
      setManufacturer(ed.manufacturer || '');
      setModel(ed.model || data.device_model || '');
      setSerial(ed.serial || '');
      setPulseCount(ed.pulse_count != null ? String(ed.pulse_count) : '');
      setCustAddress(ed.custAddress || '');
      setCustCity(ed.custCity || '');
      setCustState(ed.custState || '');
      setCustZip(ed.custZip || '');
      setCustPhone(ed.custPhone || '');
      setCustEmail(ed.custEmail || '');
      setCustContact(ed.custContact || '');
      setDeposit(Number(ed.deposit ?? ed.travelDeposit) || 0);
      setTax(Number(ed.tax) || 0);
      if (data.total != null) setTotalOverride(Number(data.total));

      let lines: any[] = ed.line_items || ed.part_lines || [];
      if (!Array.isArray(lines) || !lines.length) {
        // Build basic lines from snapshot totals
        lines = [];
        if (ed.labor) {
          lines.push({
            description: `Labor (${ed.laborHours || ''} hrs)`,
            qty: 1,
            unit_price: ed.labor,
          });
        }
        if (ed.partsTotal) {
          lines.push({
            description: 'Parts',
            qty: 1,
            unit_price: ed.partsTotal,
          });
        }
        if (ed.travel) {
          lines.push({
            description: 'Travel',
            qty: 1,
            unit_price: ed.travel,
          });
        }
      }
      if (lines.length) {
        setLineItems(
          lines.map((li: any, i: number) =>
            recomputeExt({
              id: li.id || `LI${i + 1}`,
              part_number: li.part_number || '',
              description: li.description || '',
              qty: Number(li.qty) || 1,
              unit_price: Number(li.unit_price ?? li.ext) || 0,
              ext: Number(li.ext) || 0,
            })
          )
        );
      }

      const parts: string[] = [];
      if (data.device_model) parts.push(`Device: ${data.device_model}`);
      if (data.serial_pulses) parts.push(`Serial/Pulses: ${data.serial_pulses}`);
      let svcs = data.services;
      if (typeof svcs === 'string') {
        try {
          svcs = JSON.parse(svcs);
        } catch {
          svcs = [svcs];
        }
      }
      if (Array.isArray(svcs) && svcs.length) parts.push(`Services: ${svcs.join(', ')}`);
      if (data.issues) parts.push(`Notes: ${data.issues}`);
      parts.push(`Converted from estimate #${data.id}`);
      setDescription(ed.description || parts.join('\n'));
      toast.message('Prefilling invoice from estimate — review and save.');
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
          .select(
            'organization_id, first_name, last_name, organizations(name, address, city, state, zip, phone, email, website, logo_url, slogan)'
          )
          .eq('id', user.id)
          .maybeSingle();
        const orgId = coerceOrgId(profile?.organization_id);
        setUserOrgId(orgId);
        const org = Array.isArray((profile as any)?.organizations)
          ? (profile as any).organizations[0]
          : (profile as any)?.organizations;
        const techName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
        if (org || techName) {
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
        }
        if (orgId) await loadCustomers(orgId);
        await loadParts();

        if (editIdParam) {
          await loadInvoice(editIdParam);
        } else if (fromEstimateParam) {
          await prefillFromEstimate(fromEstimateParam);
        }
        // Allocate invoice numbers at save, not on form open.
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router, editIdParam, fromEstimateParam]);

  function updateLine(id: string, patch: Partial<LineItem>) {
    setTotalOverride(null);
    setLineItems((rows) =>
      rows.map((r) => (r.id === id ? recomputeExt({ ...r, ...patch }) : r))
    );
  }

  function suggestParts(q: string) {
    const s = q.trim().toLowerCase();
    if (!s) return partsCatalog.slice(0, 8);
    return partsCatalog
      .filter((p) =>
        [p.part_number, p.name, p.description, p.brand]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(s)
      )
      .slice(0, 8);
  }

  async function saveInvoice(
    nextStatus: string,
    opts?: { quiet?: boolean }
  ): Promise<string | number | null> {
    const name = customerName.trim() || custSearch.trim();
    if (!name) {
      toast.error('Customer name is required');
      return null;
    }
    setSaving(true);
    try {
      let invNum = editIdParam ? docNumber : '';
      if (!invNum && userOrgId) {
        invNum = await allocateDocNumber(supabase, {
          orgId: userOrgId,
          kind: 'INV',
          date: invoiceDate || new Date(),
        });
        setDocNumber(invNum);
      }
      if (!invNum) {
        throw new Error('Could not allocate an invoice number. Try again.');
      }

      const items = lineItems.filter(
        (li) => li.part_number || li.description || li.qty || li.unit_price
      );

      const payload: Record<string, any> = {
        customer_name: name,
        organization_id: userOrgId || null,
        customer_organization_id: customerOrgId || null,
        estimate_id: sourceEstimateId || null,
        invoice_date: invoiceDate || todayYmd(),
        due_date: dueDate || null,
        description: description || null,
        subtotal: Math.round(subtotal * 100) / 100,
        tax: Math.round((Number(tax) || 0) * 100) / 100,
        total: Math.round(total * 100) / 100,
        status: nextStatus,
        invoice_number: invNum,
        invoice_data: {
          line_items: items,
          deposit: Number(deposit) || 0,
          travelDeposit: Number(deposit) || 0,
          depositDate: depositDate || null,
          depositMethod: depositMethod || null,
          balanceDue,
          manufacturer,
          model,
          serial,
          pulse_count: pulseCount,
          invoice_number: invNum,
          invNumber: invNum,
          custAddress,
          custCity,
          custState,
          custZip,
          custPhone,
          custEmail,
          custContact,
        },
      };

      if (!savedId) {
        payload.created_by = userId;
        payload.created_at = new Date().toISOString();
      }

      const result = await writeWithColumnRetry(
        supabase,
        'service_invoices',
        payload,
        savedId
      );
      if (result.error) throw result.error;

      if (result.id) {
        setSavedId(result.id);
        setStatus(nextStatus);
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('id', String(result.id));
          url.searchParams.delete('fromEstimate');
          window.history.replaceState({}, '', url.toString());
        } catch {
          /* ignore */
        }
      }

      if (sourceEstimateId) {
        try {
          await supabase
            .from('service_estimates')
            .update({ status: 'invoiced' })
            .eq('id', sourceEstimateId);
        } catch (e) {
          console.warn('mark estimate invoiced', e);
        }
      }

      if (!opts?.quiet) {
        if (nextStatus === 'draft') toast.success('Invoice draft saved!');
        else if (nextStatus === 'sent')
          toast.success('Invoice marked as sent (no email sent).');
        else if (nextStatus === 'paid') toast.success('Invoice marked as paid.');
        else toast.success('Invoice saved.');
      }
      return result.id || savedId;
    } catch (err: any) {
      const em = err?.message || String(err);
      if (/service_invoices|schema cache|does not exist/i.test(em)) {
        toast.error(
          'Table service_invoices missing. Run create_service_estimates_and_invoices.sql in Supabase.'
        );
      } else {
        toast.error(`Save failed: ${em}`);
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  function buildInvoiceEmailHtml() {
    return buildInvoiceHtml({
      company,
      customer: {
        name: customerName.trim() || custSearch.trim(),
        address: custAddress,
        city: custCity,
        state: custState,
        zip: custZip,
        contact: custContact,
        phone: custPhone,
        email: custEmail,
      },
      invNumber: docNumber || 'Draft',
      invoiceDate: invoiceDate || todayYmd(),
      dueDate: dueDate || undefined,
      description: description || undefined,
      preparedBy: company.tech_name,
      fromEstimateId: sourceEstimateId,
      lines: lineItems,
      subtotal,
      tax: Number(tax) || 0,
      total,
      deposit: Number(deposit) || 0,
      depositDate: depositDate || undefined,
      depositMethod: depositMethod || undefined,
      balanceDue,
    });
  }

  /** Save draft, email via Resend, only set status=sent when email actually delivered. */
  async function finalizeAndEmail() {
    if (!custEmail.trim() && !customerOrgId) {
      toast.error('Add a customer email on the form or CRM profile before emailing.');
      return;
    }
    setEmailing(true);
    try {
      const id = await saveInvoice('draft', { quiet: true });
      if (!id) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired — sign in again');
        return;
      }

      const html = buildInvoiceEmailHtml();
      const result = await sendBillingDocEmail({
        kind: 'invoice',
        accessToken: session.access_token,
        payload: {
          invoice_id: id,
          to_email: custEmail.trim() || undefined,
          invoice_number: docNumber,
          balance_due: balanceDue,
          total,
          customer_organization_id: customerOrgId,
          company_name: company.company_name,
          reply_to: company.email || undefined,
          html,
          include_payment_link: true,
        },
      });

      if (!result.emailSent) {
        toast.error(
          result.error ||
            'Email was not sent. Invoice remains a draft. Fix email/Resend domain or use “Mark sent without email”.'
        );
        if (result.needsConfig) {
          toast.message(
            'Server needs RESEND_API_KEY and a verified From domain (medicalrepairnetwork.com).'
          );
        }
        return;
      }

      // Only now mark sent
      await saveInvoice('sent', { quiet: true });
      const payNote = result.paymentUrl
        ? ' Stripe pay link included.'
        : result.stripeSkippedReason
          ? ` (${result.stripeSkippedReason})`
          : '';
      toast.success(`Invoice emailed to ${result.to}.${payNote}`);
    } finally {
      setEmailing(false);
    }
  }

  async function resendEmail() {
    if (!savedId) {
      toast.error('Save the invoice first');
      return;
    }
    setEmailing(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired — sign in again');
        return;
      }
      const result = await sendBillingDocEmail({
        kind: 'invoice',
        accessToken: session.access_token,
        payload: {
          invoice_id: savedId,
          to_email: custEmail.trim() || undefined,
          invoice_number: docNumber,
          balance_due: balanceDue,
          total,
          customer_organization_id: customerOrgId,
          company_name: company.company_name,
          reply_to: company.email || undefined,
          html: buildInvoiceEmailHtml(),
          include_payment_link: true,
        },
      });
      if (!result.emailSent) {
        toast.error(result.error || 'Resend failed');
        return;
      }
      toast.success(`Invoice re-sent to ${result.to}`);
    } finally {
      setEmailing(false);
    }
  }

  function markSentWithoutEmail() {
    if (
      !confirm(
        'Mark this invoice as sent WITHOUT emailing the customer?\n\nUse this only if you already emailed a PDF yourself.'
      )
    ) {
      return;
    }
    saveInvoice('sent');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
          Loading invoice…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-4xl mx-auto w-full px-4 py-6 pb-28">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <Link href="/invoices" className="text-sm text-[var(--gold)] hover:underline">
              ← Invoices
            </Link>
            <h1 className="text-2xl font-extrabold mt-1">
              {savedId ? 'Edit Invoice' : sourceEstimateId ? 'Invoice from Estimate' : 'New Invoice'}
            </h1>
            <div className="text-sm text-[var(--text3)] mt-0.5 flex flex-wrap gap-2 items-center">
              {docNumber && (
                <span className="text-[var(--gold)] font-bold">{docNumber}</span>
              )}
              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border border-[var(--border2)] bg-[var(--surface2)]">
                {(status || 'draft').toUpperCase()}
              </span>
              {sourceEstimateId && (
                <span className="text-xs">from estimate #{sourceEstimateId}</span>
              )}
            </div>
          </div>
        </div>

        <section className="card p-4 mb-4">
          <h2 className="font-bold text-lg mb-3 text-[var(--gold)]">Customer</h2>
          <div className="relative mb-3">
            <label className="text-xs text-[var(--text3)] font-semibold">Search / name</label>
            <input
              className="input mt-1"
              value={custSearch}
              onChange={(e) => {
                setCustSearch(e.target.value);
                setCustomerName(e.target.value);
                setShowCustDrop(true);
                if (!e.target.value) setCustomerOrgId(null);
              }}
              onFocus={() => setShowCustDrop(true)}
              placeholder="Type customer name…"
              autoComplete="off"
            />
            {showCustDrop && filteredCustomers.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--border2)] bg-[var(--surface3)] shadow-lg">
                {filteredCustomers.map((c) => (
                  <button
                    key={String(c.id)}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-[var(--surface)] text-sm"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyCustomer(c)}
                  >
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-[var(--text3)]">
                      {[c.city, c.state].filter(Boolean).join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text3)]">Address</label>
              <input className="input mt-1" value={custAddress} onChange={(e) => setCustAddress(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Contact</label>
              <input className="input mt-1" value={custContact} onChange={(e) => setCustContact(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Phone</label>
              <input className="input mt-1" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Email</label>
              <input className="input mt-1" type="email" value={custEmail} onChange={(e) => setCustEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">City</label>
              <input className="input mt-1" value={custCity} onChange={(e) => setCustCity(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-[var(--text3)]">State</label>
                <input className="input mt-1" maxLength={2} value={custState} onChange={(e) => setCustState(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-[var(--text3)]">ZIP</label>
                <input className="input mt-1" value={custZip} onChange={(e) => setCustZip(e.target.value)} />
              </div>
            </div>
          </div>
        </section>

        <section className="card p-4 mb-4">
          <h2 className="font-bold text-lg mb-3 text-[var(--gold)]">Equipment (optional)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text3)]">Manufacturer</label>
              <select
                className="input select mt-1"
                value={manufacturer}
                onChange={(e) => {
                  setManufacturer(e.target.value);
                  setModel('');
                }}
              >
                <option value="">— Select —</option>
                {manufacturers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Model</label>
              <select
                className="input select mt-1"
                value={model}
                disabled={!manufacturer}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="">— Select —</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Serial #</label>
              <input className="input mt-1" value={serial} onChange={(e) => setSerial(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Pulse count</label>
              <input
                className="input mt-1"
                type="number"
                min={0}
                value={pulseCount}
                onChange={(e) => setPulseCount(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="card p-4 mb-4">
          <h2 className="font-bold text-lg mb-3 text-[var(--gold)]">Invoice Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-[var(--text3)]">Invoice date</label>
              <input
                className="input mt-1"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Due date</label>
              <input
                className="input mt-1"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--text3)]">Notes / description</label>
            <textarea
              className="input mt-1"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes (service summary, PO #, etc.)"
            />
          </div>

          <h3 className="font-bold text-sm mt-5 mb-2 text-[var(--gold)]">Line Items</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[var(--text3)] text-xs border-b border-[var(--border2)]">
                  <th className="py-2 pr-2">Part #</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2 w-16">Qty</th>
                  <th className="py-2 pr-2 w-24">Price</th>
                  <th className="py-2 pr-2 w-24">Ext</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li) => (
                  <tr key={li.id} className="border-b border-[var(--border)]/50">
                    <td className="py-1.5 pr-2 align-top">
                      <input
                        className="input text-sm py-1.5"
                        list={`inv-parts-${li.id}`}
                        value={li.part_number}
                        onChange={(e) => {
                          const pn = e.target.value;
                          updateLine(li.id, { part_number: pn });
                          const hit = partsCatalog.find(
                            (p) =>
                              String(p.part_number || '').toLowerCase() ===
                              pn.trim().toLowerCase()
                          );
                          if (hit) {
                            updateLine(li.id, {
                              part_number: hit.part_number || pn,
                              description: hit.name || hit.description || li.description,
                            });
                          }
                        }}
                        placeholder="Part #"
                      />
                      <datalist id={`inv-parts-${li.id}`}>
                        {suggestParts(li.part_number).map((p) => (
                          <option key={p.id || p.part_number} value={p.part_number || ''}>
                            {p.name || p.description || ''}
                          </option>
                        ))}
                      </datalist>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        className="input text-sm py-1.5"
                        value={li.description}
                        onChange={(e) => updateLine(li.id, { description: e.target.value })}
                        placeholder="Description"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        className="input text-sm py-1.5"
                        type="number"
                        step="any"
                        min={0}
                        value={li.qty}
                        onChange={(e) =>
                          updateLine(li.id, { qty: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        className="input text-sm py-1.5"
                        type="number"
                        step="0.01"
                        min={0}
                        value={li.unit_price}
                        onChange={(e) =>
                          updateLine(li.id, {
                            unit_price: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        className="input text-sm py-1.5 opacity-80"
                        readOnly
                        value={li.ext.toFixed(2)}
                      />
                    </td>
                    <td className="py-1.5">
                      <button
                        type="button"
                        className="text-red-400 text-lg px-1"
                        onClick={() =>
                          setLineItems((rows) =>
                            rows.length <= 1
                              ? [emptyLineItem('LI')]
                              : rows.filter((r) => r.id !== li.id)
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
          </div>
          <button
            type="button"
            className="btn btn-secondary text-sm mt-2"
            onClick={() => setLineItems((r) => [...r, emptyLineItem('LI')])}
          >
            + Add line item
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div>
              <label className="text-xs text-[var(--text3)]">Subtotal (from line items)</label>
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

          <h3 className="font-bold text-sm mt-5 mb-2 text-[var(--gold)]">Deposit Received</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[var(--text3)]">Deposit amount ($)</label>
              <input
                className="input mt-1"
                type="number"
                step="0.01"
                min={0}
                value={deposit}
                onChange={(e) => setDeposit(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Deposit date</label>
              <input
                className="input mt-1"
                type="date"
                value={depositDate}
                onChange={(e) => setDepositDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Payment method</label>
              <select
                className="input select mt-1"
                value={depositMethod}
                onChange={(e) => setDepositMethod(e.target.value)}
              >
                <option value="">— Select —</option>
                <option value="Cash">Cash</option>
                <option value="Check">Check</option>
                <option value="Credit Card">Credit Card</option>
                <option value="ACH / Wire">ACH / Wire</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-[var(--text3)] mt-2">
            Balance remaining = Total Due − Deposit Received. Online card pay is not wired on web
            yet (use recorded deposit / mark paid).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div>
              <label className="text-xs text-[var(--text3)] font-bold">Total Due</label>
              <input
                className="input mt-1 font-bold text-lg"
                type="number"
                step="0.01"
                value={total}
                onChange={(e) => setTotalOverride(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)] font-bold">Balance remaining</label>
              <input
                className="input mt-1 font-bold text-lg opacity-90"
                readOnly
                value={balanceDue.toFixed(2)}
              />
            </div>
          </div>
          <div className="text-right mt-2 text-[var(--gold)] font-extrabold text-xl">
            {money(total)}
          </div>
        </section>

        <div className="flex flex-wrap gap-2 sticky bottom-4 z-10">
          <Link href="/invoices" className="btn btn-secondary min-w-[80px] text-center">
            Cancel
          </Link>
          <button
            type="button"
            className="btn btn-secondary min-w-[100px]"
            disabled={saving || emailing}
            onClick={() => saveInvoice('draft')}
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
          {status === 'sent' && (
            <button
              type="button"
              className="btn btn-secondary min-w-[110px]"
              disabled={saving || emailing}
              onClick={() => resendEmail()}
            >
              Resend Email
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary min-w-[100px] text-xs"
            disabled={saving || emailing}
            onClick={() => markSentWithoutEmail()}
            aria-label="Mark sent (no email)"
            title="Sets status to sent without calling Resend"
          >
            Mark sent (no email)
          </button>
          <button
            type="button"
            className="btn btn-secondary min-w-[100px]"
            disabled={saving || emailing}
            onClick={() => saveInvoice('paid')}
          >
            Mark Paid
          </button>
        </div>
        <p className="text-[10px] text-[var(--text3)] mt-2">
          Finalize &amp; Email only sets status to <strong>sent</strong> after Resend accepts the
          message. Requires customer email + verified From domain (contact@medicalrepairnetwork.com).
        </p>

        {!isValidOrgId(userOrgId) && (
          <p className="text-xs text-amber-400 mt-4">
            No organization on your profile — invoice may save without org scope.
          </p>
        )}
      </div>
    </div>
  );
}
