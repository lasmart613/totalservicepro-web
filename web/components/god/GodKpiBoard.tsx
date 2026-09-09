'use client';

import { useEffect, useState } from 'react';
import { godAuthHeader } from '@/lib/god-client';
import {
  ANALYTICS_CONNECT_NOTE,
  DEFAULT_KPI_DAYS,
  KPI_DAY_OPTIONS,
  type GodKpiPayload,
  type KpiDays,
  type KpiMetric,
} from '@/lib/god-kpis';

function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

function KpiCard({ metric }: { metric: KpiMetric }) {
  const isStub = metric.kind === 'stub';
  return (
    <div className="card p-4 min-w-0">
      <div className="text-xs uppercase tracking-wide text-[var(--text3)] mb-1">{metric.label}</div>
      {isStub ? (
        <div className="text-sm font-semibold text-[var(--gold)] leading-snug">
          {metric.note || ANALYTICS_CONNECT_NOTE}
        </div>
      ) : (
        <div className="text-2xl font-extrabold text-[var(--gold)]">{formatCount(metric.value)}</div>
      )}
      {!isStub && metric.note ? (
        <p className="text-xs text-[var(--text3)] mt-2 leading-snug">{metric.note}</p>
      ) : null}
    </div>
  );
}

export function GodKpiBoard() {
  const [days, setDays] = useState<KpiDays>(DEFAULT_KPI_DAYS);
  const [data, setData] = useState<GodKpiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await godAuthHeader();
        const res = await fetch(`/api/god/kpis?days=${days}`, { headers, cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Could not load site KPIs');
          setData(null);
          return;
        }
        setData(json as GodKpiPayload);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load site KPIs');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <section className="mb-8" aria-labelledby="god-kpi-heading">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 id="god-kpi-heading" className="text-2xl font-bold">
            Site performance
          </h2>
          <p className="text-sm text-[var(--text3)] max-w-3xl">
            RepairPlanet / TSP activity from Supabase. Sign-ins are unique users (last sign-in in
            range), not sessions. Time on site is not invented — it needs Google Analytics.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="KPI time range">
          {KPI_DAY_OPTIONS.map((option) => {
            const active = option === days;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                className={'btn text-xs ' + (active ? 'btn-primary' : 'btn-secondary')}
                onClick={() => setDays(option)}
              >
                {option} days
              </button>
            );
          })}
        </div>
      </div>

      {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}

      {data?.snapshotMetrics?.length ? (
        <div className="flex flex-wrap gap-2 mb-3 text-sm">
          {data.snapshotMetrics.map((metric) => (
            <div
              key={metric.key}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              title={metric.note || metric.source}
            >
              <span className="text-[var(--text3)]">{metric.label}: </span>
              <span className="font-semibold text-[var(--gold)]">
                {metric.available ? formatCount(metric.value) : '—'}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="text-sm text-[var(--text3)]">Loading site KPIs…</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-3">
            {data.rangeMetrics.map((metric) => (
              <KpiCard key={metric.key} metric={metric} />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.stubs.map((metric) => (
              <KpiCard key={metric.key} metric={metric} />
            ))}
          </div>
          {loading ? <p className="text-xs text-[var(--text3)] mt-2">Refreshing {days}-day range…</p> : null}
        </>
      ) : null}
    </section>
  );
}
