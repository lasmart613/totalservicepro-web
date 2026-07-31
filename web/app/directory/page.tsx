'use client';

/**
 * TSP Directory — free public opt-in listings (Android tsp_directory.html parity).
 * Product: list_in_directory is free for all org types; no paywall.
 * Future: optional premium profile / boosting (not implemented).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isServiceOrgType, ownerOrgTypeLabel } from '@/lib/org-types';

type OrgRow = {
  id: number | string;
  name?: string | null;
  type?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo_url?: string | null;
  list_in_directory?: boolean | null;
  is_active?: boolean | null;
};

type FilterKey = 'all' | 'service' | 'clinics' | 'reseller' | 'rental' | 'supplier';

function typeLabel(t?: string | null): string {
  const x = String(t || '').toLowerCase();
  if (x === 'service_company' || x === 'service') return 'Service Company';
  if (x === 'customer' || x === 'laser_clinic') return 'Laser Clinic';
  if (x === 'laser_rental') return 'Laser Rental';
  if (x === 'laser_reseller') return 'Laser Reseller';
  if (x === 'parts_supplier' || x === 'vendor') return 'Parts Supplier';
  return ownerOrgTypeLabel(x) || x || 'Organization';
}

function initials(name?: string | null): string {
  return (
    String(name || 'O')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || '')
      .join('')
      .toUpperCase() || 'O'
  );
}

function websiteHref(w?: string | null): string | null {
  if (!w) return null;
  const s = String(w).trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All listed' },
  { key: 'service', label: 'Service Cos' },
  { key: 'clinics', label: 'My Clinics' },
  { key: 'reseller', label: 'Resellers' },
  { key: 'rental', label: 'Rental Cos' },
  { key: 'supplier', label: 'Parts Suppliers' },
];

export default function DirectoryPage() {
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [allListed, setAllListed] = useState<OrgRow[]>([]);
  const [myClinics, setMyClinics] = useState<OrgRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [note, setNote] = useState(
    'Organizations opt in for free during onboarding or Company Profile. Clinics shows only customers linked to your service company.'
  );
  const [myOrgId, setMyOrgId] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let orgId: string | number | null = null;
      if (user) {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle();
        orgId = prof?.organization_id ?? null;
        setMyOrgId(orgId);
      }

      // Free public directory listings
      let listed: OrgRow[] = [];
      const q1 = await supabase
        .from('organizations')
        .select(
          'id, name, type, city, state, phone, email, website, logo_url, list_in_directory, is_active'
        )
        .eq('list_in_directory', true)
        .order('name')
        .limit(500);

      if (q1.error) {
        console.warn('directory list', q1.error);
        if (/list_in_directory|column/i.test(q1.error.message || '')) {
          setNote(
            'Directory listing needs the list_in_directory column (migration). Orgs can opt in from Company Profile once applied.'
          );
        } else {
          // Try without is_active filter
          const q2 = await supabase
            .from('organizations')
            .select(
              'id, name, type, city, state, phone, email, website, logo_url, list_in_directory, is_active'
            )
            .eq('list_in_directory', true)
            .order('name')
            .limit(500);
          listed = (q2.data || []).filter((o: any) => o.is_active !== false);
        }
      } else {
        listed = (q1.data || []).filter((o: any) => o.is_active !== false);
      }
      setAllListed(listed);

      // My clinics — org-scoped via organization_customers (not global)
      const clinics: OrgRow[] = [];
      if (orgId) {
        try {
          const { data: links } = await supabase
            .from('organization_customers')
            .select(
              'customer_organization_id, organizations:customer_organization_id (id, name, type, city, state, phone, email, website, logo_url, is_active)'
            )
            .eq('service_organization_id', orgId)
            .limit(500);
          const seen = new Set<string>();
          (links || []).forEach((row: any) => {
            const o = row.organizations;
            if (!o?.id || seen.has(String(o.id))) return;
            if (o.is_active === false) return;
            seen.add(String(o.id));
            clinics.push(o);
          });
        } catch (e) {
          console.warn('directory clinics', e);
        }
      }
      setMyClinics(clinics);
    } catch (e) {
      console.warn(e);
      setNote('Could not load directory. Sign in and try again.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    let source: OrgRow[];
    if (filter === 'clinics') {
      source = myClinics.slice();
    } else {
      source = allListed.filter((o) => {
        const t = String(o.type || '').toLowerCase();
        if (filter === 'service') return isServiceOrgType(t) || t === 'service';
        if (filter === 'reseller') return t === 'laser_reseller';
        if (filter === 'rental') return t === 'laser_rental';
        if (filter === 'supplier') return t === 'parts_supplier' || t === 'vendor';
        return true;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      source = source.filter((o) => {
        const hay = [o.name, o.city, o.state, o.type, o.website, o.phone, o.email]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return source;
  }, [allListed, myClinics, filter, search]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-6">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/" className="text-[var(--gold)] text-xl font-bold" aria-label="Back">
            ←
          </Link>
          <h1 className="text-2xl font-extrabold">TSP Directory</h1>
        </div>
        <p className="text-sm text-[var(--text3)] mb-4">
          Discover service companies, clinics, resellers, and suppliers listed in Total Service Pro.
          Listings are free.
        </p>

        <div className="card p-3 text-xs text-[var(--text3)] mb-4 leading-relaxed">{note}</div>

        <div className="mb-3">
          <input
            type="search"
            className="input w-full rounded-full"
            placeholder="Search by name, city, state…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                filter === f.key
                  ? 'border-[var(--gold)] text-[var(--gold)] bg-[var(--gold-glow)]'
                  : 'border-[var(--border2)] text-[var(--text3)] bg-[var(--surface3)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-[var(--text3)] py-12">Loading directory…</div>
        ) : visible.length === 0 ? (
          <div className="text-center text-[var(--text3)] py-12 px-4">
            {filter === 'clinics'
              ? myOrgId
                ? 'No customers linked to your organization yet.'
                : 'Sign in with a service company to see your linked clinics.'
              : 'No organizations match this filter. Orgs appear when they opt into the free directory listing.'}
          </div>
        ) : (
          <div className="space-y-2.5">
            {visible.map((o) => {
              const loc = [o.city, o.state].filter(Boolean).join(', ') || '—';
              const web = websiteHref(o.website);
              return (
                <div key={String(o.id)} className="card p-4">
                  <div className="flex gap-3 items-center">
                    <div className="w-12 h-12 rounded-xl bg-[var(--gold)] text-[#111] font-extrabold flex items-center justify-center overflow-hidden shrink-0">
                      {o.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.logo_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        initials(o.name)
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[15px] truncate">{o.name || 'Organization'}</div>
                      <div className="text-[11px] font-bold text-[var(--gold)] mt-0.5">
                        {typeLabel(o.type)}
                      </div>
                      <div className="text-xs text-[var(--text3)] mt-0.5">📍 {loc}</div>
                    </div>
                  </div>
                  {(o.phone || o.email || web) && (
                    <div className="text-xs text-[var(--text2)] mt-2.5 leading-relaxed">
                      {o.phone && <span>{o.phone}</span>}
                      {o.phone && o.email && <span> · </span>}
                      {o.email && <span>{o.email}</span>}
                      {(o.phone || o.email) && web && <span> · </span>}
                      {web && (
                        <a
                          href={web}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--gold)] hover:underline"
                        >
                          Website
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-[var(--text3)] mt-8">
          Want to appear here?{' '}
          <Link href="/company" className="text-[var(--gold)] hover:underline">
            Company Profile
          </Link>{' '}
          → enable free directory listing.
        </p>
      </div>
    </div>
  );
}
