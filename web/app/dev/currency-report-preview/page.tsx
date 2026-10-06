import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CurrencyReportPreview } from './preview';

/** Local fixture screens for currency settings and report tiers. Hidden in production. */
export default function CurrencyReportPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={null}>
      <CurrencyReportPreview />
    </Suspense>
  );
}
