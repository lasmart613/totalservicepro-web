'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient, ServiceReport } from '../../lib/supabase/client';
import { Header } from '../../components/Header';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

function isValidOrgId(val: any): boolean {
  if (val == null) return false;
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return true;
  if (typeof val === 'string') {
    const s = val.trim();
    if (s.includes('-') && s.length > 10) return true;
    if (/^\d+$/.test(s)) return true;
  }
  return false;
}

export default function ReportsList() {
  const [reports, setReports] = useState<ServiceReport[]>([]);
  const [filtered, setFiltered] = useState<ServiceReport[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'draft' | 'complete'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | number | null>(null);
  const supabase = getSupabaseClient();
  const router = useRouter();

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [reports, activeFilter, search]);

  async function init() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      // Load org for scoping (like original)
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();

      const org = profile?.organization_id;
      if (isValidOrgId(org)) setCurrentUserOrgId(org);

      await loadReports(org);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadReports(orgId: any) {
    let query = supabase
      .from('service_reports')
      .select('id, report_number, equipment_name, serial_number, customer_name, service_type, status, date_out, updated_at, model_type')
      .order('updated_at', { ascending: false });

    if (isValidOrgId(orgId)) {
      query = query.eq('organization_id', orgId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Load reports error', error);
      setReports([]);
    } else {
      setReports((data || []) as ServiceReport[]);
    }
  }

  function applyFilters() {
    let res = [...reports];
    if (activeFilter !== 'all') {
      res = res.filter(r => r.status === activeFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      res = res.filter(r => {
        const hay = [r.report_number, r.equipment_name, r.customer_name, r.serial_number, r.model_type]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    setFiltered(res);
  }

  function setFilter(f: 'all' | 'draft' | 'complete') {
    setActiveFilter(f);
  }

  const drafts = reports.filter(r => r.status === 'draft').length;
  const completes = reports.filter(r => r.status === 'complete').length;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="page max-w-4xl mx-auto w-full px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-extrabold">📋 Service Reports</h1>
            <p className="text-[var(--text3)] text-sm">Manage performance &amp; safety documentation</p>
          </div>
          <Link href="/reports/new" className="btn btn-primary hidden sm:flex items-center gap-2">
            <Plus size={18} /> New Report
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="stat-card card p-4 text-center">
            <div className="text-3xl font-extrabold text-[var(--gold)]">{drafts}</div>
            <div className="text-xs font-semibold tracking-wider text-[var(--text3)] mt-1">DRAFTS</div>
          </div>
          <div className="stat-card card p-4 text-center">
            <div className="text-3xl font-extrabold text-[var(--green)]">{completes}</div>
            <div className="text-xs font-semibold tracking-wider text-[var(--text3)] mt-1">COMPLETED</div>
          </div>
        </div>

        <div className="mb-4">
          <input
            className="input"
            placeholder="Search by customer, equipment, report #, serial..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button className={`filter-chip ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          <button className={`filter-chip ${activeFilter === 'draft' ? 'active' : ''}`} onClick={() => setFilter('draft')}>Drafts</button>
          <button className={`filter-chip ${activeFilter === 'complete' ? 'active' : ''}`} onClick={() => setFilter('complete')}>Completed</button>
        </div>

        {loading ? (
          <div className="empty-state"><div className="animate-spin h-6 w-6 border-2 border-[var(--gold)] border-t-transparent rounded-full mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="text-4xl mb-3">📋</div>
            <div className="font-semibold">No matching reports</div>
            <p className="text-sm mt-1">Tap the + button to create your first service report.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => {
              const title = r.equipment_name || r.model_type || r.report_number || 'Untitled Report';
              const dateStr = r.date_out ? new Date(r.date_out + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
              const updated = r.updated_at ? new Date(r.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
              return (
                <Link key={r.id} href={`/reports/${r.id}`} className="card p-4 flex gap-4 items-start hover:border-[var(--gold-border)] block">
                  <div className="text-3xl flex-shrink-0 mt-0.5">{r.status === 'complete' ? '✅' : '📝'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base truncate">{title}</div>
                    <div className="text-sm text-[var(--text3)] mt-0.5">🏥 {r.customer_name || '—'}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text3)] mt-1.5">
                      {r.report_number && <span>{r.report_number}</span>}
                      {r.serial_number && <span>SN: {r.serial_number}</span>}
                      {r.service_type && <span>{r.service_type}</span>}
                      <span className="opacity-60">{dateStr}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 text-xs text-[var(--text3)]">
                    <div className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold mt-1 ${r.status === 'complete' ? 'bg-[var(--green)]/10 text-[var(--green)] border border-[var(--green)]/30' : 'bg-[var(--gold-glow)] text-[var(--gold)] border border-[var(--gold-border)]'}`}>
                      {r.status === 'complete' ? 'Complete' : 'Draft'}
                    </div>
                    <div className="mt-2">Saved {updated}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <Link href="/reports/new" className="fab sm:hidden" title="New Report">
        <Plus size={28} />
      </Link>
    </div>
  );
}
