import React, { Suspense } from 'react';
import InvoiceFormClient from './InvoiceFormClient';

export default function NewInvoicePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-2xl mb-2">Loading invoice form…</div>
            <div className="text-sm text-[var(--text3)]">
              Preparing customer and line items
            </div>
          </div>
        </div>
      }
    >
      <InvoiceFormClient />
    </Suspense>
  );
}
