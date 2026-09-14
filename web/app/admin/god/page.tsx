'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchGodMe } from '@/lib/god-client';
import { GodKpiBoard } from '@/components/god/GodKpiBoard';
import { GodAnalyticsBoard } from '@/components/god/GodAnalyticsBoard';
import { GodComplimentaryPremium } from '@/components/god/GodComplimentaryPremium';
import { GodEmailBlast } from '@/components/god/GodEmailBlast';
import { GOD_ANALYTICS_PATH } from '@/lib/god-tables';

export default function GodDashboardPage() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const god = await fetchGodMe();
      if (cancelled) return;
      setAllowed(Boolean(god));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <div className="text-[var(--text3)]">Loading God dashboard…</div>;
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

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">God Dashboard</h1>
      <p className="text-[var(--text3)] mb-4 max-w-3xl">
        Every organization and user. Send a locked Email blast (clinic invite or shop invite) only to
        the orgs you check. Nothing is selected by default. This is not a Stripe plan.{' '}
        <Link href="/admin/god/manuals" className="text-[var(--gold)] hover:underline">
          Manuals catalog
        </Link>{' '}
        attaches PDFs to Laser / Lithotriptor / C-arm rooms.
      </p>
      <p className="text-sm text-[var(--text3)] mb-6 max-w-3xl">
        Need a row that is not an org invite? Use{' '}
        <Link href={GOD_ANALYTICS_PATH} className="text-[var(--gold)] hover:underline">
          Analytics
        </Link>
        ,{' '}
        <Link href="/admin/god/crm" className="text-[var(--gold)] hover:underline">
          CRM
        </Link>
        ,{' '}
        <Link href="/admin/god/tables" className="text-[var(--gold)] hover:underline">
          Tables
        </Link>
        ,{' '}
        <Link href="/admin/god/equipment" className="text-[var(--gold)] hover:underline">
          Equipment
        </Link>
        ,{' '}
        <Link href="/admin/god/users" className="text-[var(--gold)] hover:underline">
          Users
        </Link>
        , or{' '}
        <Link href="/admin/god/auth" className="text-[var(--gold)] hover:underline">
          Auth / Users
        </Link>
        .
      </p>

      <GodKpiBoard />
      <GodAnalyticsBoard variant="teaser" />

      <GodComplimentaryPremium />
      <GodEmailBlast />
    </div>
  );
}
