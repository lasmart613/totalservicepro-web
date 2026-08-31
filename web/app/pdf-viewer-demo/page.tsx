'use client';

import React from 'react';
import { ManualPdfViewer } from '@/components/ManualPdfViewer';
import { MANUAL_FIXTURE_PATH } from '@/lib/manuals';

/**
 * QA-only viewer that loads the in-repo 3-page fixture.
 * No live org, no entitlements, no customer manuals.
 */
export default function PdfViewerDemoPage() {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0d1117]">
      <ManualPdfViewer
        title="Sample service manual (3-page fixture)"
        sourceUrl={MANUAL_FIXTURE_PATH}
      />
    </div>
  );
}
