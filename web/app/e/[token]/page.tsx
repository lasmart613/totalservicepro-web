import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import EstimateActionClient from './EstimateActionClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Review estimate · Total Service Pro',
  description: 'Approve this service estimate or request changes — no account required.',
  robots: { index: false, follow: false },
};

export default async function EstimateActionPage({
  params,
}: {
  params: Promise<{ token: string }> | { token: string };
}) {
  const raw = await Promise.resolve(params);
  const token = String(raw?.token || '').trim();

  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center text-[var(--text3)]">
          Loading estimate…
        </div>
      }
    >
      <EstimateActionClient token={token} />
    </Suspense>
  );
}
