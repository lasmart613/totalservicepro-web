import React, { Suspense } from 'react';
import PurchaseOrderFormClient from './PurchaseOrderFormClient';

export default function NewPurchaseOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-2xl mb-2">Loading purchase order…</div>
            <div className="text-sm text-[var(--text3)]">Preparing suppliers and line items</div>
          </div>
        </div>
      }
    >
      <PurchaseOrderFormClient />
    </Suspense>
  );
}
