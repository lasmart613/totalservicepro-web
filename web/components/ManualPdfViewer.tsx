'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient, getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import {
  MANUAL_VIEW_STORAGE_KEY,
  PDFJS_SCRIPT_SRC,
  PDFJS_WORKER_SRC,
  pageTextMatches,
  readManualView,
  type ManualChapter,
  type ManualViewPayload,
} from '@/lib/manuals';

type PdfPageProxy = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
    promise: Promise<void>;
  };
  getTextContent?: () => Promise<{ items: Array<{ str?: string }> }>;
};

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageProxy>;
  destroy?: () => void;
};

type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: Record<string, unknown>) => {
    promise: Promise<PdfDoc>;
    onProgress?: ((p: { loaded: number; total: number }) => void) | null;
  };
};

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
  }
}

async function loadPdfJs(): Promise<PdfJsLib> {
  if (typeof window === 'undefined') throw new Error('PDF viewer is browser-only');
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    return window.pdfjsLib;
  }
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-tsp-pdfjs]');
    if (existing) {
      if (window.pdfjsLib) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load PDF viewer')));
      return;
    }
    const s = document.createElement('script');
    s.src = PDFJS_SCRIPT_SRC;
    s.async = true;
    s.dataset.tspPdfjs = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the in-app PDF viewer'));
    document.head.appendChild(s);
  });
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('Could not load the in-app PDF viewer');
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  return lib;
}

async function openPdfDocument(
  pdfjs: PdfJsLib,
  src: { url?: string; data?: ArrayBuffer },
  onProgress?: (loaded: number, total: number) => void
): Promise<PdfDoc> {
  const base: Record<string, unknown> = {
    isEvalSupported: false,
    ...(src.url ? { url: src.url } : {}),
    ...(src.data ? { data: src.data } : {}),
  };

  const run = (extra: Record<string, unknown> = {}) => {
    const task = pdfjs.getDocument({ ...base, ...extra });
    if (onProgress) {
      task.onProgress = (p) => onProgress(p.loaded || 0, p.total || 0);
    }
    return task.promise;
  };

  try {
    return await run();
  } catch {
    // Worker blocked (CSP / missing worker) — parse on the main thread.
    return await run({ disableWorker: true });
  }
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
}): Promise<ArrayBuffer> {
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
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(json.error || 'Could not load the manual in the app viewer');
}

