'use client';

/**
 * Find clinics — prospect finder for service-company members (000929).
 * Data comes only from public.find_clinic_prospects(); the server returns the
 * caller's tier and exactly the rows/fields that tier may see. Free gets up
 * to 20 local clinics plus counts by area; Premium gets every clinic.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useSiteLocale, useT } from '@/lib/fa/locale';
import { documentDirection, fillTemplate } from '@/lib/i18n/translate-app';
import { countryLabel } from '@/lib/countries';
import {
  ALL_COUNTRIES,
  countryPills,
  filterByCountry,
  nextPillIndex,
  type CountryPill,
} from '@/lib/prospects/country-pills';
import {
  addErrorKey,
  emptyStateKey,
  parseProspectResponse,
  upgradeCta,
  PROSPECT_PAGE_SIZE,
  type ProspectLoad,
} from '@/lib/prospects/find-clinics';

/** Upgrade link the app already uses for Upgrade chrome (lib/org-plan upgradeChromeHrefForOrg). */
const UPGRADE_HREF = '/plans';

function UpgradeCta({ area, total, compact }: { area: number; total: number; compact?: boolean }) {
  const t = useT();
  const locale = useSiteLocale();
  const nf = new Intl.NumberFormat(locale);
  const stats = (
    <ul className={`flex flex-wrap gap-x-6 gap-y-1 ${compact ? 'text-sm' : 'text-base sm:text-lg font-semibold'}`}>
      {area > 0 && <li>{fillTemplate(t('More in your area: {count}'), { count: nf.format(area) })}</li>}
      <li>{fillTemplate(t('More worldwide: {count}'), { count: nf.format(total) })}</li>
    </ul>
  );
  if (compact) {
    return (
      <div className="card p-3 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-[var(--gold-border)]">
        {stats}
        <Link href={UPGRADE_HREF} className="btn btn-primary text-sm whitespace-nowrap self-start sm:self-auto">
          {t('Unlock with Premium')}
        </Link>
      </div>
    );
  }
  return (
    <section
      aria-labelledby="find-clinics-upgrade"
      className="w-full rounded-2xl p-5 sm:p-8 mb-8 border-2 border-[var(--gold)] bg-[var(--surface)] text-start"
    >
      <h2 id="find-clinics-upgrade" className="text-xl sm:text-3xl font-extrabold mb-3 break-words">
        🔓 {t('Unlock more clinics with Premium')}
      </h2>
      {stats}
      <p className="text-sm text-[var(--text3)] mt-3 mb-5">
        {t('See every clinic with contacts and equipment, filter by country and city, and add them to your customers in one click.')}
      </p>
      <Link href={UPGRADE_HREF} className="btn btn-primary text-base sm:text-lg px-6 py-3 inline-block w-full sm:w-auto text-center">
        {t('Unlock with Premium')}
      </Link>
    </section>
  );
}

