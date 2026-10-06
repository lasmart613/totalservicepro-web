import React, { Suspense } from 'react';
import PurchaseOrderFormClient, { PurchaseOrderPageFallback } from './PurchaseOrderFormClient';

export default function NewPurchaseOrderPage() {
  return (
    <Suspense fallback={<PurchaseOrderPageFallback />}>
      <PurchaseOrderFormClient />
    </Suspense>
  );
}
