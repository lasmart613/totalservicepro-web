'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchGodMe, godAuthHeader, GOD_DASHBOARD_PATH } from '@/lib/god-client';
import { GOD_ANALYTICS_PATH } from '@/lib/god-tables';
import {
  ANALYTICS_PERIODS,
  ANALYTICS_PERIOD_LABEL,
  type AnalyticsPeriod,
  type AnalyticsRow,
  type GodAnalyticsPayload,
  type TspEventRow,
} from '@/lib/god-analytics';

function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value > 1 ? value : value * 100;
  return `${pct.toFixed(1)}%`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function RankedTable({
  title,
  rows,
  nameLabel,
  valueLabel,
  empty,
}: {
  title: string;
  rows: AnalyticsRow[];
  nameLabel: string;
  valueLabel: string;
  empty: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="text-xs text-[var(--text3)]">Last 30 days</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
              <th className="p-3">{nameLabel}</th>
              <th className="p-3 text-right">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.label}`} className="border-b border-[var(--border)]">
                <td className="p-3 break-all">{row.label || '—'}</td>
                <td className="p-3 text-right font-semibold text-[var(--gold)]">{formatCount(row.value)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="p-6 text-center text-[var(--text3)]">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TspTable({ events }: { events: TspEventRow[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-lg font-bold">TSP events</h3>
        <p className="text-xs text-[var(--text3)]">
          Shown when gtag fires them. Untagged events stay empty — do not invent counts.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
              <th className="p-3">Event</th>
              <th className="p-3 text-right">30d count</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.key} className="border-b border-[var(--border)]">
                <td className="p-3">{event.label}</td>
                <td className="p-3 text-right font-semibold text-[var(--gold)]">
                  {event.tagged ? formatCount(event.count) : '—'}
                </td>
                <td className="p-3 text-[var(--text3)]">{event.tagged ? 'Tagged' : 'Not tagged yet'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeriodCard({ period, data }: { period: AnalyticsPeriod; data: GodAnalyticsPayload['periods'][AnalyticsPeriod] }) {
  return (
    <div className="card p-4 min-w-0">
      <div className="text-xs uppercase tracking-wide text-[var(--text3)] mb-2">
        {ANALYTICS_PERIOD_LABEL[period]}
      </div>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text3)]">Users</dt>
          <dd className="font-extrabold text-[var(--gold)]">{formatCount(data.users)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text3)]">New users</dt>
          <dd className="font-semibold">{formatCount(data.newUsers)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text3)]">Sessions</dt>
          <dd className="font-semibold">{formatCount(data.sessions)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text3)]">Page views</dt>
          <dd className="font-semibold">{formatCount(data.pageViews)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text3)]">Bounce rate</dt>
          <dd className="font-semibold">{formatPercent(data.bounceRate)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text3)]">Avg. session</dt>
          <dd className="font-semibold">{formatDuration(data.avgSessionSeconds)}</dd>
        </div>
      </dl>
    </div>
  );
}

function SetupCard({ data }: { data: GodAnalyticsPayload }) {
  return (
    <div className="card p-5 mb-6">
      <h2 className="text-xl font-bold mb-2">Connect Google Analytics</h2>
      <p className="text-sm text-[var(--text3)] mb-4 max-w-3xl">{data.message}</p>
      <p className="text-sm mb-3">
        Property <span className="text-[var(--gold)]">{data.propertyName}</span> ({data.propertyId}) · stream{' '}
        <span className="text-[var(--gold)]">{data.streamName}</span> · {data.measurementId} · {data.site}. Soft beta:
        no Google Ads linking.
      </p>
      <ol className="list-decimal pl-5 space-y-2 text-sm text-[var(--text2)] mb-4">
        {data.setup.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="text-xs text-[var(--text3)]">
        Env names only (paste values in Netlify / <code>.env.local</code>): {data.setup.envVars.join(', ')}.
      </p>
    </div>
  );
}

export function GodAnalyticsBoard({ variant = 'full' }: { variant?: 'full' | 'teaser' }) {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [data, setData] = useState<GodAnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const god = await fetchGodMe();
      if (cancelled) return;
      if (!god) {
        setAllowed(false);
        setReady(true);
        return;
      }
      setAllowed(true);
      try {
        const headers = await godAuthHeader();
        const res = await fetch('/api/god/analytics', { headers, cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Could not load analytics');
          setData(null);
        } else {
          setData(json as GodAnalyticsPayload);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load analytics');
          setData(null);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <div className="text-[var(--text3)]">Loading analytics…</div>;
  }

  if (!allowed) {
    return (
      <div className="max-w-lg mx-auto w-full py-16 text-center">
        <h1 className="text-3xl font-extrabold">404</h1>
        <p className="text-[var(--text3)] mt-2 mb-6">This page could not be found.</p>
        <Link href="/" className="btn btn-primary">
          Dashboard
        </Link>
      </div>
    );
  }

  const needsSetup = data && (data.status === 'missing_credentials' || data.status === 'invalid_credentials');

  if (variant === 'teaser') {
    return (
      <section className="mb-8" aria-labelledby="god-analytics-teaser-heading">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 id="god-analytics-teaser-heading" className="text-2xl font-bold">
              Analytics
            </h2>
            <p className="text-sm text-[var(--text3)] max-w-3xl">
              RepairPlanet GA4 ({data?.measurementId || 'G-GNBJQ2DMQB'}). Product KPIs above are Supabase; this is
              site traffic. Soft beta: no Ads.
            </p>
          </div>
          <Link href={GOD_ANALYTICS_PATH} className="btn btn-secondary text-xs">
            Open Analytics
          </Link>
        </div>
        {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}
        {needsSetup ? <SetupCard data={data} /> : null}
        {data && !needsSetup ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--text3)] mb-1">Realtime</div>
              <div className="text-2xl font-extrabold text-[var(--gold)]">{formatCount(data.realtimeUsers)}</div>
            </div>
            {ANALYTICS_PERIODS.map((period) => (
              <div key={period} className="card p-4">
                <div className="text-xs uppercase tracking-wide text-[var(--text3)] mb-1">
                  {ANALYTICS_PERIOD_LABEL[period]} users
                </div>
                <div className="text-2xl font-extrabold text-[var(--gold)]">
                  {formatCount(data.periods[period].users)}
                </div>
                <p className="text-xs text-[var(--text3)] mt-1">
                  {formatCount(data.periods[period].sessions)} sessions
                </p>
              </div>
            ))}
          </div>
        ) : null}
        {data?.status === 'empty' || data?.status === 'ga4_error' ? (
          <p className="text-sm text-[var(--text3)] mt-3">{data.message}</p>
        ) : null}
      </section>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">Analytics</h1>
      <p className="text-[var(--text3)] mb-6 max-w-3xl">
        Site KPIs from Google Analytics 4 for {data?.site || 'https://repairplanet.net'}. Property{' '}
        <span className="text-[var(--gold)]">{data?.propertyName || 'Living Free - GA4'}</span> (
        {data?.propertyId || '365480892'}) · stream {data?.streamName || 'RepairPlanet'} ·{' '}
        {data?.measurementId || 'G-GNBJQ2DMQB'}. Soft beta: no Google Ads linking. Site gtag is
        already live; this page reads the Data API once a service account is linked.{' '}
        <Link href={GOD_DASHBOARD_PATH} className="text-[var(--gold)] hover:underline">
          Back to Invites
        </Link>
        .
      </p>

      {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}
      {needsSetup && data ? <SetupCard data={data} /> : null}

      {data && !needsSetup ? (
        <>
          {data.message ? <p className="text-sm text-[var(--text3)] mb-4">{data.message}</p> : null}

          <div className="flex flex-wrap gap-2 mb-4 text-sm">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <span className="text-[var(--text3)]">Realtime users: </span>
              <span className="font-semibold text-[var(--gold)]">{formatCount(data.realtimeUsers)}</span>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text3)]">
              {data.propertyId} · {data.measurementId}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {ANALYTICS_PERIODS.map((period) => (
              <PeriodCard key={period} period={period} data={data.periods[period]} />
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            <RankedTable
              title="Top pages"
              rows={data.topPages}
              nameLabel="Path"
              valueLabel="Views"
              empty="No page views in the last 30 days yet."
            />
            <RankedTable
              title="Landing pages"
              rows={data.landingPages}
              nameLabel="Path"
              valueLabel="Sessions"
              empty="No landing pages in the last 30 days yet."
            />
            <RankedTable
              title="Channels"
              rows={data.channels}
              nameLabel="Channel"
              valueLabel="Sessions"
              empty="No channel grouping rows yet."
            />
            <RankedTable
              title="Devices"
              rows={data.devices}
              nameLabel="Device"
              valueLabel="Sessions"
              empty="No device breakdown yet."
            />
            <RankedTable
              title="Countries"
              rows={data.countries}
              nameLabel="Country"
              valueLabel="Users"
              empty="No country rows yet."
            />
            <TspTable events={data.tspEvents} />
          </div>

          <div className="card overflow-hidden mb-8">
            <div className="px-4 pt-4 pb-2">
              <h3 className="text-lg font-bold">All events</h3>
              <p className="text-xs text-[var(--text3)]">Top event names from GA4 for the last 30 days.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
                    <th className="p-3">Event</th>
                    <th className="p-3 text-right">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((event) => (
                    <tr key={event.name} className="border-b border-[var(--border)]">
                      <td className="p-3">
                        {event.name}
                        {event.tsp ? <span className="ml-2 text-xs text-[var(--gold)]">TSP</span> : null}
                      </td>
                      <td className="p-3 text-right font-semibold text-[var(--gold)]">{formatCount(event.count)}</td>
                    </tr>
                  ))}
                  {data.events.length === 0 && (
                    <tr>
                      <td colSpan={2} className="p-6 text-center text-[var(--text3)]">
                        No events yet. page_view / session_start appear after gtag is live.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
