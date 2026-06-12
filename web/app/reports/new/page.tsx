import React, { Suspense } from 'react';
import NewServiceReportClient from './NewServiceReportClient';

// Server wrapper to provide Suspense boundary for useSearchParams() in the client component.
// This prevents the "useSearchParams() should be wrapped in a suspense boundary" build error.
export default function NewServiceReportPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl mb-2">Loading service report form...</div>
          <div className="text-sm text-[var(--text3)]">Preparing dynamic model-specific fields, checklists, and performance tables</div>
        </div>
      </div>
    }>
      <NewServiceReportClient />
    </Suspense>
  );
}
