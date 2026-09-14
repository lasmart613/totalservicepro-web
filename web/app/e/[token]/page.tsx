import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import EstimateActionClient from './EstimateActionClient';
import { isValidEstimateActionToken } from '@/lib/billing/estimate-action';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Review estimate · Total Service Pro' },
  description: 'Approve, reject, or request a modification on this service estimate.',
  robots: { index: false, follow: false },
};

export default async function EstimateActionPage({
  params,
}: {
  params: Promise<{ token: string }> | { token: string };
}) {
  const raw = await Promise.resolve(params);
  const token = String(raw?.token || '').trim();

  if (token && !isValidEstimateActionToken(token)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-xl font-extrabold mb-2">Link not valid</h1>
        <p className="text-sm text-[var(--text2)] max-w-md">
          This estimate link is invalid or expired. Please contact the company that sent the estimate.
        </p>
      </div>
    );
  }

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
