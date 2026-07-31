'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  coerceOrgId,
  isValidOrgId,
  money,
  parseJsonField,
} from '@/lib/billing/save-helpers';

type InvFilter = 'all' | 'draft' | 'sent' | 'paid';

type InvoiceRow = {
  id: string | number;
  customer_name?: string | null;
  status?: string | null;
  total?: number | null;
  invoice_date?: string | null;
  created_at?: string | null;
  invoice_number?: string | null;
  invoice_data?: any;
  organization_id?: any;
  created_by?: string | null;
};

function statusBadgeClass(st: string): string {
  if (st === 'paid') return 'bg-green-900/40 text-green-200 border-green-700';
  if (st === 'draft') return 'bg-gray-700/40 text-gray-200 border-gray-600';
  if (st === 'sent') return 'bg-blue-900/40 text-blue-200 border-blue-700';
  return 'bg-[var(--surface2)] text-[var(--text2)] border-[var(--border2)]';
}

function docNumber(inv: InvoiceRow): string {
  const idata = parseJsonField(inv.invoice_data);
  return inv.invoice_number || idata.invoice_number || idata.invNumber || '';
}

export default function InvoicesListPage() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [filtered, setFiltered] = useState<InvoiceRow[]>([]);
  const [activeFilter, setActiveFilter] = useState<InvFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [rows, activeFilter, search]);

  async function init() {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      const orgId = coerceOrgId(profile?.organization_id);
      await loadInvoices(orgId, user.id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadInvoices(orgId: string | number | null, userId: string) {
    const list: InvoiceRow[] = [];
    const seen: Record<string, boolean> = {};
    const merge = (batch: any[] | null | undefined) => {
      (batch || []).forEach((r) => {
        if (!r || r.id == null) return;
        const k = String(r.id);
        if (seen[k]) return;
        seen[k] = true;
        list.push(r as InvoiceRow);
      });
    };

    if (isValidOrgId(orgId)) {
      const q1 = await supabase
        .from('service_invoices')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(150);
      if (q1.error) console.warn('invoices org load', q1.error);
      merge(q1.data);
    }

    const q2 = await supabase
      .from('service_invoices')
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (q2.error) console.warn('invoices mine load', q2.error);
    merge(q2.data);

    if (isValidOrgId(orgId)) {
      for (const r of list) {
        if (r.created_by === userId && (r.organization_id == null || r.organization_id === '')) {
          supabase
            .from('service_invoices')
            .update({ organization_id: orgId })
            .eq('id', r.id)
            .then(() => {});
        }
      }
    }

    list.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
    setRows(list);
  }

  function applyFilters() {
    let res = [...rows];
    if (activeFilter !== 'all') {
      res = res.filter((e) => (e.status || '').toLowerCase() === activeFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      res = res.filter((e) => {
        const hay = [e.customer_name, docNumber(e), e.status, String(e.total ?? '')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    setFiltered(res);
  }

  const drafts = rows.filter((r) => (r.status || '').toLowerCase() === 'draft').length;
  const sent = rows.filter((r) => (r.status || '').toLowerCase() === 'sent').length;
  const paid = rows.filter((r) => (r.status || '').toLowerCase() === 'paid').length;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="page max-w-7xl mx-auto w-full px-4 py-6 pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-extrabold">🧾 Invoices</h1>
            <p className="text-[var(--text3)] text-sm">Billing &amp; collections</p>
          </div>
          <Link href="/invoices/new" className="btn btn-primary hidden sm:flex items-center gap-2">
            <Plus size={18} /> New Invoice
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-[var(--gold)]">{drafts}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              DRAFTS
            </div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-blue-300">{sent}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              SENT
            </div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-[var(--green)]">{paid}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              PAID
            </div>
          </div>
        </div>

        <div className="mb-4">
          <input
            className="input"
            placeholder="Search customer, invoice #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {(
            [
              ['all', 'All'],
              ['draft', 'Drafts'],
              ['sent', 'Sent'],
              ['paid', 'Paid'],
            ] as [InvFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`filter-chip ${activeFilter === key ? 'active' : ''}`}
              onClick={() => setActiveFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="animate-spin h-6 w-6 border-2 border-[var(--gold)] border-t-transparent rounded-full mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state card p-8 text-center">
            <div className="text-4xl mb-3">🧾</div>
            <div className="font-semibold">No invoices yet</div>
            <p className="text-sm mt-1 text-[var(--text3)]">
              Create an invoice or convert from an estimate.
            </p>
            <Link href="/invoices/new" className="btn btn-primary mt-4 inline-flex">
              + New Invoice
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((inv) => {
              const st = String(inv.status || 'draft').toLowerCase();
              const num = docNumber(inv);
              const dateStr = inv.invoice_date
                ? new Date(inv.invoice_date + 'T00:00:00').toLocaleDateString()
                : inv.created_at
                  ? new Date(inv.created_at).toLocaleDateString()
                  : '—';
              return (
                <Link
                  key={String(inv.id)}
                  href={`/invoices/new?id=${inv.id}`}
                  className="card p-4 flex items-center justify-between gap-3 hover:border-[var(--gold-border)] block"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base truncate">
                      {inv.customer_name || 'Unknown Customer'}
                    </div>
                    <div className="text-xs text-[var(--text3)] mt-1 flex flex-wrap gap-x-2 gap-y-1 items-center">
                      {num && <span className="text-[var(--gold)] font-bold">{num}</span>}
                      <span>{dateStr}</span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass(
                          st
                        )}`}
                      >
                        {st.charAt(0).toUpperCase() + st.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="font-bold text-[var(--gold)] text-lg flex-shrink-0">
                    {money(Number(inv.total) || 0)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <Link href="/invoices/new" className="fab sm:hidden" title="New Invoice">
        <Plus size={28} />
      </Link>
    </div>
  );
}
