'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useT } from '@/lib/fa/locale';
import { Header } from '@/components/Header';
import { ListingDescription } from '@/components/ListingDescription';
import { jobSideLabel, jobStatusLabel, jobTypeLabel } from '@/components/marketplace/job-labels';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useSignedIn } from '@/lib/use-signed-in';
import { loginHref } from '@/lib/login-next';
import {
  JOB_PUBLIC_SELECT,
  canManageJob,
  isMissingJobsTable,
  jobEditPath,
  type JobRow,
} from '@/lib/marketplace/jobs';

type Contact = { contact_name?: string | null; contact_email?: string | null; contact_phone?: string | null };

export default function JobDetailPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const { signedIn } = useSignedIn();
  const [job, setJob] = useState<JobRow | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<'missing' | 'missing-row' | 'load' | ''>('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('marketplace_jobs')
        .select(JOB_PUBLIC_SELECT)
        .eq('id', id)
        .abortSignal(AbortSignal.timeout(8000))
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setJob(null);
        setNotice(isMissingJobsTable(error) ? 'missing' : 'load');
        setLoading(false);
        return;
      }
      if (!data) {
        setJob(null);
        setNotice('missing-row');
        setLoading(false);
        return;
      }
      const row = data as JobRow;
      setJob(row);
      setNotice('');
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle();
        const { data: memberships } = await supabase
          .from('organization_memberships')
          .select('organization_id')
          .eq('user_id', user.id);
        setCanManage(
          canManageJob(row, {
            userId: user.id,
            orgId: profile?.organization_id ?? null,
            membershipOrgIds: (memberships || []).map((item) => item.organization_id),
          }),
        );
        const rpc = await supabase.rpc('marketplace_job_contact', { p_id: id });
        if (!rpc.error && rpc.data && typeof rpc.data === 'object') {
          setContact(rpc.data as Contact);
        } else {
          setContact(null);
        }
      } else {
        setCanManage(false);
        setContact(null);
      }
      } catch {
        if (!cancelled) {
          setJob(null);
          setNotice('load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, signedIn]);

  const message =
    notice === 'missing'
      ? t('Job board is not available yet.')
      : notice === 'load'
        ? t('Could not load job posts.')
        : t('Job post not found.');

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace/jobs" className="text-sm text-[var(--gold)] hover:underline">
          {t('Back to job board')}
        </Link>
        <h1 className="text-3xl font-extrabold mt-3 mb-4">{job?.title || t('Job board')}</h1>
        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading job posts…')}</div>
        ) : !job ? (
          <div className="card p-8 text-center text-[var(--text3)]">{message}</div>
        ) : (
          <article className="card p-6 text-left">
            <div className="flex flex-wrap gap-2 mb-4 text-[10px] font-semibold uppercase tracking-wide">
              <span className="px-1.5 py-0.5 rounded-full bg-[var(--gold)] text-black">{jobSideLabel(job.side, t)}</span>
              <span className="px-1.5 py-0.5 rounded-full bg-[var(--surface3)]">{jobTypeLabel(job.job_type, t)}</span>
              <span className="px-1.5 py-0.5 rounded-full bg-[var(--surface3)]">{jobStatusLabel(job.status, t)}</span>
              {job.remote ? (
                <span className="px-1.5 py-0.5 rounded-full bg-[var(--surface3)]">{t('Remote work')}</span>
              ) : null}
            </div>
            <ListingDescription text={job.description} />
            <dl className="mt-4 space-y-2 text-sm">
              <Place job={job} />
              {job.service_area ? (
                <div>
                  <dt className="text-[var(--text3)]">{t('Service area')}</dt>
                  <dd>{job.service_area}</dd>
                </div>
              ) : null}
              {job.compensation ? (
                <div>
                  <dt className="text-[var(--text3)]">{t('Compensation (optional)')}</dt>
                  <dd>{job.compensation}</dd>
                </div>
              ) : null}
              {job.equipment ? (
                <div>
                  <dt className="text-[var(--text3)]">{t('Equipment (optional)')}</dt>
                  <dd>{job.equipment}</dd>
                </div>
              ) : null}
              {job.modality ? (
                <div>
                  <dt className="text-[var(--text3)]">{t('Modality (optional)')}</dt>
                  <dd>{job.modality}</dd>
                </div>
              ) : null}
            </dl>
            <section className="mt-6 border-t border-[var(--surface3)] pt-4">
              <h2 className="font-bold mb-2">{t('How to apply')}</h2>
              {!signedIn ? (
                <p className="text-sm">
                  <Link href={loginHref(`/marketplace/jobs/${id}`)} className="text-[var(--gold)] hover:underline">
                    {t('Sign in to see contact details.')}
                  </Link>
                </p>
              ) : contact?.contact_email || contact?.contact_phone || contact?.contact_name || job.contact_name ? (
                <div className="text-sm space-y-1">
                  {(contact?.contact_name || job.contact_name) ? <p>{contact?.contact_name || job.contact_name}</p> : null}
                  {contact?.contact_email ? <p>{contact.contact_email}</p> : null}
                  {contact?.contact_phone ? <p>{contact.contact_phone}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-[var(--text3)]">{t('Filled posts stay on the board without contact details.')}</p>
              )}
            </section>
            {canManage ? (
              <Link href={jobEditPath(id)} className="btn btn-secondary mt-6">
                {t('Edit job post')}
              </Link>
            ) : null}
            <p className="text-xs text-[var(--text3)] mt-6">{t('Job posts are free during soft beta.')}</p>
          </article>
        )}
      </div>
    </div>
  );
}

function Place({ job }: { job: JobRow }) {
  const t = useT();
  const loc = [job.city, job.state].filter(Boolean).join(', ') || job.location || '';
  if (!loc && !job.remote) return null;
  return (
    <div>
      <dt className="text-[var(--text3)]">{t('Location')}</dt>
      <dd>{[loc, job.remote ? t('Remote work') : ''].filter(Boolean).join(' · ')}</dd>
    </div>
  );
}
