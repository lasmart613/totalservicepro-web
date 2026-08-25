'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function InvoicePaidInner() {
  const params = useSearchParams();
  const sessionId = params.get('session_id') || '';
  const canceled = params.get('canceled') === '1';
  const [state, setState] = useState<'loading' | 'ok' | 'err' | 'canceled'>(
    canceled ? 'canceled' : 'loading'
  );
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (canceled || !sessionId) {
      if (!canceled && !sessionId) setState('err');
      return;
    }
    let gone = false;
    (async () => {
      try {
        const res = await fetch('/api/billing/invoices/confirm?session_id=' + encodeURIComponent(sessionId));
        const json = await res.json().catch(() => ({}));
        if (gone) return;
        if (json.ok) {
          setStatus(String(json.status || 'paid'));
          setState('ok');
        } else setState('err');
      } catch {
        if (!gone) setState('err');
      }
    })();
    return () => {
      gone = true;
    };
  }, [sessionId, canceled]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-8 max-w-md w-full text-center hover:transform-none">
        {state === 'canceled' ? (
          <>
            <h1 className="text-2xl font-extrabold mb-2">Payment canceled</h1>
            <p className="text-[var(--text3)]">No charge was made. You can close this page.</p>
          </>
        ) : state === 'loading' ? (
          <p className="text-[var(--text3)]">Confirming your payment…</p>
        ) : state === 'ok' ? (
          <>
            <h1 className="text-2xl font-extrabold text-[var(--gold)] mb-2">Thank you</h1>
            <p className="text-[var(--text3)]">
              {status === 'partially_paid'
                ? 'Your partial payment was received. The shop has been notified.'
                : 'Your payment was received. The shop has been notified.'}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold mb-2">Payment received</h1>
            <p className="text-[var(--text3)]">
              If you were charged, the shop will see it shortly. You can close this page.
            </p>
          </>
        )}
        <Link href="/" className="btn btn-secondary mt-6 inline-block">
          Done
        </Link>
      </div>
    </div>
  );
}

export default function InvoicePaidPage() {
  return (
    <Suspense fallback={<div className="min-h-screen p-8 text-[var(--text3)]">Loading…</div>}>
      <InvoicePaidInner />
    </Suspense>
  );
}
