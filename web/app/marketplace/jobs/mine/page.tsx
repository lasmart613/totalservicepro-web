'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useT } from '@/lib/fa/locale';
import { Header } from '@/components/Header';
import { ListingDescriptionSnippet } from '@/components/ListingDescription';
import { jobSideLabel, jobStatusLabel, jobTypeLabel, translateJobError } from '@/components/marketplace/job-labels';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  JOB_PUBLIC_SELECT,
  isMissingJobsTable,
  jobDetailPath,
  jobEditPath,
  type JobRow,
} from '@/lib/marketplace/jobs';

export default function MyJobPostsPage() {
  const t = useT();
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<'missing' | 'load' | ''>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const supabase = getSupabaseClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRows([]);
        setNotice('');
        return;
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      const orgId = profile?.organization_id;
      const owned =
        orgId != null
          ? `created_by.eq.${user.id},organization_id.eq.${orgId}`
          : `created_by.eq.${user.id}`;
      const { data, error } = await supabase
        .from('marketplace_jobs')
        .select(JOB_PUBLIC_SELECT)
        .or(owned)
        .order('created_at', { ascending: false })
        .limit(200)
        .abortSignal(AbortSignal.timeout(8000));
      if (error) {
        setRows([]);
        setNotice(isMissingJobsTable(error) ? 'missing' : 'load');
      } else {
        setRows((data || []) as JobRow[]);
        setNotice('');
      }
    } catch {
      setRows([]);
      setNotice('load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setStatus = async (job: JobRow, status: 'open' | 'filled' | 'closed') => {
    if (!job.id) return;
    setBusyId(job.id);
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch(`/api/marketplace/jobs/${job.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(translateJobError(String(json?.error || ''), t));
        return;
      }
      toast.success(t('Job post updated.'));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-4xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">{t('My job posts')}</h1>
            <p className="text-sm text-[var(--text3)]">{t('Job posts are free during soft beta.')}</p>
          </div>
          <Link href="/marketplace/jobs/new" className="btn btn-primary whitespace-nowrap">
            {t('Post a job')}
          </Link>
        </div>
        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading job posts…')}</div>
        ) : notice ? (
          <div className="card p-8 text-center text-[var(--text3)]">
            {notice === 'missing' ? t('Job board is not available yet.') : t('Could not load job posts.')}
          </div>
        ) : rows.length === 0 ? (
          <div className="card p-8 text-center">{t('No job posts yet.')}</div>
        ) : (
          <ul className="space-y-4">
            {rows.map((job) => (
              <li key={job.id} className="card p-5 text-left">
                <div className="flex flex-wrap gap-2 mb-2 text-[10px] font-semibold uppercase tracking-wide">
                  <span className="px-1.5 py-0.5 rounded-full bg-[var(--gold)] text-black">{jobSideLabel(job.side, t)}</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[var(--surface3)]">{jobTypeLabel(job.job_type, t)}</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[var(--surface3)]">{jobStatusLabel(job.status, t)}</span>
                </div>
                <Link href={jobDetailPath(job.id || '')} className="font-bold text-lg hover:text-[var(--gold)]">
                  {job.title}
                </Link>
                <ListingDescriptionSnippet text={job.description} className="mt-1" />
                <div className="flex flex-wrap gap-2 mt-4">
                  <Link href={jobEditPath(job.id || '')} className="btn btn-secondary text-sm">
                    {t('Edit job post')}
                  </Link>
                  {job.status !== 'filled' ? (
                    <button
                      type="button"
                      className="btn btn-secondary text-sm"
                      disabled={busyId === job.id}
                      onClick={() => void setStatus(job, 'filled')}
                    >
                      {t('Mark filled')}
                    </button>
                  ) : null}
                  {job.status !== 'closed' ? (
                    <button
                      type="button"
                      className="btn btn-secondary text-sm"
                      disabled={busyId === job.id}
                      onClick={() => void setStatus(job, 'closed')}
                    >
                      {t('Close job post')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary text-sm"
                      disabled={busyId === job.id}
                      onClick={() => void setStatus(job, 'open')}
                    >
                      {t('Reopen job post')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
