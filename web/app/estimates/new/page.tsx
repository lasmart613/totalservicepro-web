import React, { Suspense } from 'react';
import EstimateFormClient from './EstimateFormClient';

export default function NewEstimatePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-2xl mb-2">Loading estimate form…</div>
            <div className="text-sm text-[var(--text3)]">
              Preparing customer, equipment, and pricing fields
            </div>
          </div>
        </div>
      }
    >
      <EstimateFormClient />
    </Suspense>
  );
}
