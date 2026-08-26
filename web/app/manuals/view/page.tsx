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
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <Header />
      <Suspense fallback={<div className="p-8 text-center text-[var(--text3)]">Opening manual…</div>}>
        <ManualViewInner />
      </Suspense>
    </div>
  );
}
