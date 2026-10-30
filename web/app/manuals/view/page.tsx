'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { ManualPdfViewer } from '@/components/ManualPdfViewer';
import { citedPageFromHash } from '@/lib/pdf-viewer-page';

function ManualViewInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const title = params.get('title');
  const storagePath = params.get('storage_path');
  const [hashPage, setHashPage] = useState<string | null>(null);
  useEffect(() => {
    setHashPage(citedPageFromHash(window.location.hash) || null);
  }, []);
  const page = params.get('page') || params.get('p') || hashPage;
  const section = params.get('section') || params.get('s');
  const find = params.get('q') || params.get('find');
  return (
    <ManualPdfViewer
      manualId={id}
      title={title}
      storagePath={storagePath}
      initialPage={page}
      initialSection={section}
      initialFind={find}
      pageOutOfRange={params.get('oor') === '1'}
    />
  );
}

export default function ManualViewPage() {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0d1117] text-[#E5E7EB]">
      <Header />
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="p-8 text-center text-[var(--text3)]">Opening manual…</div>}>
          <ManualViewInner />
        </Suspense>
      </div>
    </div>
  );
}
