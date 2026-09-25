'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ManualPdfViewer } from '@/components/ManualPdfViewer';
import { MANUAL_FIXTURE_PATH } from '@/lib/manuals';

/**
 * QA-only viewer that loads the in-repo 3-page fixture.
 * No live org, no entitlements, no customer manuals.
 * Supports ?page=&section=&q= so citation deep-links can be click-tested.
 */
function PdfViewerDemoInner() {
  const params = useSearchParams();
  const requested = params.get('file') || '';
  const source =
    requested.startsWith('/fixtures/') && requested.endsWith('.pdf') && !requested.includes('..')
      ? requested
      : MANUAL_FIXTURE_PATH;
  const subscript = source.includes('co2re-subscript');
  return (
    <ManualPdfViewer
      title={subscript ? 'CO2RE subscript fixture' : 'Sample service manual (3-page fixture)'}
      sourceUrl={source}
      initialPage={params.get('page')}
      initialSection={params.get('section')}
      initialFind={params.get('q')}
    />
  );
}

export default function PdfViewerDemoPage() {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0d1117]">
      <Suspense fallback={<div className="p-8 text-center text-[#9CA3AF]">Opening fixture…</div>}>
        <PdfViewerDemoInner />
      </Suspense>
    </div>
  );
}
