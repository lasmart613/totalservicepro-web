'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { VOIDED_INVOICE_MESSAGE } from '@/lib/billing/void-invoice';

function PayInvoiceInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const invoiceId = String(params?.id || '');
  const session = search.get('session') || '';
  const [message, setMessage] = useState('Opening invoice…');
  const [voided, setVoided] = useState(false);

  useEffect(() => {
    if (!invoiceId) return;
    let gone = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ id: invoiceId });
        if (session) qs.set('session', session);
        const res = await fetch('/api/billing/invoices/pay-status?' + qs.toString());
        const json = await res.json().catch(() => ({}));
        if (gone) return;
        if (json.voided) {
          setVoided(true);
          setMessage(VOIDED_INVOICE_MESSAGE);
          return;
        }
        if (json.payable && typeof json.paymentUrl === 'string' && json.paymentUrl) {
          window.location.assign(json.paymentUrl);
          return;
        }
        setMessage(typeof json.message === 'string' ? json.message : 'This invoice cannot be paid from this link.');
      } catch {
        if (!gone) setMessage('This invoice cannot be paid from this link.');
      }
    })();
    return () => {
      gone = true;
    };
  }, [invoiceId, session]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-8 max-w-md w-full text-center hover:transform-none">
        <h1 className="text-2xl font-extrabold mb-2">{voided ? 'Invoice voided' : 'Invoice payment'}</h1>
        <p className="text-[var(--text3)]">{message}</p>
        <Link href="/" className="btn btn-secondary mt-6 inline-block">
          Done
        </Link>
      </div>
    </div>
  );
}

export default function PayInvoicePage() {
  return (
    <Suspense fallback={<div className="min-h-screen p-8 text-[var(--text3)]">Opening invoice…</div>}>
      <PayInvoiceInner />
    </Suspense>
  );
}
