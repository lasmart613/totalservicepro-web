'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';

type ReceiptState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed'; message: string }
  | {
      status: 'ok';
      planLabel: string;
      amountLabel: string | null;
      organizationName: string | null;
      stripeReceiptUrl: string | null;
    };

function ReceiptBody() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<ReceiptState>({ status: 'loading' });

  useEffect(() => {
    const sessionId = searchParams.get('session_id') || searchParams.get('sessionId');
    if (!sessionId) {
      setState({ status: 'missing' });
      return;
    }

    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await getSupabaseClient().auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (!cancelled) {
          setState({
            status: 'failed',
            message: 'Still signed in? Refresh to finish this confirmation. You were not shown a fake receipt.',
          });
        }
        return;
      }

      const res = await fetch('/api/billing/upgrade/confirm', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        planLabel?: string;
        amountLabel?: string | null;
        organizationName?: string | null;
        stripeReceiptUrl?: string | null;
        existingOrganizationUpgraded?: boolean;
      };
      if (cancelled) return;
      if (!res.ok) {
        const syncRes = await fetch('/api/billing/upgrade/sync', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        const syncJson = (await syncRes.json().catch(() => ({}))) as {
          applied?: boolean;
          planLabel?: string;
          amountLabel?: string | null;
          organizationName?: string | null;
          stripeReceiptUrl?: string | null;
        };
        if (!cancelled && syncRes.ok && syncJson.applied) {
          setState({
            status: 'ok',
            planLabel: syncJson.planLabel || 'Paid plan',
            amountLabel: syncJson.amountLabel || null,
            organizationName: syncJson.organizationName || null,
            stripeReceiptUrl: syncJson.stripeReceiptUrl || null,
          });
          return;
        }
        setState({
          status: 'failed',
          message: json?.error || 'Checkout was not completed. You were not charged.',
        });
        return;
      }
      setState({
        status: 'ok',
        planLabel: json.planLabel || 'Paid plan',
        amountLabel: json.amountLabel || null,
        organizationName: json.organizationName || null,
        stripeReceiptUrl: json.stripeReceiptUrl || null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    if (state.status === 'missing') {
      router.replace('/plans');
    }
  }, [state, router]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-xl mx-auto w-full px-4 py-10">
        {state.status === 'loading' || state.status === 'missing' ? (
          <p className="text-[var(--text3)]">Confirming checkout…</p>
        ) : null}

        {state.status === 'failed' ? (
          <div className="card p-6 space-y-4">
            <h1 className="text-2xl font-extrabold tracking-tight">Checkout not completed</h1>
            <p className="text-[var(--text2)]">{state.message}</p>
            <p className="text-sm text-[var(--text3)]">
              Cancel and failed payments return here without claiming success. You were not charged
              for an unfinished checkout.
            </p>
            <Link href="/plans" className="btn btn-primary inline-flex">
              Back to plans
            </Link>
          </div>
        ) : null}

        {state.status === 'ok' ? (
          <div className="card p-6 space-y-4 border-[var(--gold-border)]">
            <p className="text-xs uppercase tracking-wide text-[var(--gold)] font-semibold">
              Payment confirmed
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">Receipt</h1>
            <p className="text-[var(--text2)]">
              {state.organizationName
                ? `${state.organizationName} was upgraded on this existing organization.`
                : 'Your existing organization was upgraded.'}{' '}
              No new account was created.
            </p>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text3)]">Plan</dt>
                <dd className="font-semibold">{state.planLabel}</dd>
              </div>
              {state.amountLabel ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--text3)]">Amount</dt>
                  <dd className="font-semibold">{state.amountLabel}</dd>
                </div>
              ) : null}
            </dl>
            {state.stripeReceiptUrl ? (
              <a
                href={state.stripeReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary w-full text-center"
              >
                View Stripe receipt
              </a>
            ) : (
              <p className="text-xs text-[var(--text3)]">
                Stripe did not return a receipt or invoice URL for this session, so no receipt
                number is shown.
              </p>
            )}
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/" className="btn btn-primary">
                Dashboard
              </Link>
              <Link href="/plans" className="btn btn-secondary">
                Plans
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CheckoutReceiptPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col">
          <Header />
          <div className="max-w-xl mx-auto w-full px-4 py-10 text-[var(--text3)]">
            Confirming checkout…
          </div>
        </div>
      }
    >
      <ReceiptBody />
    </Suspense>
  );
}
