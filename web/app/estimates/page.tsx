'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  coerceOrgId,
  customerActionFromEstimate,
  customerActionLabel,
  isEstimateExpired,
  isValidOrgId,
  money,
  parseJsonField,
  validUntilLabel,
} from '@/lib/billing/save-helpers';

type EstFilter = 'active' | 'draft' | 'pending' | 'invoiced' | 'expired' | 'all';

type EstimateRow = {
  id: string | number;
  customer_name?: string | null;
  status?: string | null;
  total?: number | null;
  created_at?: string | null;
  estimate_number?: string | null;
  estimate_data?: any;
  organization_id?: any;
  created_by?: string | null;
  device_model?: string | null;
  customer_action?: string | null;
  customer_action_at?: string | null;
  customer_action_note?: string | null;
  customer_action_token?: string | null;
};

function statusBadgeClass(st: string): string {
  if (st === 'draft') return 'bg-gray-700/40 text-gray-200 border-gray-600';
  if (st === 'pending' || st === 'sent') return 'bg-blue-900/40 text-blue-200 border-blue-700';
  if (st === 'invoiced' || st === 'completed') return 'bg-purple-900/40 text-purple-200 border-purple-700';
  if (st === 'expired') return 'bg-red-900/40 text-red-200 border-red-700';
  return 'bg-[var(--surface2)] text-[var(--text2)] border-[var(--border2)]';
}

function effectiveStatus(est: EstimateRow): string {
  let st = String(est.status || 'draft').toLowerCase();
  if (isEstimateExpired(est) && st !== 'invoiced' && st !== 'cancelled' && st !== 'completed') {
    st = 'expired';
  }
  return st;
}

function docNumber(est: EstimateRow): string {
  const ed = parseJsonField(est.estimate_data);
  return est.estimate_number || ed.estimate_number || ed.estNumber || '';
}

