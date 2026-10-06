import type { Metadata } from 'next';
import EstimateActionClient, { EstimateLinkFallback } from './EstimateActionClient';
import { loadPublicEstimateForToken } from '@/lib/billing/estimate-action';
import { parseCustomerActionKind, parseEstimateEmailAction } from '@/lib/billing/save-helpers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Review estimate · Total Service Pro' },
  description: 'Review this service estimate, then approve, reject, or request a modification.',
  robots: { index: false, follow: false },
};

function requestedFromQuery(query: { action?: string; changes?: string }) {
  const explicit = parseEstimateEmailAction(query.action);
  if (explicit) return explicit;
  if (String(query.changes || '') === '1') return 'modify' as const;
  return null;
}

export default async function EstimateActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ action?: string; changes?: string; done?: string; notice?: string }>;
}) {
  const raw = await params;
  const query = searchParams ? await searchParams : {};
  const token = String(raw?.token || '').trim();
  const requested = requestedFromQuery(query);
  const justCompleted = parseCustomerActionKind(query.done);
  const notice = String(query.notice || '');

  let loaded: Awaited<ReturnType<typeof loadPublicEstimateForToken>>;
  try {
    loaded = await loadPublicEstimateForToken(token);
  } catch (e) {
    console.error('estimate action page', e);
    loaded = {
      ok: false,
      message: 'This page is temporarily unavailable. Please contact the company that sent the estimate.',
    };
  }

  if (!loaded.ok) {
    return <EstimateLinkFallback message={loaded.message} />;
  }

  return (
    <EstimateActionClient
      token={token}
      confirms={loaded.confirms}
      estimate={loaded.estimate}
      requested={requested}
      justCompleted={justCompleted}
      notice={notice}
    />
  );
}