function CountryPills({
  pills,
  selected,
  onSelect,
  rtl,
}: {
  pills: CountryPill[];
  selected: string;
  onSelect: (key: string) => void;
  rtl: boolean;
}) {
  const t = useT();
  const locale = useSiteLocale();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="group" aria-label={t('Filter by country')} className="flex flex-wrap gap-2 mb-4">
      {pills.map((p, i) => {
        const pressed = p.key === selected;
        const label = p.country ? countryLabel(p.country, locale) : t('All');
        return (
          <button
            key={p.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-pressed={pressed}
            tabIndex={pressed ? 0 : -1}
            onClick={() => onSelect(p.key)}
            onKeyDown={(e) => {
              const next = nextPillIndex(i, e.key, pills.length, rtl);
              if (next !== i && next >= 0) {
                e.preventDefault();
                refs.current[next]?.focus();
                onSelect(pills[next].key);
              }
            }}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${
              pressed
                ? 'bg-[var(--gold)] text-[#111] border-[var(--gold)] font-semibold'
                : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--gold-border)]'
            }`}
          >
            <bdi>{label}</bdi> <span className="opacity-75">({p.count.toLocaleString(locale)})</span>
          </button>
        );
      })}
    </div>
  );
}

export default function FindClinicsPage() {
  const t = useT();
  const locale = useSiteLocale();
  const { dir } = documentDirection(locale);
  const rtl = dir === 'rtl';
  const supabase = getSupabaseClient();
  const [load, setLoad] = useState<ProspectLoad | null>(null);
  const [country, setCountry] = useState<string>(ALL_COUNTRIES);
  const [city, setCity] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [areaCountry, setAreaCountry] = useState<string>(ALL_COUNTRIES);

  const [loadingMore, setLoadingMore] = useState(false);

  // Filtering, paging and counts all happen in find_clinic_prospects (server).
  const fetchPage = useCallback(
    async (opts: { country: string; city: string; offset: number }) => {
      const { data, error } = await supabase.rpc('find_clinic_prospects', {
        p_country: opts.country === ALL_COUNTRIES ? null : opts.country,
        p_city: opts.city || null,
        p_limit: PROSPECT_PAGE_SIZE,
        p_offset: opts.offset,
      });
      const res = parseProspectResponse(data, error);
      if (!res.ok && res.reason === 'error') console.error('[find-clinics] find_clinic_prospects failed', error ?? data);
      return res;
    },
    [supabase],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchPage({ country, city, offset: 0 }).then((res) => {
      if (!cancelled) setLoad(res);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, country, city]);

  async function loadMore() {
    if (!load || !load.ok) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage({ country, city, offset: load.data.clinics.length });
      if (res.ok) {
        setLoad({ ok: true, data: { ...res.data, clinics: [...load.data.clinics, ...res.data.clinics] } });
      }
    } finally {
      setLoadingMore(false);
    }
  }

  const data = load && load.ok ? load.data : null;
  const premium = data?.tier === 'premium';
  const cta = upgradeCta(data);

  // Pills: server GROUP BY counts (Premium: whole pool; Free: gated rows).
  const pills = useMemo(() => (data ? countryPills(data.country_counts, (c) => c.count) : []), [data]);

  const clinics = data ? data.clinics : [];
  const cities = data && premium ? data.city_counts.map((c) => c.city) : [];

  // Free: area rows are filtered on screen (already aggregates, top 300 groups).
  const areas = useMemo(() => (data && !premium ? filterByCountry(data.aggregates, areaCountry) : []), [data, premium, areaCountry]);

  // Synchronous guard: state updates are async, so a burst of clicks could
  // otherwise fire several RPCs before the button re-renders as disabled.
  const addInFlight = useRef(false);

  async function addCustomer(id: string | number) {
    if (addInFlight.current) return;
    addInFlight.current = true;
    setAdding(String(id));
    try {
      const { data: res, error } = await supabase.rpc('add_prospect_customer', { p_clinic_id: Number(id) });
      const j = (res || {}) as { ok?: boolean; error?: string };
      if (error || !j.ok) {
        if (error) console.error('[find-clinics] add_prospect_customer failed', error);
        toast.error(t(addErrorKey(error ? undefined : j.error)));
        return;
      }
      toast.success(t('Added to your customers.'));
      setLoad((prev) =>
        prev && prev.ok
          ? {
              ok: true,
              data: {
                ...prev.data,
                clinics: prev.data.clinics.map((c) => (String(c.id) === String(id) ? { ...c, is_customer: true } : c)),
              },
            }
          : prev,
      );
    } finally {
      addInFlight.current = false;
      setAdding(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 py-6" dir={dir}>
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold">🔎 {t('Find clinics')}</h1>
          <p className="text-sm text-[var(--text3)]">
            {t('Clinics near you and the shared clinic pool. Add the ones you want to serve to your customers.')}
          </p>
        </div>

        {!load ? (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading clinics...')}</div>
        ) : !load.ok ? (
          <div className="card p-8 text-center text-[var(--text3)]">
            {load.reason === 'not_service_org'
              ? t('Find clinics is only available to service companies.')
              : load.reason === 'unavailable'
                ? t('Find clinics is not available yet.')
                : t('Could not load clinics. Please try again.')}
          </div>
        ) : (
          <>
            {!premium && (
              <div className="card p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-sm">
                  {fillTemplate(
                    t('Free shows up to {count} clinics near you. Premium shows every clinic with contacts and equipment.'),
                    { count: data!.free_limit },
                  )}
                </p>
                <Link href={UPGRADE_HREF} className="btn btn-primary text-sm whitespace-nowrap">
                  {t('Unlock with Premium')}
                </Link>
              </div>
            )}

            {premium && (
              <>
                <CountryPills
                  pills={pills}
                  selected={country}
                  rtl={rtl}
                  onSelect={(k) => {
                    setCountry(k);
                    setCity('');
                  }}
                />
                <div className="mb-4">
                  <label className="label" htmlFor="find-clinics-city">
                    {t('City')}
                  </label>
                  <select
                    id="find-clinics-city"
                    className="select w-full md:w-72"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  >
                    <option value="">{t('All cities')}</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {clinics.length === 0 ? (
              <div className="card p-8 text-center text-[var(--text3)] mb-6">
                {t(emptyStateKey(data))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {clinics.map((c) => (
                  <div key={c.id} className="card p-5">
                    <div className="font-semibold text-lg">
                      <bdi>{c.name}</bdi>
                    </div>
                    <div className="text-sm text-[var(--text3)] mb-2">
                      <bdi>{[c.city, c.state, c.country ? countryLabel(c.country, locale) : null].filter(Boolean).join(', ') || '—'}</bdi>
                    </div>
                    {c.address && <div className="text-sm mb-1"><bdi>{c.address}</bdi></div>}
                    {c.contact_name && <div className="text-sm">👤 <bdi>{c.contact_name}</bdi></div>}
                    {c.phone && <div className="text-sm">📞 <bdi dir="ltr">{c.phone}</bdi></div>}
                    {c.email && <div className="text-sm">✉️ <bdi dir="ltr">{c.email}</bdi></div>}
                    {c.laser_models && (
                      <div className="mt-3 pt-3 border-t border-[var(--border)]">
                        <div className="text-xs uppercase tracking-widest text-[var(--text3)] mb-1">{t('Equipment')}</div>
                        <div className="text-sm line-clamp-2"><bdi>{c.laser_models}</bdi></div>
                      </div>
                    )}
                    {premium && (
                      <div className="mt-3">
                        {c.is_customer ? (
                          <span className="text-xs font-semibold text-[var(--gold)]">✓ {t('In my customers')}</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary text-sm"
                            disabled={adding !== null}
                            onClick={() => void addCustomer(c.id)}
                          >
                            {adding === String(c.id) ? t('Adding…') : t('Add to my customers')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {premium && data!.page.has_more && (
              <div className="mb-8 text-center">
                <button type="button" className="btn btn-secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? t('Loading clinics...') : t('Load more')}
                </button>
              </div>
            )}

            {cta && <UpgradeCta area={cta.area} total={cta.total} />}

            {!premium && data!.aggregates.length > 0 && (
              <section aria-labelledby="find-clinics-areas">
                <h2 id="find-clinics-areas" className="font-bold text-lg mb-3">
                  {t('More clinics by area')}
                </h2>
                {cta && <UpgradeCta area={cta.area} total={cta.total} compact />}
                <CountryPills pills={pills} selected={areaCountry} rtl={rtl} onSelect={setAreaCountry} />
                <ul className="card divide-y divide-[var(--border)]">
                  {areas.map((a, i) => (
                    <li key={`${a.country}-${a.city}-${i}`} className="flex justify-between gap-3 px-4 py-2 text-sm">
                      <bdi>
                        {[a.city || t('Unknown area'), a.country ? countryLabel(a.country, locale) : null].filter(Boolean).join(', ')}
                      </bdi>
                      <span className="text-[var(--text3)]">
                        {fillTemplate(t('Clinics: {count}'), { count: a.count.toLocaleString(locale) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
