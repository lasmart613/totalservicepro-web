'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useT } from '@/lib/fa/locale';
import { Header } from '@/components/Header';
import { emptyJobForm, JobPostForm, type JobFormValues } from '@/components/marketplace/JobPostForm';
import { translateJobError } from '@/components/marketplace/job-labels';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { loadJobComposer } from '@/lib/marketplace/job-composer';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  JOB_PUBLIC_SELECT,
  buildJobUpdate,
  canManageJob,
  isJobSide,
  isJobType,
  isMissingJobsTable,
  jobDetailPath,
  type JobActor,
  type JobRow,
} from '@/lib/marketplace/jobs';

export default function EditJobPage() {
  const t = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const [actor, setActor] = useState<JobActor | null>(null);
  const [initial, setInitial] = useState<JobFormValues | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [hasOrganization, setHasOrganization] = useState(false);
  const [existing, setExisting] = useState<JobRow | null>(null);
  const [notice, setNotice] = useState<'missing' | 'load' | 'denied' | ''>('');
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [status, setStatus] = useState<string>('open');
  const [contactLoaded, setContactLoaded] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const [composer, loaded] = await Promise.all([
        loadJobComposer(),
        supabase.from('marketplace_jobs').select(JOB_PUBLIC_SELECT).eq('id', id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (!composer) return;
      if (loaded.error) {
        setNotice(isMissingJobsTable(loaded.error) ? 'missing' : 'load');
        return;
      }
      const row = loaded.data as JobRow | null;
      if (!row || !canManageJob(row, composer.actor)) {
        setNotice('denied');
        return;
      }
      const rpc = await supabase.rpc('marketplace_job_contact', { p_id: id });
      const contact =
        !rpc.error && rpc.data && typeof rpc.data === 'object'
          ? (rpc.data as { contact_name?: string | null; contact_email?: string | null; contact_phone?: string | null })
          : null;
      setContactLoaded(!rpc.error);
      if (cancelled) return;
      setExisting(row);
      setActor(composer.actor);
      setOrganizationName(composer.prefill.organization_name);
      setHasOrganization(
        composer.prefill.organization_id != null || (composer.actor.membershipOrgIds || []).some((orgId) => orgId != null),
      );
      setStatus(String(row.status || 'open'));
      setInitial(
        emptyJobForm({
          side: isJobSide(row.side) ? row.side : 'hiring',
          job_type: isJobType(row.job_type) ? row.job_type : 'full_time',
          title: row.title || '',
          description: row.description || '',
          city: row.city || '',
          state: row.state || '',
          location: row.location || '',
          remote: Boolean(row.remote),
          service_area: row.service_area || '',
          compensation: row.compensation || '',
          equipment: row.equipment || '',
          modality: row.modality || '',
          contact_name: contact?.contact_name || row.contact_name || '',
          contact_email: contact?.contact_email || '',
          contact_phone: contact?.contact_phone || '',
          post_as_org: row.organization_id != null,
          organization_id: row.organization_id ?? composer.prefill.organization_id,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const submit = async (values: JobFormValues) => {
    if (!actor || !existing) {
      toast.error(t('Sign in required.'));
      return;
    }
    const built = buildJobUpdate(existing, values, actor);
    if (!built.ok) {
      toast.error(translateJobError(built.error, t));
      return;
    }
    setSaving(true);
    try {
      const headers = await marketplaceAuthHeaders();
      const body: Record<string, unknown> = { ...values, status };
      if (!contactLoaded && !values.contact_email) delete body.contact_email;
      if (!contactLoaded && !values.contact_phone) delete body.contact_phone;
      const res = await fetch(`/api/marketplace/jobs/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(translateJobError(String(json?.error || ''), t));
        return;
      }
      toast.success(t('Job post updated.'));
      router.push(jobDetailPath(id));
    } finally {
      setSaving(false);
    }
  };

  const setJobStatus = async (next: 'open' | 'filled' | 'closed') => {
    setStatusBusy(true);
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch(`/api/marketplace/jobs/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(translateJobError(String(json?.error || ''), t));
        return;
      }
      setStatus(next);
      toast.success(t('Job post updated.'));
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <Link href={jobDetailPath(id)} className="text-sm text-[var(--gold)] hover:underline">
          {t('Back to job board')}
        </Link>
        <h1 className="text-3xl font-extrabold mt-3 mb-4">{t('Edit job post')}</h1>
        {notice ? (
          <div className="card p-8 text-center text-[var(--text3)]">
            {notice === 'missing'
              ? t('Job board is not available yet.')
              : notice === 'load'
                ? t('Could not load job posts.')
                : t('You do not have permission to edit this job post.')}
          </div>
        ) : initial ? (
          <>
            <JobPostForm
              initial={initial}
              organizationName={organizationName}
              hasOrganization={hasOrganization}
              saving={saving}
              submitLabel={t('Save job post')}
              onSubmit={submit}
            />
            <div className="flex flex-wrap gap-2 mt-4">
              {status !== 'filled' ? (
                <button type="button" className="btn btn-secondary" disabled={statusBusy} onClick={() => void setJobStatus('filled')}>
                  {t('Mark filled')}
                </button>
              ) : null}
              {status !== 'closed' ? (
                <button type="button" className="btn btn-secondary" disabled={statusBusy} onClick={() => void setJobStatus('closed')}>
                  {t('Close job post')}
                </button>
              ) : null}
              {status !== 'open' ? (
                <button type="button" className="btn btn-secondary" disabled={statusBusy} onClick={() => void setJobStatus('open')}>
                  {t('Reopen job post')}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading job posts…')}</div>
        )}
      </div>
    </div>
  );
}
