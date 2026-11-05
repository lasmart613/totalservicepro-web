'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useT } from '@/lib/fa/locale';
import { Header } from '@/components/Header';
import { emptyJobForm, JobPostForm, type JobFormValues } from '@/components/marketplace/JobPostForm';
import { translateJobError } from '@/components/marketplace/job-labels';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { loadJobComposer } from '@/lib/marketplace/job-composer';
import { buildJobInsert, jobDetailPath, type JobActor } from '@/lib/marketplace/jobs';

export default function NewJobPage() {
  const t = useT();
  const router = useRouter();
  const [actor, setActor] = useState<JobActor | null>(null);
  const [initial, setInitial] = useState<JobFormValues | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const composer = await loadJobComposer();
      if (cancelled || !composer) return;
      const prefill = composer.prefill;
      const hasOrg = prefill.organization_id != null || (composer.actor.membershipOrgIds || []).length > 0;
      setActor(composer.actor);
      setOrganizationName(prefill.organization_name);
      setInitial(
        emptyJobForm({
          side: hasOrg ? 'hiring' : 'looking',
          post_as_org: false,
          organization_id: prefill.organization_id,
          contact_name: prefill.contact_name,
          contact_email: prefill.contact_email,
          contact_phone: prefill.contact_phone,
          city: prefill.city,
          state: prefill.state,
          location: prefill.location,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasOrganization = Boolean(
    initial?.organization_id != null || (actor?.membershipOrgIds || []).some((id) => id != null),
  );

  const submit = async (values: JobFormValues) => {
    if (!actor) {
      toast.error(t('Sign in required.'));
      return;
    }
    const built = buildJobInsert(values, actor);
    if (!built.ok) {
      toast.error(translateJobError(built.error, t));
      return;
    }
    setSaving(true);
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch('/api/marketplace/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify(values),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(translateJobError(String(json?.error || ''), t));
        return;
      }
      toast.success(t('Job post saved.'));
      const id = json?.job?.id ? String(json.job.id) : '';
      router.push(id ? jobDetailPath(id) : '/marketplace/jobs');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace/jobs" className="text-sm text-[var(--gold)] hover:underline">
          {t('Back to job board')}
        </Link>
        <h1 className="text-3xl font-extrabold mt-3 mb-4">{t('Post a job')}</h1>
        {initial ? (
          <JobPostForm
            initial={initial}
            organizationName={organizationName}
            hasOrganization={hasOrganization}
            saving={saving}
            submitLabel={t('Post a job')}
            onSubmit={submit}
          />
        ) : (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading job posts…')}</div>
        )}
      </div>
    </div>
  );
}
