import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import EstimateCustomerClient from './EstimateCustomerClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Review estimate · Total Service Pro',
  description: 'Approve this service estimate. Your clinic account is required.',
  robots: { index: false, follow: false },
};

export default async function EstimateCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }> | { id: string };
  searchParams?: Promise<{ changes?: string }> | { changes?: string };
}) {
  const raw = await Promise.resolve(params);
  const query = searchParams ? await Promise.resolve(searchParams) : {};
  const estimateId = String(raw?.id || '').trim();
  const wantChanges = String(query?.changes || '') === '1';

  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center text-[var(--text3)]">
          Loading estimate…
        </div>
      }
    >
      <EstimateCustomerClient estimateId={estimateId} wantChanges={wantChanges} />
    </Suspense>
  );
}
