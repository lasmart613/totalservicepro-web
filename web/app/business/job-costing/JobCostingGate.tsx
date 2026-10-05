'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { JOB_COSTING_API, JOB_COSTING_PATH } from '@/lib/job-costing-access';
import type { JobCostReport } from '@/lib/job-costing';
import { ReportUpgradeLock } from '@/components/ReportUpgradeLock';
import { JobCostingView } from './JobCostingView';
import { useT } from '@/lib/fa/locale';

function isReport(value: unknown): value is JobCostReport {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as JobCostReport).jobs));
}

/**
 * Sends the localStorage session to the server. The report renders only when
 * that request authorizes the caller. A 403 renders no figures.
 */
export function JobCostingGate() {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<'checking' | 'denied' | 'upgrade' | 'error' | 'ready'>('checking');
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<JobCostReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace(`/login?next=${encodeURIComponent(JOB_COSTING_PATH)}`);
        return;
      }

      const res = await fetch(JOB_COSTING_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (cancelled) return;

      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(JOB_COSTING_PATH)}`);
        return;
      }
      if (res.status === 403) {
        setMessage(typeof json?.error === 'string' ? json.error : 'Admin access required');
        setPhase('denied');
        return;
      }
      if (res.status === 402) {
        setPhase('upgrade');
        return;
      }
      if (!res.ok || !isReport(json)) {
        setMessage(typeof json?.error === 'string' ? json.error : 'Job costing could not be loaded');
        setPhase('error');
        return;
      }

      setReport(json);
      setPhase('ready');
    })().catch(() => {
      if (!cancelled) {
        setMessage('Job costing could not be loaded');
        setPhase('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (phase === 'ready' && report) {
    return <JobCostingView report={report} />;
  }

  if (phase === 'upgrade') {
    return (
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <h1 className="text-2xl font-extrabold">{t('Job Costing')}</h1>
        <ReportUpgradeLock feature="Job Costing" sections={['Repair orders', 'Labor cost', 'Parts and materials', 'Margin']} />
      </div>
    );
  }

  if (phase === 'denied') {
    return (
      <div className="max-w-lg mx-auto w-full px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold mb-2">{t('Admin access required')}</h1>
        <p className="text-sm text-[var(--text3)] mb-6">
          {t('Job Costing is limited to organization admins and existing God access.')} {t(message)}
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/" className="btn btn-primary">
            {t('Dashboard')}
          </Link>
          <Link href="/company" className="btn btn-secondary">
            {t('Company Profile')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center text-[var(--text3)] px-4 py-16 text-center">
      {phase === 'error' ? t(message) : t('Checking access…')}
    </div>
  );
}
