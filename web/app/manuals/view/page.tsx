'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { ManualPdfViewer } from '@/components/ManualPdfViewer';

function ManualViewInner() {
  const params = useSearchParams();
  const id = params.get('id');
  const title = params.get('title');
  const storagePath = params.get('storage_path');
  return <ManualPdfViewer manualId={id} title={title} storagePath={storagePath} />;
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
