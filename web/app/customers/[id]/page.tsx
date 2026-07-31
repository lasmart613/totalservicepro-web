'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  isOwnerish,
  isServiceCompany,
  isSupplier,
} from '@/lib/roles';
import { ownerOrgTypeLabel } from '@/lib/org-types';
import { toast } from 'sonner';

type TabKey = 'overview' | 'equipment' | 'history' | 'contacts';

type CustomerOrg = {
  id: number | string;
  name?: string | null;
  type?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  biz_type?: string | null;
  facility_type?: string | null;
  contact_name?: string | null;
  specialties?: string[] | null;
  laser_models?: string | null;
  logo_url?: string | null;
};

type EquipmentRow = {
  id: number | string;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  status?: string | null;
  equipment_type?: string | null;
  name?: string | null;
  notes?: string | null;
  next_pm_due?: string | null;
  customer_organization_id?: number | string | null;
  organization_id?: number | string | null;
};

type ReportRow = {
  id: string;
  report_number?: string | null;
  service_type?: string | null;
  status?: string | null;
  date_out?: string | null;
  created_at?: string | null;
  equipment_name?: string | null;
  model_type?: string | null;
  serial_number?: string | null;
  service_engineer?: string | null;
  customer_name?: string | null;
};

type ContactRow = {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean | null;
};

const BIZ_TYPES = [
  'Medical Spa',
  'Dermatology Clinic',
  'Plastic Surgery Center',
  'Hair Removal Clinic',
  'Cosmetic Surgery Center',
  'Wellness Center',
  'Hospital / Health System',
  'Other',
];

const ALL_SPECIALTIES = [
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
];

const BRAND_ICONS: Record<string, string> = {
  Lumenis: '🔬',
  Candela: '⚡',
  Cynosure: '💡',
  Cutera: '🌟',
  'Solta Medical': '✨',
};

function initials(name?: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v).slice(0, 10);
  }
}

function statusClass(status?: string | null): string {
  const s = (status || '').toLowerCase();
  if (s === 'complete' || s === 'completed') return 'bg-green-500/15 text-green-400 border-green-500/30';
  if (s === 'draft') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (s === 'scheduled' || s === 'open') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
  return 'bg-[var(--surface2)] text-[var(--text3)] border-[var(--border)]';
}

