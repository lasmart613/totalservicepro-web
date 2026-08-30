'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient, getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import {
  MANUAL_VIEW_STORAGE_KEY,
  PDFJS_CDN_VERSION,
  readManualView,
  type ManualChapter,
  type ManualViewPayload,
} from '@/lib/manuals';

type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer } | { url: string }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (opts: { scale: number }) => { width: number; height: number };
        render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
          promise: Promise<void>;
        };
      }>;
      destroy?: () => void;
    }>;
  };
};

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
  }
}

async function loadPdfJs(): Promise<PdfJsLib> {
  if (typeof window === 'undefined') throw new Error('PDF viewer is browser-only');
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-tsp-pdfjs]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load PDF viewer')));
      return;
    }
    const s = document.createElement('script');
    s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_CDN_VERSION}/pdf.min.js`;
    s.async = true;
    s.dataset.tspPdfjs = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the in-app PDF viewer'));
    document.head.appendChild(s);
  });
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('Could not load the in-app PDF viewer');
  lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_CDN_VERSION}/pdf.worker.min.js`;
  return lib;
}

async function fetchManualUrl(payload: Record<string, unknown>) {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const supabaseUrl = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!session?.access_token) throw new Error('Please log in first');
  const resp = await fetch(`${supabaseUrl}/functions/v1/get-manual-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
    body: JSON.stringify({
      ...payload,
      access_token: session.access_token,
    }),
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, any>;
  return { ok: resp.ok, status: resp.status, json, token: session.access_token };
}

async function fetchPdfBytes(opts: {
  token: string;
  manualId?: string | number | null;
  storagePath?: string | null;
  signedUrl?: string | null;
  dataBase64?: string | null;
}): Promise<ArrayBuffer> {
  if (opts.dataBase64) {
    const bin = atob(opts.dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  const res = await fetch('/api/manuals/file', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      manual_id: opts.manualId,
      storage_path: opts.storagePath,
    }),
  });
  if (res.ok) return await res.arrayBuffer();

  if (opts.signedUrl) {
    const direct = await fetch(opts.signedUrl);
    if (direct.ok) return await direct.arrayBuffer();
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(json.error || 'Could not load the manual in the app viewer');
}

export function ManualPdfViewer({
  manualId,
  title: titleFromQuery,
  storagePath: storagePathFromQuery,
}: {
  manualId?: string | null;
  title?: string | null;
  storagePath?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<{ numPages: number; getPage: (n: number) => Promise<any>; destroy?: () => void } | null>(
    null
  );

  const [title, setTitle] = useState(titleFromQuery || 'Service Manual');
  const [chapters, setChapters] = useState<ManualChapter[]>([]);
  const [showChapters, setShowChapters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const renderPage = useCallback(async (pageNum: number, zoomLevel: number) => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;
    const pdfPage = await pdf.getPage(pageNum);
    const base = pdfPage.getViewport({ scale: 1 });
    const wrap = containerRef.current;
    const avail = Math.max(320, (wrap?.clientWidth || 800) - 32);
    const fit = avail / base.width;
    const viewport = pdfPage.getViewport({ scale: fit * zoomLevel });
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  }, []);

  const openBytes = useCallback(
    async (bytes: ArrayBuffer) => {
      const pdfjs = await loadPdfJs();
      if (pdfRef.current?.destroy) {
        try {
          pdfRef.current.destroy();
        } catch {
          /* ignore */
        }
      }
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      pdfRef.current = doc;
      setPageCount(doc.numPages);
      setPage(1);
      setShowChapters(false);
      setLoading(false);
      setError(null);
      await renderPage(1, zoom);
    },
    [renderPage, zoom]
  );

  const openPath = useCallback(
    async (payload: ManualViewPayload, storagePath?: string | null) => {
      setLoading(true);
      setError(null);
      setProgress(10);
      const { json, token } = await fetchManualUrl({
        manual_id: payload.manualId,
        storage_path: storagePath || payload.storagePath,
      });
      setProgress(40);
      const nextChapters = Array.isArray(json.chapters) ? (json.chapters as ManualChapter[]) : payload.chapters || [];
      if (nextChapters.length > 1) setChapters(nextChapters);

      if (!storagePath && !json.url && !json.data_base64 && nextChapters.length > 1) {
        setChapters(nextChapters);
        setShowChapters(true);
        setLoading(false);
        return;
      }

      const chapterPath =
        storagePath ||
        json.storage_path ||
        payload.storagePath ||
        nextChapters.find((c) => c.storage_path)?.storage_path ||
        null;

      const bytes = await fetchPdfBytes({
        token,
        manualId: payload.manualId,
        storagePath: chapterPath,
        signedUrl: json.url || payload.url,
        dataBase64: json.data_base64 || payload.dataBase64,
      });
      setProgress(85);
      await openBytes(bytes);
    },
    [openBytes]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stashed = readManualView();
        const payload: ManualViewPayload = {
          manualId: manualId || stashed?.manualId,
          title: titleFromQuery || stashed?.title || 'Service Manual',
          storagePath: storagePathFromQuery || stashed?.storagePath,
          url: stashed?.url,
          dataBase64: stashed?.dataBase64,
          chapters: stashed?.chapters,
        };
        if (payload.title) setTitle(payload.title);
        if (Array.isArray(payload.chapters) && payload.chapters.length > 1) {
          setChapters(payload.chapters);
        }
        if (!payload.manualId && !payload.storagePath && !payload.url && !payload.dataBase64) {
          setError('No manual specified.');
          setLoading(false);
          return;
        }
        await openPath(payload);
        if (!cancelled && typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(MANUAL_VIEW_STORAGE_KEY);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not open manual');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (pdfRef.current?.destroy) {
        try {
          pdfRef.current.destroy();
        } catch {
          /* ignore */
        }
      }
    };
    // Initial open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualId]);

  useEffect(() => {
    if (!pdfRef.current || loading) return;
    renderPage(page, zoom).catch(() => {});
  }, [page, zoom, loading, renderPage]);

  async function openChapter(ch: ManualChapter) {
    if (!ch.storage_path) return;
    try {
      setTitle(ch.title || ch.label || title);
      await openPath(
        {
          manualId,
          title: ch.title || title,
          storagePath: ch.storage_path,
          chapters,
        },
        ch.storage_path
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open chapter');
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-4.5rem)] bg-[#0d1117] text-[#E5E7EB] -mx-4 sm:-mx-6 lg:-mx-8 -my-6">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#1F2937] border-b border-[#374151]">
        <Link
          href="/manuals"
          className="rounded-lg bg-[var(--gold,#FBBF24)] text-[#111827] font-bold text-sm px-3 py-1.5"
        >
          ← Library
        </Link>
        <div className="flex-1 min-w-[8rem] font-semibold text-[var(--gold,#FBBF24)] truncate">{title}</div>
        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24] disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            ◄ Prev
          </button>
          <span className="tabular-nums px-1">
            {pageCount ? `${page} / ${pageCount}` : '—'}
          </span>
          <button
            type="button"
            className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24] disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(pageCount || p, p + 1))}
            disabled={!pageCount || page >= pageCount || loading}
          >
            Next ►
          </button>
          <button
            type="button"
            className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24]"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}
          >
            －
          </button>
          <button
            type="button"
            className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24]"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24]"
            onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
          >
            ＋
          </button>
          {chapters.length > 1 && (
            <button
              type="button"
              className="rounded-md border border-[#FBBF24] bg-[rgba(251,191,36,0.25)] px-2.5 py-1.5 text-[13px] text-[#fbbf24]"
              onClick={() => setShowChapters((v) => !v)}
            >
              📚 Chapters
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#9CA3AF]">
            <div>Loading manual in the app…</div>
            <div className="w-64 h-2 rounded-full bg-[#374151] overflow-hidden">
              <div className="h-full bg-[var(--gold,#FBBF24)]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-lg font-bold text-red-400">Could not open manual</div>
            <div className="text-sm text-[#9CA3AF] max-w-md">{error}</div>
            <Link href="/manuals" className="btn btn-primary text-sm px-4 py-2">
              Back to library
            </Link>
          </div>
        )}
        {showChapters && chapters.length > 0 && (
          <div className="absolute inset-0 z-10 bg-[#0f172a] p-6 overflow-auto">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-xl font-bold text-[var(--gold,#FBBF24)] mb-4">📚 Chapters</h2>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))' }}>
                {chapters.map((ch, i) => (
                  <button
                    key={`${ch.storage_path || i}`}
                    type="button"
                    onClick={() => openChapter(ch)}
                    className="text-left rounded-lg border border-[#374151] bg-[#1F2937] px-3 py-3 hover:border-[var(--gold,#FBBF24)]"
                  >
                    <div className="text-[10px] font-bold text-[var(--gold,#FBBF24)] mb-1">Chapter {i + 1}</div>
                    <div className="text-sm">{ch.title || ch.label || ch.storage_path || `Chapter ${i + 1}`}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-center py-4 px-2">
          <canvas ref={canvasRef} className={loading || error ? 'hidden' : 'block shadow-lg'} />
        </div>
      </div>
    </div>
  );
}
