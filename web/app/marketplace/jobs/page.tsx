'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/fa/locale';
import { Header } from '@/components/Header';
import { ListingDescriptionSnippet } from '@/components/ListingDescription';
import { jobSideLabel, jobStatusLabel, jobTypeLabel } from '@/components/marketplace/job-labels';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  JOB_PUBLIC_SELECT,
  JOB_SIDES,
  JOB_TYPES,
  filterJobs,
  isMissingJobsTable,
  jobDetailPath,
  type JobBoardFilters,
  type JobRow,
} from '@/lib/marketplace/jobs';

const EMPTY_FILTERS: JobBoardFilters = {
  query: '',
  side: '',
  job_type: '',
  remote: '',
  showFilled: false,
};

export default function JobBoardPage() {
  const t = useT();
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<'missing' | 'load' | ''>('');
  const [filters, setFilters] = useState<JobBoardFilters>(EMPTY_FILTERS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const statuses = ['open', 'filled'];
        const { data, error } = await getSupabaseClient()
          .from('marketplace_jobs')
          .select(JOB_PUBLIC_SELECT)
          .in('status', statuses)
          .order('created_at', { ascending: false })
          .limit(200)
          .abortSignal(AbortSignal.timeout(8000));
        if (cancelled) return;
        if (error) {
          setRows([]);
          setNotice(isMissingJobsTable(error) ? 'missing' : 'load');
        } else {
          setRows((data || []) as JobRow[]);
          setNotice('');
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setNotice('load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => filterJobs(rows, filters), [rows, filters]);
  const filtersOn = Boolean(filters.query || filters.side || filters.job_type || filters.remote || filters.showFilled);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">{t('Job board')}</h1>
            <p className="text-[var(--text3)]">
              {t('Full-time, part-time, contract, and one-off subcontract call-outs. Employers and people looking for work can both post.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/marketplace/jobs/mine" className="btn btn-secondary whitespace-nowrap">
              {t('My job posts')}
            </Link>
            <Link href="/marketplace/jobs/new" className="btn btn-primary whitespace-nowrap">
              {t('Post a job')}
            </Link>
          </div>
        </div>

        <p className="text-sm text-[var(--text3)] mb-4">{t('Job posts are free during soft beta.')}</p>

        <div className="card p-4 md:p-5 mb-6 text-left">
          <label className="label" htmlFor="job-search">{t('Search job posts')}</label>
          <input
            id="job-search"
            className="input mb-4"
            type="search"
            value={filters.query || ''}
            onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="job-filter-side">{t('Who is posting')}</label>
              <select
                id="job-filter-side"
                className="input"
                value={filters.side || ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, side: event.target.value }))}
              >
                <option value="">{t('All sides')}</option>
                {JOB_SIDES.map((side) => (
                  <option key={side} value={side}>{jobSideLabel(side, t)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="job-filter-type">{t('Job type')}</label>
              <select
                id="job-filter-type"
                className="input"
                value={filters.job_type || ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, job_type: event.target.value }))}
              >
                <option value="">{t('All job types')}</option>
                {JOB_TYPES.map((type) => (
                  <option key={type} value={type}>{jobTypeLabel(type, t)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="job-filter-place">{t('Location')}</label>
              <select
                id="job-filter-place"
                className="input"
                value={filters.remote || ''}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, remote: event.target.value as JobBoardFilters['remote'] }))
                }
              >
                <option value="">{t('All workplaces')}</option>
                <option value="remote">{t('Remote work')}</option>
                <option value="onsite">{t('On-site')}</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(filters.showFilled)}
                onChange={(event) => setFilters((prev) => ({ ...prev, showFilled: event.target.checked }))}
              />
              {t('Show filled posts')}
            </label>
            {filtersOn ? (
              <button type="button" className="btn btn-secondary text-sm py-1 px-3" onClick={() => setFilters(EMPTY_FILTERS)}>
                {t('Clear job filters')}
              </button>
            ) : null}
          </div>
          <p className="text-xs text-[var(--text3)] mt-3">{t('Filled posts stay on the board without contact details.')}</p>
        </div>

        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading job posts…')}</div>
        ) : notice ? (
          <div className="card p-8 text-center text-[var(--text3)]">
            {notice === 'missing' ? t('Job board is not available yet.') : t('Could not load job posts.')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-lg">{rows.length === 0 ? t('No job posts yet.') : t('No job posts match these filters.')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((job) => (
              <article key={job.id} className="card p-6 text-left flex flex-col">
                <div className="flex flex-wrap gap-2 mb-2 text-[10px] font-semibold uppercase tracking-wide">
                  <span className="px-1.5 py-0.5 rounded-full bg-[var(--gold)] text-black">{jobSideLabel(job.side, t)}</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[var(--surface3)]">{jobTypeLabel(job.job_type, t)}</span>
                  {job.status === 'filled' ? (
                    <span className="px-1.5 py-0.5 rounded-full bg-[var(--surface3)]">{jobStatusLabel(job.status, t)}</span>
                  ) : null}
                  {job.remote ? (
                    <span className="px-1.5 py-0.5 rounded-full bg-[var(--surface3)]">{t('Remote work')}</span>
                  ) : null}
                </div>
                <Link href={jobDetailPath(job.id || '')} className="font-bold text-xl mb-1 hover:text-[var(--gold)]">
                  {job.title}
                </Link>
                <ListingDescriptionSnippet text={job.description} className="mb-2" />
                <JobPlace job={job} />
                {job.compensation ? <p className="text-sm mt-2">{job.compensation}</p> : null}
                {job.equipment || job.modality ? (
                  <p className="text-sm text-[var(--text3)] mt-1">
                    {[job.equipment, job.modality].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
                <Link href={jobDetailPath(job.id || '')} className="btn btn-primary w-full text-sm mt-4">
                  {t('View job post')}
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobPlace({ job }: { job: JobRow }) {
  const t = useT();
  const loc = [job.city, job.state].filter(Boolean).join(', ') || job.location || '';
  const bits = [loc, job.remote ? t('Remote work') : '', job.service_area || ''].filter(Boolean);
  if (!bits.length) return null;
  return <p className="text-sm text-[var(--text3)]">{bits.join(' · ')}</p>;
}
