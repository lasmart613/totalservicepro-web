'use client';

/**
 * TSP Directory — free public opt-in listings (Android tsp_directory.html parity).
 * Product: list_in_directory is free for all org types; no paywall.
 * Future: optional premium profile / boosting (not implemented).
 *
 * Logged-out visitors see a first page of real Organizations rows with PII
 * replaced (same privacy bar as guest marketplace prices). Card clicks go to
 * /signup. Signed-in viewers keep the existing opted-in listings and details.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { GuestRedactedText } from '@/components/directory/GuestRedactedText';
import { getSupabaseClient } from '@/lib/supabase/client';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { isServiceOrgType } from '@/lib/org-types';
import { orgTypeLabel } from '@/lib/labels';
import { useSignedIn } from '@/lib/use-signed-in';
import {
  GUEST_ADDRESS_PLACEHOLDER,
  GUEST_DIRECTORY_PAGE_SIZE,
  GUEST_EMAIL_PLACEHOLDER,
  GUEST_INITIALS_PLACEHOLDER,
  GUEST_NAME_PLACEHOLDER,
  GUEST_PHONE_PLACEHOLDER,
  GUEST_SIGNUP_HREF,
  type DirectoryFilterKey,
  type GuestDirectoryCard,
} from '@/lib/directory/guest';

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

type FilterKey = DirectoryFilterKey;

function typeLabel(t?: string | null): string {
  return orgTypeLabel(t) || 'Organization';
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

function guestFilters(signedIn: boolean): { key: FilterKey; label: string }[] {
  return [
    { key: 'all', label: 'All listed' },
    { key: 'service', label: 'Repair companies' },
    { key: 'clinics', label: signedIn ? 'My Clinics' : 'Laser clinics' },
    { key: 'reseller', label: 'Resellers' },
    { key: 'rental', label: 'Rental companies' },
    { key: 'supplier', label: 'Parts Suppliers' },
  ];
}

export default function DirectoryPage() {
  const supabase = getSupabaseClient();
  const { ready: authReady, signedIn } = useSignedIn();
  const [loading, setLoading] = useState(true);
  const [allListed, setAllListed] = useState<OrgRow[]>([]);
  const [myClinics, setMyClinics] = useState<OrgRow[]>([]);
  const [guestCards, setGuestCards] = useState<GuestDirectoryCard[]>([]);
  const [guestPage, setGuestPage] = useState(1);
  const [guestHasMore, setGuestHasMore] = useState(false);
  const [guestTotal, setGuestTotal] = useState<number | null>(null);
  const [guestLoadingMore, setGuestLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [note, setNote] = useState(
    'Organizations opt in for free during onboarding or Company Profile. Clinics shows only customers linked to your repair company.'
  );
  const [myOrgId, setMyOrgId] = useState<string | number | null>(null);

  const loadSignedIn = useCallback(async () => {
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

      // Free public directory listings — page until a short range, no silent 500 cap
      const listedSelect =
        'id, name, type, city, state, phone, email, website, logo_url, list_in_directory, is_active';
      let listed: OrgRow[] = [];
      const q1 = await fetchAllPages<OrgRow>((from, to) =>
        supabase
          .from('organizations')
          .select(listedSelect)
          .eq('list_in_directory', true)
          .order('name')
          .range(from, to)
      );

      if (q1.error) {
        console.warn('directory list', q1.error);
        if (/list_in_directory|column/i.test(q1.error.message || '')) {
          setNote(
            'Directory listing needs the list_in_directory column (migration). Orgs can opt in from Company Profile once applied.'
          );
        } else {
          const q2 = await fetchAllPages<OrgRow>((from, to) =>
            supabase
              .from('organizations')
              .select(listedSelect)
              .eq('list_in_directory', true)
              .order('name')
              .range(from, to)
          );
          listed = (q2.data || []).filter((o: any) => o.is_active !== false);
        }
      } else {
        listed = (q1.data || []).filter((o: any) => o.is_active !== false);
      }
      setAllListed(listed);
      setNote(
        'Organizations opt in for free during onboarding or Company Profile. Clinics shows only customers linked to your repair company.'
      );

      // My clinics — org-scoped via organization_customers (not global)
      const clinics: OrgRow[] = [];
      if (orgId) {
        try {
          const { data: links, error: clinicErr } = await fetchAllPages<any>((from, to) =>
            supabase
              .from('organization_customers')
              .select(
                'customer_organization_id, organizations:customer_organization_id (id, name, type, city, state, phone, email, website, logo_url, is_active)'
              )
              .eq('service_organization_id', orgId)
              .range(from, to)
          );
          if (clinicErr) console.warn('directory clinics', clinicErr);
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

  const applyGuestPayload = useCallback(
    (json: { listings?: GuestDirectoryCard[]; hasMore?: boolean; total?: number | null }, append: boolean) => {
      const rows = Array.isArray(json?.listings) ? json.listings : [];
      setGuestCards((prev) => (append ? [...prev, ...rows] : rows));
      setGuestHasMore(Boolean(json?.hasMore));
      setGuestTotal(typeof json?.total === 'number' ? json.total : null);
    },
    []
  );

  const loadGuestPage = useCallback(
    async (page: number, append: boolean) => {
      if (append) setGuestLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(GUEST_DIRECTORY_PAGE_SIZE),
          filter,
        });
        const res = await fetch(`/api/directory?${params.toString()}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(json?.listings)) {
          applyGuestPayload(json, append);
          setGuestPage(page);
          setNote(
            'Names, addresses, and contact details are hidden until you create a free account. Cards below are real organizations already on Total Service Pro.'
          );
          return;
        }

        if (append) return;
        setGuestCards([]);
        setGuestHasMore(false);
        setNote('Sign up to browse the company directory.');
      } catch (e) {
        console.warn(e);
        if (!append) {
          setGuestCards([]);
          setNote('Sign up to browse the company directory.');
        }
      } finally {
        setLoading(false);
        setGuestLoadingMore(false);
      }
    },
    [applyGuestPayload, filter]
  );

  useEffect(() => {
    if (!authReady || !signedIn) return;
    setGuestCards([]);
    void loadSignedIn();
  }, [authReady, signedIn, loadSignedIn]);

  useEffect(() => {
    if (!authReady || signedIn) return;
    setSearch('');
    setAllListed([]);
    setMyClinics([]);
    setGuestPage(1);
    void loadGuestPage(1, false);
  }, [authReady, signedIn, filter, loadGuestPage]);

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

  const visibleGuests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return guestCards;
    return guestCards.filter((o) => {
      const hay = [o.typeLabel, o.region, o.type].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [guestCards, search]);

  const filters = guestFilters(signedIn);
  const showingGuest = authReady && !signedIn;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-6">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/" className="text-[var(--gold)] text-xl font-bold" aria-label="Back">
            ←
          </Link>
          <h1 className="text-2xl font-extrabold">Company directory</h1>
        </div>
        <p className="text-sm text-[var(--text3)] mb-4">
          Discover repair companies, clinics, resellers, and suppliers listed in Total Service Pro.
          Listings are free.
        </p>

        <div className="card p-3 text-xs text-[var(--text3)] mb-4 leading-relaxed">{note}</div>

        <div className="mb-3">
          <input
            type="search"
            className="input w-full rounded-full"
            placeholder={
              showingGuest
                ? 'Filter by type or region… Sign up to search names'
                : 'Search by name, city, state…'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none">
          {filters.map((f) => (
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

        {!authReady || loading ? (
          <div className="text-center text-[var(--text3)] py-12">Loading directory…</div>
        ) : showingGuest ? (
          visibleGuests.length === 0 ? (
            <div className="text-center text-[var(--text3)] py-12 px-4">
              Sign up to browse the company directory.
              <div className="mt-4">
                <Link href={GUEST_SIGNUP_HREF} className="btn btn-primary text-sm px-4 py-2">
                  Create a free account
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2.5">
                {visibleGuests.map((o) => (
                  <Link
                    key={String(o.id)}
                    href={GUEST_SIGNUP_HREF}
                    className="card p-4 block hover:border-[var(--gold)] transition-colors"
                  >
                    <div className="flex gap-3 items-center">
                      <div className="w-12 h-12 rounded-xl bg-[var(--gold)] text-[#111] font-extrabold flex items-center justify-center overflow-hidden shrink-0">
                        <GuestRedactedText
                          signedIn={false}
                          placeholder={GUEST_INITIALS_PLACEHOLDER}
                          label="organization"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-[15px] truncate">
                          <GuestRedactedText
                            signedIn={false}
                            placeholder={GUEST_NAME_PLACEHOLDER}
                            label="organization name"
                          />
                        </div>
                        <div className="text-[11px] font-bold text-[var(--gold)] mt-0.5">
                          {o.typeLabel}
                        </div>
                        <div className="text-xs text-[var(--text3)] mt-0.5">
                          📍{' '}
                          {o.region ? (
                            o.region
                          ) : (
                            <GuestRedactedText
                              signedIn={false}
                              placeholder={GUEST_ADDRESS_PLACEHOLDER}
                              label="location"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                    {(o.hasPhone || o.hasEmail || o.hasWebsite) && (
                      <div className="text-xs text-[var(--text2)] mt-2.5 leading-relaxed">
                        {o.hasPhone && (
                          <GuestRedactedText
                            signedIn={false}
                            placeholder={GUEST_PHONE_PLACEHOLDER}
                            label="phone"
                          />
                        )}
                        {o.hasPhone && o.hasEmail && <span> · </span>}
                        {o.hasEmail && (
                          <GuestRedactedText
                            signedIn={false}
                            placeholder={GUEST_EMAIL_PLACEHOLDER}
                            label="email"
                          />
                        )}
                        {(o.hasPhone || o.hasEmail) && o.hasWebsite && <span> · </span>}
                        {o.hasWebsite && <span className="text-[var(--gold)]">Website</span>}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
              <div className="text-center text-xs text-[var(--text3)] mt-4">
                Showing {visibleGuests.length}
                {guestTotal != null ? ` of ${guestTotal}` : ''} organizations.
                {guestHasMore ? ' More listings are available after you sign up — or load the next page.' : ''}
              </div>
              {guestHasMore && (
                <div className="flex justify-center mt-3">
                  <button
                    type="button"
                    className="btn btn-secondary text-sm px-4 py-2"
                    disabled={guestLoadingMore}
                    onClick={() => void loadGuestPage(guestPage + 1, true)}
                  >
                    {guestLoadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
              <div className="flex justify-center mt-4">
                <Link href={GUEST_SIGNUP_HREF} className="btn btn-primary text-sm px-4 py-2">
                  Sign up to see names and contact details
                </Link>
              </div>
            </>
          )
        ) : visible.length === 0 ? (
          <div className="text-center text-[var(--text3)] py-12 px-4">
            {filter === 'clinics'
              ? myOrgId
                ? 'No customers linked to your organization yet.'
                : 'Sign in with a repair company to see your linked clinics.'
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
          {showingGuest ? (
            <Link href={GUEST_SIGNUP_HREF} className="text-[var(--gold)] hover:underline">
              Create a free account
            </Link>
          ) : (
            <Link href="/company" className="text-[var(--gold)] hover:underline">
              Company Profile
            </Link>
          )}{' '}
          → enable free directory listing.
        </p>
      </div>
    </div>
  );
}