export default function CustomerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) || '';
  const supabase = getSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [notLinked, setNotLinked] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [serviceOrgId, setServiceOrgId] = useState<string | number | null>(null);
  const [userOrgType, setUserOrgType] = useState<string | null>(null);

  const [customer, setCustomer] = useState<CustomerOrg | null>(null);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [tab, setTab] = useState<TabKey>('overview');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Editable form
  const [form, setForm] = useState({
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
    specialties: [] as string[],
  });

  const setField = useCallback((key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const toggleSpecialty = useCallback((spec: string) => {
    setForm((prev) => {
      const has = prev.specialties.includes(spec);
      return {
        ...prev,
        specialties: has
          ? prev.specialties.filter((s) => s !== spec)
          : [...prev.specialties, spec],
      };
    });
    setDirty(true);
  }, []);

  useEffect(() => {
    if (id) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadAll() {
    setLoading(true);
    setAccessDenied(false);
    setNotLinked(false);
    setNotFound(false);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .maybeSingle();

      if (!prof?.organization_id) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const myOrgId = prof.organization_id;
      setServiceOrgId(myOrgId);

      const { data: myOrg } = await supabase
        .from('organizations')
        .select('type, name')
        .eq('id', myOrgId)
        .maybeSingle();

      const orgType = myOrg?.type || '';
      setUserOrgType(orgType);
      const role = prof.role || '';

      // CRM: service companies (full), suppliers (view). Owners denied.
      if (isOwnerish(role, orgType)) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const allowed =
        isServiceCompany(role, orgType) ||
        isSupplier(role, orgType) ||
        orgType === 'service_company' ||
        orgType === 'parts_supplier';

      if (!allowed) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      // Service company staff can edit; suppliers view-only
      const editAllowed =
        isServiceCompany(role, orgType) ||
        (orgType === 'service_company' && !isSupplier(role, orgType));
      setCanEdit(!!editAllowed);

      // Must be linked via organization_customers
      const { data: link, error: linkErr } = await supabase
        .from('organization_customers')
        .select('customer_organization_id')
        .eq('service_organization_id', myOrgId)
        .eq('customer_organization_id', id)
        .maybeSingle();

      if (linkErr) {
        console.warn('org link check failed', linkErr);
      }
      if (!link) {
        setNotLinked(true);
        setLoading(false);
        return;
      }

      // Load customer org — prefer * then fall back if RLS/schema issues
      let org: CustomerOrg | null = null;
      {
        const { data, error } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (error) {
          console.warn('customer load * failed', error);
          const slim = await supabase
            .from('organizations')
            .select(
              'id, name, type, address, city, state, zip, phone, email, website, notes, biz_type, facility_type, specialties, laser_models, logo_url'
            )
            .eq('id', id)
            .maybeSingle();
          org = (slim.data as CustomerOrg) || null;
        } else {
          org = (data as CustomerOrg) || null;
        }
      }

      if (!org) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setCustomer(org);
      setForm({
        name: org.name || '',
        biz_type: org.biz_type || org.facility_type || '',
        website: org.website || '',
        notes: org.notes || '',
        phone: org.phone || '',
        email: org.email || '',
        address: org.address || '',
        city: org.city || '',
        state: org.state || '',
        zip: org.zip || '',
        contact_name: (org as any).contact_name || '',
        specialties: Array.isArray(org.specialties) ? org.specialties : [],
      });
      setDirty(false);

      await Promise.all([
        loadEquipment(id),
        loadReports(id, org.name || '', myOrgId),
        loadContacts(id),
      ]);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }

  async function loadEquipment(customerId: string) {
    // Prefer customer_organization_id (web / My Lasers); fallback organization_id (Android legacy)
    try {
      const { data, error } = await supabase
        .from('equipment')
        .select('*')
        .eq('customer_organization_id', customerId)
        .order('manufacturer', { ascending: true })
        .limit(200);

      if (!error && data && data.length > 0) {
        setEquipment(data as EquipmentRow[]);
        return;
      }

      // Fallback: organization_id
      const r2 = await supabase
        .from('equipment')
        .select('*')
        .eq('organization_id', customerId)
        .order('manufacturer', { ascending: true })
        .limit(200);

      if (!r2.error && r2.data) {
        setEquipment(r2.data as EquipmentRow[]);
        return;
      }

      // If first query succeeded empty, keep empty
      if (!error) {
        setEquipment([]);
        return;
      }

      // Minimal select if * fails
      const r3 = await supabase
        .from('equipment')
        .select('id, manufacturer, model, serial_number, notes, customer_organization_id')
        .eq('customer_organization_id', customerId)
        .limit(200);
      setEquipment((r3.data as EquipmentRow[]) || []);
    } catch (e) {
      console.warn('equipment load failed', e);
      setEquipment([]);
    }
  }

  async function loadReports(
    customerId: string,
    customerName: string,
    serviceOrgIdVal: string | number
  ) {
    try {
      const selectCols =
        'id, report_number, service_type, status, date_out, created_at, equipment_name, model_type, serial_number, service_engineer, customer_name, customer_organization_id, equipment_id';
      const merged: ReportRow[] = [];
      const seen: Record<string, boolean> = {};
      const push = (rows: any[] | null | undefined) => {
        (rows || []).forEach((r) => {
          if (!r?.id || seen[String(r.id)]) return;
          seen[String(r.id)] = true;
          merged.push(r as ReportRow);
        });
      };

      // Primary: customer_organization_id
      const { data } = await supabase
        .from('service_reports')
        .select(selectCols)
        .eq('customer_organization_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50);
      push(data);

      // Also: reports for lasers currently on this customer's equipment roster
      // (serial / equipment_id) so history follows transferred systems
      try {
        const { data: eqList } = await supabase
          .from('equipment')
          .select('id, serial_number')
          .eq('customer_organization_id', customerId)
          .limit(100);
        for (const eq of eqList || []) {
          if (eq.id) {
            const rEq = await supabase
              .from('service_reports')
              .select(selectCols)
              .eq('equipment_id', eq.id)
              .order('created_at', { ascending: false })
              .limit(20);
            push(rEq.data);
          }
          if (eq.serial_number) {
            const rSn = await supabase
              .from('service_reports')
              .select(selectCols)
              .ilike('serial_number', eq.serial_number)
              .order('created_at', { ascending: false })
              .limit(20);
            push(rSn.data);
          }
        }
      } catch {
        /* equipment history merge non-fatal */
      }

      // Fallback: service org's reports matching customer name
      if (merged.length === 0 && customerName) {
        const r2 = await supabase
          .from('service_reports')
          .select(selectCols)
          .eq('organization_id', serviceOrgIdVal)
          .ilike('customer_name', customerName)
          .order('created_at', { ascending: false })
          .limit(50);
        push(r2.data);
      }

      merged.sort(
        (a, b) =>
          new Date(b.date_out || b.created_at || 0).getTime() -
          new Date(a.date_out || a.created_at || 0).getTime()
      );
      setReports(merged.slice(0, 80));
    } catch (e) {
      console.warn('reports load failed', e);
      setReports([]);
    }
  }

  async function loadContacts(customerId: string) {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, title, phone, email, is_primary')
        .eq('organization_id', customerId)
        .order('first_name', { ascending: true })
        .limit(50);
      if (error) {
        // Table missing / RLS — silent empty
        setContacts([]);
        return;
      }
      setContacts((data as ContactRow[]) || []);
    } catch {
      setContacts([]);
    }
  }

  async function saveCustomer() {
    if (!canEdit || !customer?.id) return;
    if (!form.name.trim()) {
      toast.error('Business name is required');
      return;
    }
    setSaving(true);
    try {
      const base: Record<string, any> = {
        name: form.name.trim(),
        website: form.website.trim() || null,
        notes: form.notes.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        updated_at: new Date().toISOString(),
      };

      // Optional columns — strip if PostgREST says missing
      const optional: Record<string, any> = {
        biz_type: form.biz_type || null,
        facility_type: form.biz_type || null,
        specialties: form.specialties,
        contact_name: form.contact_name.trim() || null,
      };

      let payload = { ...base, ...optional };
      let lastError: any = null;

      for (let attempt = 0; attempt < 8; attempt++) {
        const { error } = await supabase
          .from('organizations')
          .update(payload)
          .eq('id', customer.id);
        if (!error) {
          lastError = null;
          break;
        }
        lastError = error;
        const m = String(error.message || '');
        const col = m.match(/Could not find the '([^']+)' column/i)?.[1];
        if (col && col in payload) {
          delete payload[col];
          continue;
        }
        // RLS / other errors — stop
        break;
      }

      if (lastError) throw lastError;

      setCustomer((prev) =>
        prev
          ? {
              ...prev,
              ...payload,
              name: form.name.trim(),
            }
          : prev
      );
      setDirty(false);
      toast.success('Customer profile saved');
    } catch (e: any) {
      console.error(e);
      toast.error('Save failed: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function removeFromMyCustomers() {
    if (!serviceOrgId || !customer?.id) return;
    if (
      !confirm(
        `Remove "${form.name || customer.name || 'this customer'}" from your customer list?\n\nUnlinks from your CRM only. Service history is kept.`
      )
    ) {
      return;
    }
    try {
      const { error } = await supabase
        .from('organization_customers')
        .delete()
        .eq('service_organization_id', serviceOrgId)
        .eq('customer_organization_id', customer.id);
      if (error) throw error;
      toast.success('Removed from your list');
      router.push('/customers');
    } catch (e: any) {
      toast.error('Remove failed: ' + (e?.message || e));
    }
  }

  const heroType = useMemo(() => {
    if (form.biz_type) return form.biz_type;
    if (customer?.facility_type) return customer.facility_type;
    return ownerOrgTypeLabel(customer?.type) || 'Customer';
  }, [form.biz_type, customer]);

  const primaryContactLabel = useMemo(() => {
    if (form.contact_name) return form.contact_name;
    const primary = contacts.find((c) => c.is_primary) || contacts[0];
    if (primary) {
      return [primary.first_name, primary.last_name].filter(Boolean).join(' ');
    }
    return '';
  }, [form.contact_name, contacts]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
          Loading customer…
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-2xl mx-auto w-full px-4 py-8">
          <h1 className="text-2xl font-extrabold mb-2">👥 Customer Profile</h1>
          <div className="card p-8 text-center">
            <div className="text-5xl mb-4">🔒</div>
            <div className="font-bold text-xl mb-3">Access Restricted</div>
            <p className="text-[var(--text3)]">
              Customer CRM is available for <strong>Service Companies</strong>
              {userOrgType === 'parts_supplier' ? '' : ' and Parts Suppliers'}.
              Facility owners manage their own profile under Company / My Lasers.
            </p>
            <Link href="/" className="btn btn-primary mt-6 inline-block">
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (notLinked || notFound) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-xl mx-auto w-full px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-3">
            {notFound ? 'Customer not found' : 'Customer not in your directory'}
          </h1>
          <p className="text-[var(--text3)] text-sm mb-6">
            {notFound
              ? 'This organization could not be loaded.'
              : 'This customer is not linked to your organization via organization_customers.'}
          </p>
          <Link href="/customers" className="btn btn-primary">
            ← Back to Customers
          </Link>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-xl mx-auto px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">Customer not found</h1>
          <Link href="/customers" className="btn btn-primary">
            Back to Customers
          </Link>
        </div>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'equipment', label: `Equipment (${equipment.length})` },
    { key: 'history', label: `History (${reports.length})` },
    { key: 'contacts', label: `Contacts (${contacts.length})` },
  ];

  return (
    <div className="min-h-screen flex flex-col pb-24">
      <Header />

      <div className="max-w-4xl mx-auto w-full px-4 py-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <Link href="/customers" className="text-sm text-[var(--gold)] hover:underline">
            ← Customers
          </Link>
          {canEdit && (
            <button
              type="button"
              className="btn btn-primary text-sm"
              disabled={saving || !dirty}
              onClick={saveCustomer}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>

        {/* Hero */}
        <div
          className="card p-5 mb-4"
          style={{
            background:
              'linear-gradient(135deg, #1a1500 0%, var(--surface) 100%)',
          }}
        >
          <div className="flex items-start gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center font-extrabold text-xl shrink-0 border-2"
              style={{
                background: 'var(--gold)',
                color: '#111',
                borderColor: 'var(--gold)',
              }}
            >
              {customer.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={customer.logo_url}
                  alt=""
                  className="w-full h-full object-cover rounded-2xl"
                />
              ) : (
                initials(form.name || customer.name)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-extrabold truncate">
                {form.name || customer.name || 'Customer'}
              </h1>
              <div className="text-sm text-[var(--gold)] mt-0.5">{heroType}</div>
              <div className="text-sm text-[var(--text3)] mt-2 space-y-0.5">
                {(form.address || form.city || form.state) && (
                  <div>
                    {[form.address, [form.city, form.state].filter(Boolean).join(', '), form.zip]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
                {form.phone && <div>📞 {form.phone}</div>}
                {form.email && <div>✉️ {form.email}</div>}
                {form.website && (
                  <div>
                    🌐{' '}
                    <a
                      href={
                        form.website.startsWith('http')
                          ? form.website
                          : `https://${form.website}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--gold)] hover:underline"
                    >
                      {form.website}
                    </a>
                  </div>
                )}
                {primaryContactLabel && (
                  <div>👤 {primaryContactLabel}</div>
                )}
              </div>
              <div className="flex gap-6 mt-4">
                <div>
                  <div className="text-lg font-extrabold text-[var(--gold)]">
                    {equipment.length}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">
                    Equipment
                  </div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-[var(--gold)]">
                    {reports.length}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">
                    Reports
                  </div>
                </div>
                <div>
                  <div className="text-lg font-extrabold text-[var(--gold)]">
                    {contacts.length}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">
                    Contacts
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto mb-4 border-b border-[var(--border)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                tab === t.key
                  ? 'text-[var(--gold)] border-[var(--gold)]'
                  : 'text-[var(--text3)] border-transparent hover:text-[var(--text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="section">
              <div className="flex items-center gap-2 mb-3">
                <span>🏥</span>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
                  Business Info
                </h2>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                    Business Name *
                  </label>
                  <input
                    className="input w-full"
                    value={form.name}
                    disabled={!canEdit}
                    onChange={(e) => setField('name', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                      Business Type
                    </label>
                    <select
                      className="input w-full"
                      value={form.biz_type}
                      disabled={!canEdit}
                      onChange={(e) => setField('biz_type', e.target.value)}
                    >
                      <option value="">Select…</option>
                      {BIZ_TYPES.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                      Website
                    </label>
                    <input
                      className="input w-full"
                      type="url"
                      placeholder="https://"
                      value={form.website}
                      disabled={!canEdit}
                      onChange={(e) => setField('website', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                    Notes
                  </label>
                  <textarea
                    className="input w-full min-h-[80px]"
                    placeholder="Account notes, preferences, access details…"
                    value={form.notes}
                    disabled={!canEdit}
                    onChange={(e) => setField('notes', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="section">
              <div className="flex items-center gap-2 mb-3">
                <span>📞</span>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
                  Contact Info
                </h2>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                      Phone
                    </label>
                    <input
                      className="input w-full"
                      type="tel"
                      value={form.phone}
                      disabled={!canEdit}
                      onChange={(e) => setField('phone', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                      Email
                    </label>
                    <input
                      className="input w-full"
                      type="email"
                      value={form.email}
                      disabled={!canEdit}
                      onChange={(e) => setField('email', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                    Contact Name
                  </label>
                  <input
                    className="input w-full"
                    value={form.contact_name}
                    disabled={!canEdit}
                    placeholder="Primary contact person"
                    onChange={(e) => setField('contact_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                    Address
                  </label>
                  <input
                    className="input w-full"
                    value={form.address}
                    disabled={!canEdit}
                    onChange={(e) => setField('address', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                      City
                    </label>
                    <input
                      className="input w-full"
                      value={form.city}
                      disabled={!canEdit}
                      onChange={(e) => setField('city', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                      State
                    </label>
                    <input
                      className="input w-full"
                      maxLength={2}
                      value={form.state}
                      disabled={!canEdit}
                      onChange={(e) => setField('state', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                      ZIP
                    </label>
                    <input
                      className="input w-full"
                      maxLength={10}
                      value={form.zip}
                      disabled={!canEdit}
                      onChange={(e) => setField('zip', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="section">
              <div className="flex items-center gap-2 mb-3">
                <span>💉</span>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
                  Specialties
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {ALL_SPECIALTIES.map((spec) => {
                  const active = form.specialties.includes(spec);
                  return (
                    <button
                      key={spec}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => toggleSpecialty(spec)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                        active
                          ? 'border-[var(--gold)] bg-[var(--gold-glow)] text-[var(--gold)] font-semibold'
                          : 'border-[var(--border)] text-[var(--text3)] bg-[var(--surface2)]'
                      } ${!canEdit ? 'opacity-70 cursor-default' : 'cursor-pointer'}`}
                    >
                      {spec}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--text3)] mt-2">
                Treatments this facility offers.
              </p>
            </div>

            {canEdit && (
              <div className="pt-2">
                <button
                  type="button"
                  className="w-full py-3 rounded-xl border border-red-500/40 text-red-400 font-bold text-sm hover:bg-red-500/10"
                  onClick={removeFromMyCustomers}
                >
                  Remove from my customers
                </button>
              </div>
            )}
          </div>
        )}

        {/* Equipment */}
        {tab === 'equipment' && (
          <div className="section">
            <div className="flex items-center gap-2 mb-3">
              <span>🔬</span>
              <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)] flex-1">
                Equipment Inventory
              </h2>
            </div>
            {equipment.length === 0 ? (
              <p className="text-sm text-[var(--text3)] py-2">
                No equipment on record for this customer.
              </p>
            ) : (
              <div className="space-y-2">
                {equipment.map((eq) => {
                  const histCount = reports.filter(
                    (r) =>
                      (eq.id != null && String((r as any).equipment_id) === String(eq.id)) ||
                      (eq.serial_number &&
                        r.serial_number &&
                        String(r.serial_number).toLowerCase() ===
                          String(eq.serial_number).toLowerCase())
                  ).length;
                  return (
                  <div
                    key={eq.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface2)] border border-[var(--border)]"
                  >
                    <div className="text-xl w-9 text-center shrink-0">
                      {BRAND_ICONS[eq.manufacturer || ''] || '⚙️'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">
                        {[eq.manufacturer, eq.model || eq.name].filter(Boolean).join(' ') ||
                          'Equipment'}
                      </div>
                      <div className="text-xs text-[var(--text3)] mt-0.5">
                        SN: {eq.serial_number || 'N/A'}
                        {eq.equipment_type ? ` · ${eq.equipment_type}` : ''}
                        {histCount > 0 ? ` · ${histCount} report${histCount === 1 ? '' : 's'}` : ''}
                      </div>
                      {eq.next_pm_due && (
                        <div className="text-xs text-amber-400 mt-0.5">
                          PM due: {fmtDate(eq.next_pm_due)}
                        </div>
                      )}
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-1 rounded-full border shrink-0 ${statusClass(
                        eq.status || 'active'
                      )}`}
                    >
                      {eq.status || 'Active'}
                    </span>
                  </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-[var(--text3)] mt-3">
              Add equipment via Service Report or the facility&apos;s My Lasers.
            </p>
          </div>
        )}

        {/* Service History */}
        {tab === 'history' && (
          <div className="section">
            <div className="flex items-center gap-2 mb-3">
              <span>📋</span>
              <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
                Service History
              </h2>
            </div>
            <p className="text-xs text-[var(--text3)] mb-3">
              Includes reports for this customer org and for lasers on their equipment list (by
              serial / equipment ID), so history stays with the laser when ownership changes.
            </p>
            {reports.length === 0 ? (
              <p className="text-sm text-[var(--text3)] py-2">
                No service reports yet for this customer.
              </p>
            ) : (
              <div className="space-y-2">
                {reports.map((r) => (
                  <Link
                    key={r.id}
                    href={`/reports/${r.id}`}
                    className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface2)] border border-[var(--border)] hover:border-[var(--gold-border)] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-[var(--gold)]">
                        {r.report_number || `Report ${String(r.id).slice(0, 8)}`}
                      </div>
                      <div className="font-semibold text-sm truncate">
                        {r.service_type || 'Service'}
                        {r.equipment_name || r.model_type
                          ? ` · ${r.equipment_name || r.model_type}`
                          : ''}
                      </div>
                      <div className="text-xs text-[var(--text3)] mt-0.5">
                        {fmtDate(r.date_out || r.created_at)}
                        {r.serial_number ? ` · SN ${r.serial_number}` : ''}
                        {r.service_engineer ? ` · ${r.service_engineer}` : ''}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-1 rounded-full border shrink-0 ${statusClass(
                        r.status
                      )}`}
                    >
                      {r.status || '—'}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-4">
              <Link
                href={`/reports/new?customer_id=${customer.id}`}
                className="btn btn-secondary text-sm inline-block"
              >
                + New Service Report
              </Link>
            </div>
          </div>
        )}

        {/* Contacts */}
        {tab === 'contacts' && (
          <div className="section">
            <div className="flex items-center gap-2 mb-3">
              <span>👥</span>
              <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
                Contacts
              </h2>
            </div>
            {form.contact_name && contacts.length === 0 && (
              <div className="flex items-center gap-3 py-3 border-b border-[var(--border)]">
                <div className="w-9 h-9 rounded-full bg-[var(--surface3)] flex items-center justify-center text-xs font-bold text-[var(--text3)]">
                  {initials(form.contact_name)}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">{form.contact_name}</div>
                  <div className="text-xs text-[var(--text3)]">Primary (from profile)</div>
                </div>
                <div className="flex gap-2">
                  {form.phone && (
                    <a
                      href={`tel:${form.phone}`}
                      className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-sm hover:border-[var(--gold)]"
                      title="Call"
                    >
                      📞
                    </a>
                  )}
                  {form.email && (
                    <a
                      href={`mailto:${form.email}`}
                      className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-sm hover:border-[var(--gold)]"
                      title="Email"
                    >
                      ✉️
                    </a>
                  )}
                </div>
              </div>
            )}
            {contacts.length === 0 && !form.contact_name ? (
              <p className="text-sm text-[var(--text3)] py-2">
                No contacts on record. Add a contact name under Overview, or contacts will appear when available in the database.
              </p>
            ) : (
              contacts.map((c) => {
                const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 py-3 border-b border-[var(--border)] last:border-0"
                  >
                    <div className="w-9 h-9 rounded-full bg-[var(--surface3)] flex items-center justify-center text-xs font-bold text-[var(--text3)]">
                      {initials(name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">
                        {name || 'Contact'}
                        {c.is_primary ? ' ⭐' : ''}
                      </div>
                      <div className="text-xs text-[var(--text3)]">
                        {[c.title, c.phone].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-sm hover:border-[var(--gold)]"
                          title="Call"
                        >
                          📞
                        </a>
                      )}
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-sm hover:border-[var(--gold)]"
                          title="Email"
                        >
                          ✉️
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Sticky save bar when dirty */}
      {canEdit && dirty && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="max-w-4xl mx-auto flex gap-2">
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={saving}
              onClick={saveCustomer}
            >
              {saving ? 'Saving…' : 'Save Customer Profile'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
