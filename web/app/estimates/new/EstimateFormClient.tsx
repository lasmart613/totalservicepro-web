'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { generateDocNumber } from '@/lib/billing/doc-numbers';
import { buildEstimateHtml, type DocCompany } from '@/lib/billing/doc-html';
import { sendBillingDocEmail } from '@/lib/billing/send-doc-email';
import {
  coerceOrgId,
  emptyLineItem,
  isValidOrgId,
  lineItemsSubtotal,
  money,
  parseJsonField,
  recomputeExt,
  SERVICE_TYPE_LABELS,
  SERVICE_TYPES,
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

export default function EstimateFormClient() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editIdParam = searchParams.get('id');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | number | null>(editIdParam);
  const [userOrgId, setUserOrgId] = useState<string | number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [docNumber, setDocNumber] = useState('');
  const [status, setStatus] = useState('draft');
  const [company, setCompany] = useState<DocCompany>({});
  const [emailing, setEmailing] = useState(false);

  // Customer
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

  // Equipment
  const manufacturers = useMemo(() => listManufacturers(), []);
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [serial, setSerial] = useState('');
  const [pulseCount, setPulseCount] = useState('');
  const models = useMemo(
    () => (manufacturer ? listModelsForManufacturer(manufacturer) : []),
    [manufacturer]
  );

  // Services / notes
  const [services, setServices] = useState<string[]>([]);
  const [otherService, setOtherService] = useState('');
  const [issues, setIssues] = useState('');
  const [miles, setMiles] = useState(0);
  const [urgency, setUrgency] = useState('standard');

  // Pricing
  const [laborRate, setLaborRate] = useState(185);
  const [laborHours, setLaborHours] = useState(2);
  const [travelRate, setTravelRate] = useState(1.25);
  const [diagFee, setDiagFee] = useState(250);
  const [taxRate, setTaxRate] = useState(8.75);
  const [reimbTravel, setReimbTravel] = useState(0);
  const [reimbLodging, setReimbLodging] = useState(0);
  const [reimbGround, setReimbGround] = useState(0);
  const [reimbOther, setReimbOther] = useState(0);
  const [perDiemRate, setPerDiemRate] = useState(0);
  const [perDiemDays, setPerDiemDays] = useState(0);
  const [partLines, setPartLines] = useState<LineItem[]>([emptyLineItem('EP')]);
  const [depositRequired, setDepositRequired] = useState(true);
  const [deposit, setDeposit] = useState(0);
  const [depositManual, setDepositManual] = useState(false);

  // Parts catalog (lightweight suggest)
  const [partsCatalog, setPartsCatalog] = useState<any[]>([]);

  const totals = useMemo(() => {
    const partsTotal = lineItemsSubtotal(partLines);
    const mileage = travelRate * miles;
    const perDiem = perDiemRate * perDiemDays;
    const reimbTotal = reimbTravel + reimbLodging + reimbGround + reimbOther;
    const labor = laborRate * laborHours;
    const subtotal = diagFee + labor + mileage + reimbTotal + perDiem + partsTotal;
    const tax = subtotal * (taxRate / 100);
    const grandTotal = subtotal + tax;
    const suggestedDeposit = partsTotal + mileage + reimbTotal + perDiem;
    const depositAmt = depositRequired ? Math.max(0, deposit) : 0;
    const balanceDue = Math.max(0, grandTotal - depositAmt);
    return {
      partsTotal,
      mileage,
      perDiem,
      reimbTotal,
      labor,
      subtotal,
      tax,
      grandTotal,
      suggestedDeposit,
      depositAmt,
      balanceDue,
    };
  }, [
    partLines,
    travelRate,
    miles,
    perDiemRate,
    perDiemDays,
    reimbTravel,
    reimbLodging,
    reimbGround,
    reimbOther,
    laborRate,
    laborHours,
    diagFee,
    taxRate,
    depositRequired,
    deposit,
  ]);

  // Auto-suggest deposit when not manually overridden
  useEffect(() => {
    if (!depositManual && depositRequired) {
      setDeposit(
        totals.suggestedDeposit > 0
          ? Math.round(totals.suggestedDeposit * 100) / 100
          : 0
      );
    }
    if (!depositRequired) setDeposit(0);
  }, [totals.suggestedDeposit, depositManual, depositRequired]);

  const filteredCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 12);
    return customers
      .filter((c) => {
        const hay = [c.name, c.city, c.state, c.phone, c.email].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [customers, custSearch]);

  const loadCustomers = useCallback(
    async (orgId: string | number) => {
      try {
        const { data: links } = await supabase
          .from('organization_customers')
          .select('customer_organization_id')
          .eq('service_organization_id', orgId)
          .limit(500);
        const ids = Array.from(
          new Set((links || []).map((r: any) => r.customer_organization_id).filter(Boolean))
        );
        if (!ids.length) {
          setCustomers([]);
          return;
        }
        const { data: custs } = await supabase
          .from('organizations')
          .select('id, name, address, city, state, phone, email, zip, contact_name')
          .in('id', ids)
          .order('name', { ascending: true });
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
      } catch (e) {
        console.warn('load customers', e);
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

  const loadEstimate = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from('service_estimates')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) {
        toast.error('Could not load estimate');
        return;
      }
      setSavedId(data.id);
      setStatus(data.status || 'draft');
      setCustomerName(data.customer_name || '');
      setCustSearch(data.customer_name || '');
      setCustomerOrgId(data.customer_organization_id || null);
      const ed = parseJsonField(data.estimate_data);
      setDocNumber(data.estimate_number || ed.estimate_number || ed.estNumber || '');
      setManufacturer(ed.manufacturer || '');
      setModel(ed.model || '');
      setSerial(ed.serial || '');
      setPulseCount(ed.pulse_count != null ? String(ed.pulse_count) : '');
      setCustAddress(ed.custAddress || ed.address || '');
      setCustCity(ed.custCity || ed.city || '');
      setCustState(ed.custState || ed.state || '');
      setCustZip(ed.custZip || ed.zip || '');
      setCustPhone(ed.custPhone || ed.phone || '');
      setCustEmail(ed.custEmail || ed.email || '');
      setCustContact(ed.custContact || ed.contact || '');
      let svcs = data.services;
      if (typeof svcs === 'string') {
        try {
          svcs = JSON.parse(svcs);
        } catch {
          svcs = [svcs];
        }
      }
      if (Array.isArray(svcs)) {
        const known = svcs.filter((s: string) =>
          (SERVICE_TYPES as readonly string[]).includes(s)
        );
        const other = svcs.find(
          (s: string) => String(s).startsWith('Other:') || !(SERVICE_TYPES as readonly string[]).includes(s)
        );
        setServices(known);
        if (other) {
          setOtherService(String(other).replace(/^Other:\s*/, ''));
        }
      }
      setIssues(data.issues || '');
      if (ed.laborHours != null) setLaborHours(Number(ed.laborHours) || 0);
      if (ed.miles != null) setMiles(Number(ed.miles) || 0);
      if (ed.urgency) setUrgency(String(ed.urgency));
      if (ed.pricing) {
        if (ed.pricing.laborRate != null) setLaborRate(Number(ed.pricing.laborRate));
        if (ed.pricing.travelRate != null) setTravelRate(Number(ed.pricing.travelRate));
        if (ed.pricing.diagFee != null) setDiagFee(Number(ed.pricing.diagFee));
        if (ed.pricing.taxRate != null) setTaxRate(Number(ed.pricing.taxRate));
      }
      if (ed.labor != null && ed.laborHours) {
        /* labor is derived */
      }
      if (ed.reimbTravel != null) setReimbTravel(Number(ed.reimbTravel) || 0);
      if (ed.reimbLodging != null) setReimbLodging(Number(ed.reimbLodging) || 0);
      if (ed.reimbGround != null) setReimbGround(Number(ed.reimbGround) || 0);
      if (ed.reimbOther != null) setReimbOther(Number(ed.reimbOther) || 0);
      if (ed.perDiemRate != null) setPerDiemRate(Number(ed.perDiemRate) || 0);
      if (ed.perDiemDays != null) setPerDiemDays(Number(ed.perDiemDays) || 0);
      const lines = ed.part_lines || ed.line_items || [];
      if (Array.isArray(lines) && lines.length) {
        setPartLines(
          lines.map((li: any, i: number) =>
            recomputeExt({
              id: li.id || `EP${i + 1}`,
              part_number: li.part_number || '',
              description: li.description || '',
              qty: Number(li.qty) || 0,
              unit_price: Number(li.unit_price) || 0,
              ext: Number(li.ext) || 0,
            })
          )
        );
      }
      setDepositRequired(ed.deposit_required !== false && ed.deposit_required !== 0);
      if (ed.deposit != null || ed.travelDeposit != null) {
        setDeposit(Number(ed.deposit ?? ed.travelDeposit) || 0);
        setDepositManual(true);
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

        // Restore local pricing defaults
        try {
          const saved = JSON.parse(localStorage.getItem('tsp_estimate_pricing') || '{}');
          if (saved.laborRate) setLaborRate(Number(saved.laborRate));
          if (saved.travelRate) setTravelRate(Number(saved.travelRate));
          if (saved.diagFee != null) setDiagFee(Number(saved.diagFee));
          if (saved.taxRate != null) setTaxRate(Number(saved.taxRate));
        } catch {
          /* ignore */
        }

        if (editIdParam) {
          await loadEstimate(editIdParam);
        } else if (orgId) {
          try {
            const num = await generateDocNumber(supabase, {
              orgId,
              kind: 'EST',
              date: new Date(),
            });
            setDocNumber(num);
          } catch (e) {
            console.warn('doc number', e);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase, router, editIdParam, loadCustomers, loadParts, loadEstimate]);

  // Persist pricing prefs
  useEffect(() => {
    try {
      localStorage.setItem(
        'tsp_estimate_pricing',
        JSON.stringify({ laborRate, travelRate, diagFee, taxRate })
      );
    } catch {
      /* ignore */
    }
  }, [laborRate, travelRate, diagFee, taxRate]);

  function toggleService(val: string) {
    setServices((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val]
    );
  }

  function updatePartLine(id: string, patch: Partial<LineItem>) {
    setPartLines((rows) =>
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

  async function saveEstimate(
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
      let estNum = docNumber;
      if (!estNum && userOrgId) {
        estNum = await generateDocNumber(supabase, {
          orgId: userOrgId,
          kind: 'EST',
          date: new Date(),
          existing: docNumber || null,
        });
        setDocNumber(estNum);
      }
      if (!estNum) {
        estNum = `TSP-EST-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`;
        setDocNumber(estNum);
      }

      const modelName = model === '__other__' ? customModel.trim() : model;
      const mfr = manufacturer === '__other__' ? '' : manufacturer;
      const deviceModel = [mfr, modelName].filter(Boolean).join(' ') || null;
      const serialPulses = [serial, pulseCount ? `${pulseCount} pulses` : '']
        .filter(Boolean)
        .join(' · ') || null;

      const svcList = [...services];
      if (otherService.trim()) svcList.push(`Other: ${otherService.trim()}`);

      const payload: Record<string, any> = {
        customer_name: name,
        organization_id: userOrgId || null,
        customer_organization_id: customerOrgId || null,
        estimate_number: estNum,
        device_model: deviceModel,
        serial_pulses: serialPulses,
        services: svcList,
        issues: issues || null,
        total: Math.round(totals.grandTotal * 100) / 100,
        status: nextStatus,
        estimate_data: {
          manufacturer: mfr,
          model: modelName,
          serial,
          pulse_count: pulseCount,
          subtotal: totals.subtotal,
          tax: totals.tax,
          labor: totals.labor,
          travel: totals.mileage,
          reimbTravel,
          reimbLodging,
          reimbGround,
          reimbOther,
          travelReimburse: totals.reimbTotal,
          perDiem: totals.perDiem,
          perDiemRate,
          perDiemDays,
          partsTotal: totals.partsTotal,
          part_lines: partLines.filter((p) => p.part_number || p.description || p.qty || p.unit_price),
          partsText: partLines
            .filter((p) => p.description || p.part_number)
            .map((p) => `${[p.part_number, p.description].filter(Boolean).join(' ')}: ${p.ext.toFixed(2)}`)
            .join('\n'),
          deposit_required: depositRequired,
          deposit: totals.depositAmt,
          travelDeposit: totals.depositAmt,
          balanceDue: totals.balanceDue,
          laborHours,
          miles,
          urgency,
          pricing: { laborRate, travelRate, diagFee, taxRate },
          description: issues || '',
          line_items: [
            ...(diagFee > 0
              ? [
                  {
                    id: 'diag',
                    part_number: '',
                    description: 'Diagnostic Fee',
                    qty: 1,
                    unit_price: diagFee,
                    ext: diagFee,
                  },
                ]
              : []),
            ...(totals.labor > 0
              ? [
                  {
                    id: 'labor',
                    part_number: '',
                    description: `Labor (${laborHours} hrs @ $${laborRate}/hr)`,
                    qty: 1,
                    unit_price: totals.labor,
                    ext: totals.labor,
                  },
                ]
              : []),
            ...(totals.mileage > 0
              ? [
                  {
                    id: 'travel',
                    part_number: '',
                    description: `Travel mileage (${miles} mi @ $${travelRate}/mi)`,
                    qty: 1,
                    unit_price: totals.mileage,
                    ext: totals.mileage,
                  },
                ]
              : []),
            ...partLines
              .filter((p) => p.part_number || p.description || p.ext)
              .map((p) => ({ ...p })),
            ...(reimbTravel > 0
              ? [{ id: 'rt', part_number: '', description: 'Travel reimbursement', qty: 1, unit_price: reimbTravel, ext: reimbTravel }]
              : []),
            ...(reimbLodging > 0
              ? [{ id: 'rl', part_number: '', description: 'Lodging', qty: 1, unit_price: reimbLodging, ext: reimbLodging }]
              : []),
            ...(reimbGround > 0
              ? [{ id: 'rg', part_number: '', description: 'Ground transportation', qty: 1, unit_price: reimbGround, ext: reimbGround }]
              : []),
            ...(reimbOther > 0
              ? [{ id: 'ro', part_number: '', description: 'Other reimbursements', qty: 1, unit_price: reimbOther, ext: reimbOther }]
              : []),
            ...(totals.perDiem > 0
              ? [{ id: 'pd', part_number: '', description: `Per diem (${perDiemDays} days)`, qty: 1, unit_price: totals.perDiem, ext: totals.perDiem }]
              : []),
          ],
          custAddress,
          custCity,
          custState,
          custZip,
          custPhone,
          custEmail,
          custContact,
          estimate_number: estNum,
          estNumber: estNum,
        },
      };

      if (!savedId) {
        payload.created_by = userId;
      }

      const result = await writeWithColumnRetry(
        supabase,
        'service_estimates',
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
          window.history.replaceState({}, '', url.toString());
        } catch {
          /* ignore */
        }
      }

      if (!opts?.quiet) {
        if (nextStatus === 'draft') {
          toast.success(
            'Estimate draft saved. Valid for 30 days from today, then marked Expired (not deleted).'
          );
        } else if (nextStatus === 'pending' || nextStatus === 'sent') {
          toast.success('Estimate marked as sent (no email sent).');
        } else {
          toast.success('Estimate saved.');
        }
      }
      return result.id || savedId;
    } catch (err: any) {
      const em = err?.message || String(err);
      if (/service_estimates|schema cache|does not exist/i.test(em)) {
        toast.error(
          'Table service_estimates missing. Run create_service_estimates_and_invoices.sql in Supabase.'
        );
      } else {
        toast.error(`Save failed: ${em}`);
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  function buildEstimateEmailHtml() {
    const modelName = model === '__other__' ? customModel.trim() : model;
    const svcLabels = services.map((s) => SERVICE_TYPE_LABELS[s] || s);
    if (otherService.trim()) svcLabels.push(otherService.trim());
    const partsLines = partLines
      .filter((p) => p.part_number || p.description || p.ext)
      .map(
        (p) =>
          `${p.part_number || ''} ${p.description || ''} ×${p.qty || 1} @ $${Number(p.unit_price || 0).toFixed(2)} = $${Number(p.ext || 0).toFixed(2)}`
      );
    return buildEstimateHtml({
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
      estNumber: docNumber || 'Draft',
      dateStr: new Date().toLocaleDateString(),
      manufacturer,
      model: modelName,
      serial,
      pulseCount,
      miles,
      urgency,
      services: svcLabels,
      issues,
      laborHours,
      laborRate,
      labor: totals.labor,
      travelRate,
      travel: totals.mileage,
      diagFee,
      reimbTravel,
      reimbLodging,
      reimbGround,
      reimbOther,
      perDiem: totals.perDiem,
      perDiemRate,
      perDiemDays,
      partsLines,
      partsTotal: totals.partsTotal,
      subtotal: totals.subtotal,
      taxRate,
      tax: totals.tax,
      total: totals.grandTotal,
      deposit: totals.depositAmt,
      balanceDue: totals.balanceDue,
      validDays: 30,
    });
  }

  async function finalizeAndEmailEstimate() {
    if (!custEmail.trim() && !customerOrgId) {
      toast.error('Add a customer email on the form or CRM profile before emailing.');
      return;
    }
    setEmailing(true);
    try {
      const id = await saveEstimate('draft', { quiet: true });
      if (!id) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired — sign in again');
        return;
      }
      const result = await sendBillingDocEmail({
        kind: 'estimate',
        accessToken: session.access_token,
        payload: {
          estimate_id: id,
          to_email: custEmail.trim() || undefined,
          estimate_number: docNumber,
          customer_organization_id: customerOrgId,
          reply_to: company.email || undefined,
          html: buildEstimateEmailHtml(),
        },
      });
      if (!result.emailSent) {
        toast.error(
          result.error ||
            'Email was not sent. Estimate remains a draft. Fix Resend/domain or use “Mark sent without email”.'
        );
        return;
      }
      await saveEstimate('pending', { quiet: true });
      toast.success(`Estimate emailed to ${result.to}.`);
    } finally {
      setEmailing(false);
    }
  }

  function markSentWithoutEmail() {
    if (
      !confirm(
        'Mark this estimate as sent WITHOUT emailing the customer?\n\nUse only if you already shared a PDF yourself.'
      )
    ) {
      return;
    }
    saveEstimate('pending');
  }

  function convertToInvoice() {
    if (!savedId) {
      toast.error('Save the estimate first, then convert.');
      return;
    }
    router.push(`/invoices/new?fromEstimate=${savedId}`);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
          Loading estimate…
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
            <Link href="/estimates" className="text-sm text-[var(--gold)] hover:underline">
              ← Estimates
            </Link>
            <h1 className="text-2xl font-extrabold mt-1">
              {savedId ? 'Edit Estimate' : 'New Estimate'}
            </h1>
            <div className="text-sm text-[var(--text3)] mt-0.5 flex flex-wrap gap-2 items-center">
              {docNumber && (
                <span className="text-[var(--gold)] font-bold">{docNumber}</span>
              )}
              <span
                className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border border-[var(--border2)] bg-[var(--surface2)]"
              >
                {(status || 'draft').toUpperCase()}
              </span>
            </div>
          </div>
          {savedId && status !== 'invoiced' && status !== 'expired' && (
            <button type="button" className="btn btn-primary text-sm" onClick={convertToInvoice}>
              Convert to Invoice
            </button>
          )}
        </div>

        {/* Customer */}
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

        {/* Equipment */}
        <section className="card p-4 mb-4">
          <h2 className="font-bold text-lg mb-3 text-[var(--gold)]">Equipment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text3)]">Manufacturer</label>
              <select
                className="input select mt-1"
                value={manufacturer}
                onChange={(e) => {
                  setManufacturer(e.target.value);
                  setModel('');
                  setCustomModel('');
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
                <option value="__other__">Other / custom…</option>
              </select>
              {model === '__other__' && (
                <input
                  className="input mt-2"
                  placeholder="Custom model name"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                />
              )}
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

        {/* Service types */}
        <section className="card p-4 mb-4">
          <h2 className="font-bold text-lg mb-3 text-[var(--gold)]">Service Type(s)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SERVICE_TYPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={services.includes(s)}
                  onChange={() => toggleService(s)}
                  className="accent-[var(--gold)]"
                />
                {SERVICE_TYPE_LABELS[s] || s}
              </label>
            ))}
          </div>
          <textarea
            className="input mt-3"
            rows={2}
            placeholder="Describe repair details or custom work…"
            value={otherService}
            onChange={(e) => setOtherService(e.target.value)}
          />
        </section>

        <section className="card p-4 mb-4">
          <h2 className="font-bold text-lg mb-3 text-[var(--gold)]">Reported Issues / Notes</h2>
          <textarea
            className="input"
            rows={4}
            placeholder="e.g. Low energy output, error code E-12…"
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
          />
        </section>

        <section className="card p-4 mb-4">
          <h2 className="font-bold text-lg mb-3 text-[var(--gold)]">Travel & Urgency</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text3)]">Miles (round-trip)</label>
              <input
                className="input mt-1"
                type="number"
                min={0}
                value={miles}
                onChange={(e) => setMiles(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text3)]">Urgency</label>
              <select
                className="input select mt-1"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value)}
              >
                <option value="standard">Standard (next available)</option>
                <option value="rush">Rush (within 48h)</option>
                <option value="emergency">Emergency (same/next day)</option>
              </select>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="card p-4 mb-4">
          <h2 className="font-bold text-lg mb-3 text-[var(--gold)]">Pricing</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(
              [
                ['Labor rate ($/hr)', laborRate, setLaborRate],
                ['Labor hours', laborHours, setLaborHours],
                ['Travel rate ($/mi)', travelRate, setTravelRate],
                ['Diagnostic fee', diagFee, setDiagFee],
                ['Tax rate (%)', taxRate, setTaxRate],
              ] as [string, number, (n: number) => void][]
            ).map(([label, val, set]) => (
              <div key={label}>
                <label className="text-xs text-[var(--text3)]">{label}</label>
                <input
                  className="input mt-1"
                  type="number"
                  step="any"
                  min={0}
                  value={val}
                  onChange={(e) => set(parseFloat(e.target.value) || 0)}
                />
              </div>
            ))}
          </div>

          <h3 className="font-bold text-sm mt-5 mb-2 text-[var(--gold)]">Reimbursable expenses</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(
              [
                ['Airfare / tickets', reimbTravel, setReimbTravel],
                ['Lodging', reimbLodging, setReimbLodging],
                ['Ground transport', reimbGround, setReimbGround],
                ['Other', reimbOther, setReimbOther],
                ['Per diem $/day', perDiemRate, setPerDiemRate],
                ['Per diem days', perDiemDays, setPerDiemDays],
              ] as [string, number, (n: number) => void][]
            ).map(([label, val, set]) => (
              <div key={label}>
                <label className="text-xs text-[var(--text3)]">{label}</label>
                <input
                  className="input mt-1"
                  type="number"
                  step="0.01"
                  min={0}
                  value={val}
                  onChange={(e) => set(parseFloat(e.target.value) || 0)}
                />
              </div>
            ))}
          </div>

          <h3 className="font-bold text-sm mt-5 mb-2 text-[var(--gold)]">Parts line items</h3>
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
                {partLines.map((li) => (
                  <tr key={li.id} className="border-b border-[var(--border)]/50">
                    <td className="py-1.5 pr-2 align-top">
                      <input
                        className="input text-sm py-1.5"
                        list={`parts-${li.id}`}
                        value={li.part_number}
                        onChange={(e) => {
                          const pn = e.target.value;
                          updatePartLine(li.id, { part_number: pn });
                          const hit = partsCatalog.find(
                            (p) =>
                              String(p.part_number || '').toLowerCase() ===
                              pn.trim().toLowerCase()
                          );
                          if (hit) {
                            updatePartLine(li.id, {
                              part_number: hit.part_number || pn,
                              description: hit.name || hit.description || li.description,
                            });
                          }
                        }}
                        placeholder="Part #"
                      />
                      <datalist id={`parts-${li.id}`}>
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
                        onChange={(e) => updatePartLine(li.id, { description: e.target.value })}
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
                          updatePartLine(li.id, { qty: parseFloat(e.target.value) || 0 })
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
                          updatePartLine(li.id, {
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
                          setPartLines((rows) =>
                            rows.length <= 1
                              ? [emptyLineItem('EP')]
                              : rows.filter((r) => r.id !== li.id)
                          )
                        }
                        title="Remove"
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
            onClick={() => setPartLines((r) => [...r, emptyLineItem('EP')])}
          >
            + Add part row
          </button>
          <p className="text-xs text-[var(--text3)] mt-2">
            Parts total: {money(totals.partsTotal)}
          </p>

          <div className="mt-4 p-3 rounded-xl border border-[var(--gold)] bg-[var(--gold)]/10">
            <label className="flex items-center gap-2 font-bold text-[var(--gold)] cursor-pointer">
              <input
                type="checkbox"
                checked={depositRequired}
                onChange={(e) => {
                  setDepositRequired(e.target.checked);
                  if (!e.target.checked) setDepositManual(false);
                }}
                className="accent-[var(--gold)] w-4 h-4"
              />
              Require parts / travel deposit on this estimate
            </label>
            {depositRequired && (
              <div className="mt-2">
                <label className="text-xs text-[var(--text3)]">Deposit amount ($)</label>
                <input
                  className="input mt-1 font-bold text-lg"
                  type="number"
                  step="0.01"
                  min={0}
                  value={deposit}
                  onChange={(e) => {
                    setDepositManual(true);
                    setDeposit(parseFloat(e.target.value) || 0);
                  }}
                />
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="text-[var(--text3)]">Labor</div>
            <div className="text-right font-semibold">{money(totals.labor)}</div>
            <div className="text-[var(--text3)]">Travel (mileage)</div>
            <div className="text-right font-semibold">{money(totals.mileage)}</div>
            <div className="text-[var(--text3)]">Reimbursements + per diem</div>
            <div className="text-right font-semibold">
              {money(totals.reimbTotal + totals.perDiem)}
            </div>
            <div className="text-[var(--text3)]">Parts</div>
            <div className="text-right font-semibold">{money(totals.partsTotal)}</div>
            <div className="text-[var(--text3)]">Subtotal</div>
            <div className="text-right font-semibold">{money(totals.subtotal)}</div>
            <div className="text-[var(--text3)]">Tax</div>
            <div className="text-right font-semibold">{money(totals.tax)}</div>
            <div className="font-bold text-[var(--gold)]">Total</div>
            <div className="text-right font-extrabold text-[var(--gold)] text-lg">
              {money(totals.grandTotal)}
            </div>
            {depositRequired && (
              <>
                <div className="text-[var(--text3)]">Deposit</div>
                <div className="text-right">{money(totals.depositAmt)}</div>
                <div className="font-semibold">Balance due</div>
                <div className="text-right font-bold">{money(totals.balanceDue)}</div>
              </>
            )}
          </div>
        </section>

        <div className="flex flex-wrap gap-2 sticky bottom-4 z-10">
          <Link href="/estimates" className="btn btn-secondary min-w-[80px] text-center">
            Cancel
          </Link>
          <button
            type="button"
            className="btn btn-secondary min-w-[100px]"
            disabled={saving || emailing}
            onClick={() => saveEstimate('draft')}
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            type="button"
            className="btn btn-primary min-w-[140px]"
            disabled={saving || emailing}
            onClick={() => finalizeAndEmailEstimate()}
          >
            {emailing ? 'Emailing…' : 'Finalize & Email'}
          </button>
          <button
            type="button"
            className="btn btn-secondary min-w-[100px] text-xs"
            disabled={saving || emailing}
            onClick={() => markSentWithoutEmail()}
            title="Sets status to sent without calling Resend"
          >
            Mark sent (no email)
          </button>
        </div>
        <p className="text-[10px] text-[var(--text3)] mt-2">
          Finalize &amp; Email only marks the estimate sent after Resend accepts the message.
          Requires customer email and a verified From domain.
        </p>

        {!isValidOrgId(userOrgId) && (
          <p className="text-xs text-amber-400 mt-4">
            No organization on your profile — estimate may save without org scope.
          </p>
        )}
      </div>
    </div>
  );
}
