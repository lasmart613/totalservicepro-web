import React from 'react';
import type { Metadata } from 'next';
import EstimateActionClient from './EstimateActionClient';
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
  params: Promise<{ token: string }> | { token: string };
  searchParams?: Promise<{ action?: string; changes?: string; done?: string; notice?: string }> | {
    action?: string;
    changes?: string;
    done?: string;
    notice?: string;
  };
}) {
  const raw = await Promise.resolve(params);
  const query = searchParams ? await Promise.resolve(searchParams) : {};
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
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="text-[var(--gold)] font-extrabold tracking-wide text-sm uppercase">RepairPlanet</div>
        <h1 className="text-xl font-extrabold mb-2 mt-3">
          {loaded.message.includes('temporarily unavailable') ? 'Temporarily unavailable' : 'Link not valid'}
        </h1>
        <p className="text-sm text-[var(--text2)] max-w-md">{loaded.message}</p>
      </div>
    );
  }

  return (
    <EstimateActionClient
      token={token}
      confirm={loaded.confirm}
      estimate={loaded.estimate}
      requested={requested}
      justCompleted={justCompleted}
      notice={notice}
    />
  );
}
