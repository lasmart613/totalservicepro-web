'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { useParams } from 'next/navigation';

export default function ReportDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-6xl mx-auto p-6">
        <Link href="/reports" className="text-[var(--gold)]">← Back to list</Link>
        <h1 className="text-2xl font-bold mt-4 mb-2">Service Report {id}</h1>

        <div className="card p-6">
          <p className="mb-4">Full view / edit of report #{id}.</p>
          <p className="text-sm text-[var(--text3)]">The creation form at <Link href={`/reports/new?id=${id}`} className="text-[var(--gold)] underline">/reports/new?id={id}</Link> can be used to load and continue editing a draft (extend the new page with load logic for full parity).</p>

          <div className="mt-6">
            <Link href={`/reports/new?id=${id}`} className="btn btn-primary">Open in Editor</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