function PdfPageCanvas({
  pdf,
  pageNumber,
  zoom,
  eager,
  scrollRoot,
}: {
  pdf: PdfDoc;
  pageNumber: number;
  zoom: number;
  eager?: boolean;
  scrollRoot?: HTMLElement | null;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [inView, setInView] = useState(!!eager);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (eager) {
      setInView(true);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setInView(true);
      },
      { root: scrollRoot || null, rootMargin: '1600px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager, scrollRoot]);

  useEffect(() => {
    if (!inView) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas) return;
    let cancelled = false;
    (async () => {
      const pdfPage = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const avail = Math.max(280, (wrap?.clientWidth || 800) - 24);
      const fit = avail / base.width;
      const viewport = pdfPage.getViewport({ scale: fit * zoom });
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      if (!cancelled) setReady(true);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inView, pdf, pageNumber, zoom]);

  return (
    <div
      ref={wrapRef}
      data-pdf-page={pageNumber}
      className="relative flex justify-center py-3 px-2"
      style={{ minHeight: ready ? undefined : 520 }}
    >
      {!ready && (
        <div className="text-sm text-[#9CA3AF] absolute mt-8">Page {pageNumber}</div>
      )}
      <canvas ref={canvasRef} className="block max-w-full bg-white shadow-lg" />
    </div>
  );
}

export function ManualPdfViewer({
  manualId,
  title: titleFromQuery,
  storagePath: storagePathFromQuery,
  sourceUrl,
}: {
  manualId?: string | null;
  title?: string | null;
  storagePath?: string | null;
  /** Same-origin or already-authorized URL (fixture demo). Skips library entitlements. */
  sourceUrl?: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PdfDoc | null>(null);
  const searchGen = useRef(0);

  const [title, setTitle] = useState(titleFromQuery || 'Service Manual');
  const [chapters, setChapters] = useState<ManualChapter[]>([]);
  const [showChapters, setShowChapters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [docEpoch, setDocEpoch] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<number[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  const attachDoc = useCallback((doc: PdfDoc) => {
    const prev = pdfRef.current;
    if (prev && prev !== doc && prev.destroy) {
      try {
        prev.destroy();
      } catch {
        /* ignore */
      }
    }
    pdfRef.current = doc;
    setPageCount(doc.numPages);
    setPage(1);
    setShowChapters(false);
    setHits([]);
    setHitIndex(0);
    setSearchNote(null);
    setLoading(false);
    setError(null);
    setProgress(100);
    setDocEpoch((n) => n + 1);
  }, []);

  const openSrc = useCallback(
    async (src: { url?: string; data?: ArrayBuffer }, isCancelled?: () => boolean) => {
      const pdfjs = await loadPdfJs();
      if (isCancelled?.()) return;
      const doc = await openPdfDocument(pdfjs, src, (loaded, total) => {
        if (total > 0) setProgress(Math.min(95, Math.round((loaded / total) * 100)));
      });
      if (isCancelled?.()) {
        try {
          doc.destroy?.();
        } catch {
          /* ignore */
        }
        return;
      }
      attachDoc(doc);
    },
    [attachDoc]
  );

  const openPath = useCallback(
    async (payload: ManualViewPayload, storagePath?: string | null, isCancelled?: () => boolean) => {
      setLoading(true);
      setError(null);
      setProgress(10);
      const { json, token } = await fetchManualUrl({
        manual_id: payload.manualId,
        storage_path: storagePath || payload.storagePath,
      });
      if (isCancelled?.()) return;
      setProgress(35);
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

      const signedUrl = json.url || payload.url || null;
      const dataBase64 = json.data_base64 || payload.dataBase64 || null;

      if (dataBase64) {
        const bin = atob(dataBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await openSrc({ data: bytes.buffer }, isCancelled);
        return;
      }

      // Prefer the signed URL so pdf.js can stream the whole file (range/progress).
      // Proxying every byte through /api/manuals/file can truncate large manuals
      // on Netlify function limits and leave only page 1 parseable.
      if (signedUrl) {
        try {
          await openSrc({ url: signedUrl }, isCancelled);
          return;
        } catch {
          /* fall through to same-origin proxy */
        }
      }

      const bytes = await fetchPdfBytes({
        token,
        manualId: payload.manualId,
        storagePath: chapterPath,
      });
      setProgress(85);
      await openSrc({ data: bytes }, isCancelled);
    },
    [openSrc]
  );

  useEffect(() => {
    let cancelled = false;
    const opened: PdfDoc[] = [];
    (async () => {
      try {
        if (sourceUrl) {
          setLoading(true);
          setError(null);
          await openSrc({ url: sourceUrl }, () => cancelled);
          if (!cancelled && pdfRef.current) opened.push(pdfRef.current);
          return;
        }
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
        await openPath(payload, undefined, () => cancelled);
        if (cancelled) return;
        if (pdfRef.current) opened.push(pdfRef.current);
        if (typeof sessionStorage !== 'undefined') {
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
      // Only destroy the document this effect instance opened — never
      // pdfRef.current, which a newer effect may already own (Strict Mode).
      for (const doc of opened) {
        if (doc?.destroy && pdfRef.current !== doc) {
          try {
            doc.destroy();
          } catch {
            /* ignore */
          }
        }
      }
    };
    // Initial open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualId, sourceUrl]);

  useEffect(() => {
    return () => {
      if (pdfRef.current?.destroy) {
        try {
          pdfRef.current.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const scrollToPage = useCallback((n: number) => {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-pdf-page="${n}"]`) as HTMLElement | null;
    if (!el) return;
    const elRect = el.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    root.scrollTo({ top: root.scrollTop + (elRect.top - rootRect.top) - 8, behavior: 'smooth' });
  }, []);

  const goToPage = useCallback(
    (n: number) => {
      if (!pageCount) return;
      const next = Math.min(pageCount, Math.max(1, n));
      setPage(next);
      scrollToPage(next);
    },
    [pageCount, scrollToPage]
  );

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !pageCount || loading) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const n = Number((visible.target as HTMLElement).dataset.pdfPage);
        if (n) setPage(n);
      },
      { root, threshold: [0.35, 0.6] }
    );
    root.querySelectorAll('[data-pdf-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pageCount, loading, docEpoch]);

  async function runSearch(direction: 1 | 0 | -1 = 0) {
    const q = query.trim();
    if (!q || !pdfRef.current) return;
    if (direction !== 0 && hits.length) {
      const next = (hitIndex + direction + hits.length) % hits.length;
      setHitIndex(next);
      goToPage(hits[next]);
      setSearchNote(`Match ${next + 1} of ${hits.length} (page ${hits[next]})`);
      return;
    }
    const gen = ++searchGen.current;
    setSearching(true);
    setSearchNote('Searching…');
    try {
      const found: number[] = [];
      for (let i = 1; i <= pdfRef.current.numPages; i++) {
        if (searchGen.current !== gen) return;
        const pdfPage = await pdfRef.current.getPage(i);
        const text = pdfPage.getTextContent ? await pdfPage.getTextContent() : { items: [] };
        const hay = (text.items || []).map((it) => it.str || '').join(' ');
        if (pageTextMatches(hay, q)) found.push(i);
      }
      if (searchGen.current !== gen) return;
      setHits(found);
      if (!found.length) {
        setSearchNote('No matches');
        return;
      }
      setHitIndex(0);
      goToPage(found[0]);
      setSearchNote(`Match 1 of ${found.length} (page ${found[0]})`);
    } catch {
      if (searchGen.current === gen) setSearchNote('Search failed');
    } finally {
      if (searchGen.current === gen) setSearching(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToPage(page + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPage(page - 1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToPage, page]);

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

  const pdf = pdfRef.current;
  const pages = pageCount && pdf ? Array.from({ length: pageCount }, (_, i) => i + 1) : [];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d1117] text-[#E5E7EB]">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#1F2937] border-b border-[#374151] shrink-0">
        <Link
          href={sourceUrl ? '/' : '/manuals'}
          className="rounded-lg bg-[var(--gold,#FBBF24)] text-[#111827] font-bold text-sm px-3 py-1.5"
        >
          {sourceUrl ? '← Home' : '← Library'}
        </Link>
        <div className="flex-1 min-w-[8rem] font-semibold text-[var(--gold,#FBBF24)] truncate">{title}</div>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24] disabled:opacity-40"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
          >
            ◄ Prev
          </button>
          <label className="tabular-nums px-1 flex items-center gap-1">
            <span className="sr-only">Page</span>
            <input
              type="number"
              min={1}
              max={pageCount || 1}
              value={pageCount ? page : ''}
              onChange={(e) => goToPage(Number(e.target.value) || 1)}
              className="w-14 rounded border border-[#374151] bg-[#111827] px-1 py-1 text-center text-[#E5E7EB]"
              disabled={!pageCount || loading}
            />
            <span>/ {pageCount || '—'}</span>
          </label>
          <button
            type="button"
            className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24] disabled:opacity-40"
            onClick={() => goToPage(page + 1)}
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
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(0);
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find in manual"
              className="w-36 sm:w-44 rounded border border-[#374151] bg-[#111827] px-2 py-1.5 text-[13px] text-[#E5E7EB]"
              disabled={loading || !pageCount}
            />
            <button
              type="submit"
              className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24] disabled:opacity-40"
              disabled={loading || !pageCount || searching || !query.trim()}
            >
              Find
            </button>
            <button
              type="button"
              className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2 py-1.5 text-[13px] text-[#fbbf24] disabled:opacity-40"
              onClick={() => runSearch(-1)}
              disabled={hits.length < 2}
              aria-label="Previous match"
            >
              ↑
            </button>
            <button
              type="button"
              className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2 py-1.5 text-[13px] text-[#fbbf24] disabled:opacity-40"
              onClick={() => runSearch(1)}
              disabled={hits.length < 2}
              aria-label="Next match"
            >
              ↓
            </button>
          </form>
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
      {searchNote && (
        <div className="px-3 py-1 text-xs text-[#9CA3AF] bg-[#111827] border-b border-[#374151] shrink-0">
          {searchNote}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto relative overscroll-contain">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#9CA3AF] z-10">
            <div>Loading manual in the app…</div>
            <div className="w-64 h-2 rounded-full bg-[#374151] overflow-hidden">
              <div className="h-full bg-[var(--gold,#FBBF24)]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center z-10">
            <div className="text-lg font-bold text-red-400">Could not open manual</div>
            <div className="text-sm text-[#9CA3AF] max-w-md">{error}</div>
            <Link href={sourceUrl ? '/' : '/manuals'} className="btn btn-primary text-sm px-4 py-2">
              {sourceUrl ? 'Back home' : 'Back to library'}
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
        {!loading && !error && pages.length > 0 && pdf && (
          <div key={docEpoch} className="pb-8">
            {pages.map((n) => (
              <PdfPageCanvas
                key={`${docEpoch}-${n}`}
                pdf={pdf}
                pageNumber={n}
                zoom={zoom}
                eager={pageCount <= 20 || n <= 3}
                scrollRoot={scrollRef.current}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
