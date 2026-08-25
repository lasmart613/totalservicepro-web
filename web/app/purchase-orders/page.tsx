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

type PoFilter = 'all' | 'draft' | 'sent';

type PoRow = {
  id: string | number;
  supplier_name?: string | null;
  supplier_email?: string | null;
  status?: string | null;
  total?: number | null;
  po_date?: string | null;
  created_at?: string | null;
  po_number?: string | null;
  po_data?: any;
  organization_id?: any;
};

function statusBadgeClass(st: string): string {
  if (st === 'draft') return 'bg-gray-700/40 text-gray-200 border-gray-600';
  if (st === 'sent') return 'bg-blue-900/40 text-blue-200 border-blue-700';
  return 'bg-[var(--surface2)] text-[var(--text2)] border-[var(--border2)]';
}

function docNumber(row: PoRow): string {
  const data = parseJsonField(row.po_data);
  return row.po_number || data.po_number || data.poNumber || '';
}

export default function PurchaseOrdersListPage() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [rows, setRows] = useState<PoRow[]>([]);
  const [filtered, setFiltered] = useState<PoRow[]>([]);
  const [activeFilter, setActiveFilter] = useState<PoFilter>('all');
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
      if (!isValidOrgId(orgId)) {
        setRows([]);
        return;
      }
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) console.warn('purchase_orders load', error);
      setRows((data || []) as PoRow[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    let res = [...rows];
    if (activeFilter !== 'all') {
      res = res.filter((e) => (e.status || '').toLowerCase() === activeFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      res = res.filter((e) => {
        const hay = [e.supplier_name, e.supplier_email, docNumber(e), e.status, String(e.total ?? '')]
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="page max-w-7xl mx-auto w-full px-4 py-6 pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-extrabold">📦 Purchase Orders</h1>
            <p className="text-[var(--text3)] text-sm">
              Send POs to parts suppliers. Only your company can see these.
            </p>
          </div>
          <Link href="/purchase-orders/new" className="btn btn-primary hidden sm:flex items-center gap-2">
            <Plus size={18} /> New PO
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-[var(--gold)]">{loading ? '—' : drafts}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">DRAFTS</div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-blue-300">{loading ? '—' : sent}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">SENT</div>
          </div>
        </div>

        <div className="mb-4">
          <input
            className="input"
            placeholder="Search supplier, PO #..."
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
            ] as [PoFilter, string][]
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
            <div className="text-4xl mb-3">📦</div>
            <div className="font-semibold">No purchase orders yet</div>
            <p className="text-sm mt-1 text-[var(--text3)]">
              Pick a parts supplier and email a PO to the address on their profile.
            </p>
            <Link href="/purchase-orders/new" className="btn btn-primary mt-4 inline-flex">
              + New Purchase Order
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((row) => {
              const st = String(row.status || 'draft').toLowerCase();
              const num = docNumber(row);
              const dateStr = row.po_date
                ? new Date(row.po_date + 'T00:00:00').toLocaleDateString()
                : row.created_at
                  ? new Date(row.created_at).toLocaleDateString()
                  : '—';
              return (
                <Link
                  key={String(row.id)}
                  href={`/purchase-orders/new?id=${row.id}`}
                  className="card p-4 flex items-center justify-between gap-3 hover:border-[var(--gold-border)] block"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base truncate">
                      {row.supplier_name || 'Parts supplier'}
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
                    {money(Number(row.total) || 0)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <Link
          href="/purchase-orders/new"
          className="sm:hidden fixed bottom-5 right-5 btn btn-primary rounded-full shadow-lg"
        >
          + New PO
        </Link>
      </div>
    </div>
  );
}
