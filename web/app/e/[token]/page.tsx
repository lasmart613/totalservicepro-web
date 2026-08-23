import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import EstimateActionClient from './EstimateActionClient';
import { findEstimateByActionToken, isValidEstimateActionToken } from '@/lib/billing/estimate-action';
import { estimateCustomerPath } from '@/lib/share';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Review estimate · Total Service Pro',
  description: 'Approve this service estimate. Sign in with your clinic account.',
  robots: { index: false, follow: false },
};

export default async function EstimateActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }> | { token: string };
  searchParams?: Promise<{ changes?: string }> | { changes?: string };
}) {
  const raw = await Promise.resolve(params);
  const query = searchParams ? await Promise.resolve(searchParams) : {};
  const token = String(raw?.token || '').trim();
  const wantChanges = String(query?.changes || '') === '1';

  let redirectTo: string | null = null;
  if (hasServiceRole() && isValidEstimateActionToken(token)) {
    try {
      const est = await findEstimateByActionToken(getSupabaseAdmin(), token);
      if (est?.id != null) {
        redirectTo = estimateCustomerPath(est.id, { changes: wantChanges });
      }
    } catch {
      /* fall through to client lookup */
    }
  }
  if (redirectTo) redirect(redirectTo);

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