export default function EstimatesListPage() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [filtered, setFiltered] = useState<EstimateRow[]>([]);
  const [activeFilter, setActiveFilter] = useState<EstFilter>('active');
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
      await loadEstimates(orgId, user.id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadEstimates(orgId: string | number | null, userId: string) {
    const list: EstimateRow[] = [];
    const seen: Record<string, boolean> = {};
    const merge = (batch: any[] | null | undefined) => {
      (batch || []).forEach((r) => {
        if (!r || r.id == null) return;
        const k = String(r.id);
        if (seen[k]) return;
        seen[k] = true;
        list.push(r as EstimateRow);
      });
    };

    if (isValidOrgId(orgId)) {
      const q1 = await supabase
        .from('service_estimates')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(150);
      if (q1.error) console.warn('estimates org load', q1.error);
      merge(q1.data);
    }

    const q2 = await supabase
      .from('service_estimates')
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (q2.error) console.warn('estimates mine load', q2.error);
    merge(q2.data);

    // Soft-expire stale open estimates (Android parity — permanent audit trail)
    for (const est of list) {
      const st = String(est.status || 'draft').toLowerCase();
      if (['expired', 'invoiced', 'cancelled', 'completed'].includes(st)) continue;
      if (isEstimateExpired(est)) {
        try {
          await supabase.from('service_estimates').update({ status: 'expired' }).eq('id', est.id);
          est.status = 'expired';
        } catch {
          /* non-fatal */
        }
      }
    }

    // Backfill missing organization_id on mine rows
    if (isValidOrgId(orgId)) {
      for (const r of list) {
        if (r.created_by === userId && (r.organization_id == null || r.organization_id === '')) {
          supabase
            .from('service_estimates')
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
    if (activeFilter === 'active') {
      res = res.filter((e) => {
        const st = String(e.status || '').toLowerCase();
        if (st === 'expired') return false;
        if (st === 'invoiced' || st === 'completed' || st === 'cancelled') return true;
        return !isEstimateExpired(e);
      });
    } else if (activeFilter === 'expired') {
      res = res.filter((e) => isEstimateExpired(e));
    } else if (activeFilter === 'all') {
      // keep all
    } else if (activeFilter === 'pending') {
      res = res.filter((e) => {
        const st = String(e.status || '').toLowerCase();
        return st === 'pending' || st === 'sent';
      });
    } else {
      res = res.filter((e) => {
        const st = String(e.status || '').toLowerCase();
        if (activeFilter === 'draft' && isEstimateExpired(e) && st !== 'invoiced') return false;
        return st === activeFilter;
      });
    }

    const q = search.trim().toLowerCase();
    if (q) {
      res = res.filter((e) => {
        const hay = [
          e.customer_name,
          e.device_model,
          docNumber(e),
          e.status,
          String(e.total ?? ''),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    setFiltered(res);
  }

  const drafts = rows.filter((r) => effectiveStatus(r) === 'draft').length;
  const sent = rows.filter((r) => {
    const s = effectiveStatus(r);
    return s === 'pending' || s === 'sent';
  }).length;
  const invoiced = rows.filter((r) => effectiveStatus(r) === 'invoiced').length;
  const expired = rows.filter((r) => isEstimateExpired(r)).length;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="page max-w-7xl mx-auto w-full px-4 py-6 pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-extrabold">📝 Estimates</h1>
            <p className="text-[var(--text3)] text-sm">Quotes &amp; service estimates</p>
          </div>
          <Link href="/estimates/new" className="btn btn-primary hidden sm:flex items-center gap-2">
            <Plus size={18} /> New Estimate
          </Link>
        </div>

        <div className="note-30 text-xs text-[var(--text3)] bg-[var(--surface)] border border-[var(--border2)] rounded-xl p-3 mb-4 leading-relaxed">
          Estimates are kept on file (not deleted). Drafts and open quotes are{' '}
          <strong className="text-[var(--text)]">valid for 30 days</strong> from creation, then
          move to <strong className="text-[var(--text)]">Expired</strong>. Use the Expired pill to
          show older records. Convert before expiry when possible.
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-[var(--gold)]">{loading ? '—' : drafts}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              DRAFTS
            </div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-blue-300">{loading ? '—' : sent}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              SENT
            </div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-purple-300">{loading ? '—' : invoiced}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              INVOICED
            </div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-red-300">{loading ? '—' : expired}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              EXPIRED
            </div>
          </div>
        </div>

        <div className="mb-4">
          <input
            className="input"
            placeholder="Search customer, estimate #, device..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {(
            [
              ['active', 'Active'],
              ['draft', 'Drafts'],
              ['pending', 'Sent'],
              ['invoiced', 'Invoiced'],
              ['expired', 'Expired'],
              ['all', 'All'],
            ] as [EstFilter, string][]
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
            <div className="text-4xl mb-3">📝</div>
            <div className="font-semibold">
              {activeFilter === 'expired' ? 'No expired estimates.' : 'No estimates in this view'}
            </div>
            <p className="text-sm mt-1 text-[var(--text3)]">Create your first estimate to get started.</p>
            <Link href="/estimates/new" className="btn btn-primary mt-4 inline-flex">
              + New Estimate
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((est) => {
              const st = effectiveStatus(est);
              const until = validUntilLabel(est.created_at);
              const num = docNumber(est);
              const canConvert = st !== 'invoiced' && st !== 'cancelled' && st !== 'expired';
              const cust = customerActionFromEstimate(est);
              const actionLabel = customerActionLabel(cust.action);
              return (
                <div
                  key={String(est.id)}
                  className={`card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-[var(--gold-border)] ${
                    st === 'expired' ? 'opacity-85' : ''
                  }`}
                >
                  <Link href={`/estimates/new?id=${est.id}`} className="flex-1 min-w-0 block">
                    <div className="font-bold text-base truncate">
                      {est.customer_name || 'Unknown Customer'}
                    </div>
                    <div className="text-xs text-[var(--text3)] mt-1 flex flex-wrap gap-x-2 gap-y-1 items-center">
                      {num && (
                        <span className="text-[var(--gold)] font-bold">{num}</span>
                      )}
                      <span>
                        {est.created_at
                          ? new Date(est.created_at).toLocaleDateString()
                          : '—'}
                      </span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass(
                          st
                        )}`}
                      >
                        {st.charAt(0).toUpperCase() + st.slice(1)}
                      </span>
                      {st === 'expired' ? (
                        <span>· Expired</span>
                      ) : until ? (
                        <span>· Valid thru {until}</span>
                      ) : (
                        <span>· Valid 30 days</span>
                      )}
                      {actionLabel && (
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            cust.action === 'approved'
                              ? 'bg-green-900/40 text-green-200 border-green-700'
                              : 'bg-amber-900/40 text-amber-200 border-amber-700'
                          }`}
                        >
                          {actionLabel}
                        </span>
                      )}
                    </div>
                    {est.device_model && (
                      <div className="text-xs text-[var(--text3)] mt-0.5 truncate">
                        {est.device_model}
                      </div>
                    )}
                  </Link>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="font-bold text-[var(--gold)] text-lg">
                      {money(Number(est.total) || 0)}
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      <Link
                        href={`/estimates/new?id=${est.id}`}
                        className="btn btn-secondary text-xs px-3 py-1.5"
                      >
                        View
                      </Link>
                      {canConvert && (
                        <Link
                          href={`/invoices/new?fromEstimate=${est.id}`}
                          className="btn btn-primary text-xs px-3 py-1.5"
                        >
                          Convert to Invoice
                        </Link>
                      )}
                      {cust.token && (
                        <a
                          href={`/e/${encodeURIComponent(cust.token)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary text-xs px-3 py-1.5"
                        >
                          Customer page
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Link href="/estimates/new" className="fab sm:hidden" title="New Estimate">
        <Plus size={28} />
      </Link>
    </div>
  );
}
