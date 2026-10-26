'use client';

import { INCOMPLETE_FREE_BADGE, INCOMPLETE_FREE_TITLE } from '@/lib/manual-incomplete';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient, getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import {
  MANUAL_VIEW_STORAGE_KEY,
  PDFJS_SCRIPT_SRC,
  PDFJS_WORKER_SRC,
  matchingTextItemSpans,
  pageTextMatches,
  isLikelyPdfPath,
  readManualView,
  showManualChaptersButton,
  type ManualChapter,
  type ManualViewPayload,
} from '@/lib/manuals';
import {
  chapterCardCopy,
  chapterCardPageRange,
  chapterHistoryUrl,
  chapterNeighbors,
  chaptersInReadingOrder,
  chooseDocumentToc,
  manualChapterHref,
  manualTocPageHref,
  tocEntriesFromMetadata,
  tocFromPdfOutline,
  type PdfOutlineItem,
  type TocEntry,
} from '@/lib/manual-toc';
import { asPositivePage } from '@/lib/ai/citations';
import { viewerTargetForJoinedPage } from '@/lib/manual-page-map';
import {
  fittedPageBoxHeight,
  viewerCitedPageNotice,
  viewerFolderOutOfRangeNotice,
  viewerPhysicalPage,
} from '@/lib/pdf-viewer-page';
import { ViewerAiPanel } from '@/components/ViewerAiPanel';
import { manualLanguageBadge, resolveManualLanguage } from '@/lib/manual-language';
import { isMissingColumn, isPublishedColumnMissing, isUnpublishedManual } from '@/lib/manual-published';
import {
  MANUAL_FILE_MISSING,
  MANUAL_NOT_AVAILABLE,
  manualDownloadSentence,
  manualFileKind,
  manualOpenErrorMessage,
} from '@/lib/manual-file';
import { useT } from '@/lib/fa/locale';
import { createPageViewBatcher, librarySource, recordManualAccess } from '@/lib/manual-library-refund';

function sameStoragePath(a?: string | null, b?: string | null): boolean {
  const norm = (value?: string | null) =>
    String(value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  const left = norm(a);
  return left !== '' && left === norm(b);
}

type PdfTextRun = {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
};

type PdfViewport = {
  width: number;
  height: number;
  scale?: number;
  transform: number[];
};

type PdfPageProxy = {
  getViewport: (opts: { scale: number }) => PdfViewport;
  render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => {
    promise: Promise<void>;
  };
  getTextContent?: () => Promise<{ items: PdfTextRun[] }>;
};

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageProxy>;
  getOutline?: () => Promise<PdfOutlineItem[] | null>;
  getDestination?: (name: string) => Promise<unknown>;
  getPageIndex?: (ref: unknown) => Promise<number>;
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
      // Cite / deep-link reader. Library shelf opens never set this, so an
      // unowned shared catalog manual stays requires_add there.
      ai_context: true,
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
      ai_context: true,
    }),
  });
  if (res.ok) return await res.arrayBuffer();
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  const openError = manualOpenErrorMessage(json.error);
  if (openError) throw new Error(openError);
  throw new Error(json.error || 'Could not load the manual in the app viewer');
}

/** Page targets already stored on the manual. A missing column or bad value is no TOC. */
async function readStoredToc(manualId: string): Promise<TocEntry[]> {
  try {
    const supabase = getSupabaseClient();
    const row = await supabase.from('manuals').select('chapter_metadata').eq('id', manualId).maybeSingle();
    if (row.error || !row.data) return [];
    return tocEntriesFromMetadata((row.data as { chapter_metadata?: unknown }).chapter_metadata);
  } catch {
    return [];
  }
}

function fileNameFromPath(path: string): string {
  const base = String(path || '').split('?')[0].split('/').pop() || 'manual';
  return base.replace(/[?#].*$/, '') || 'manual';
}

type ManualDownload = {
  title?: string;
  storage_path?: string;
  file_type?: string;
};

type FileOffer = {
  url: string;
  fileName: string;
  message: string;
  fileType: string;
};

type OpenedManualFile = {
  chapters: ManualChapter[];
  openedPath: string | null;
  /** A chapter PDF is on screen, so the landing history entry can name it. */
  stampHistory: boolean;
};

type FindBox = { x: number; y: number; w: number; h: number };

function PdfPageCanvas({
  pdf,
  pageNumber,
  zoom,
  eager,
  highlightQuery,
  boxHeight,
  onReady,
}: {
  pdf: PdfDoc;
  pageNumber: number;
  zoom: number;
  eager?: boolean;
  highlightQuery?: string;
  boxHeight: number;
  onReady?: (pageNumber: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [inView, setInView] = useState(!!eager);
  const [boxes, setBoxes] = useState<FindBox[]>([]);
  const [canvasCss, setCanvasCss] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || eager) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setInView(true);
      },
      { rootMargin: '1200px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

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
      const nextBoxes: FindBox[] = [];
      const util = window.pdfjsLib && (window.pdfjsLib as PdfJsLib & { Util?: { transform: (a: number[], b: number[]) => number[] } }).Util;
      if (highlightQuery && pdfPage.getTextContent && util?.transform) {
        const text = await pdfPage.getTextContent();
        for (const span of matchingTextItemSpans(text.items || [], highlightQuery)) {
          const item = text.items?.[span.index];
          if (!item?.transform || !item.str) continue;
          const tx = util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]) || item.height || 12;
          const scale = viewport.scale || 1;
          const fullW = Math.max((item.width || 0) * scale, fontHeight * 0.45);
          const len = Math.max(item.str.length, 1);
          const start = Math.min(span.from, len) / len;
          const end = Math.min(Math.max(span.to, span.from + 1), len) / len;
          nextBoxes.push({
            x: tx[4] + fullW * start,
            y: tx[5] - fontHeight,
            w: Math.max(fullW * (end - start), fontHeight * 0.35),
            h: fontHeight * 1.05,
          });
        }
      }
      if (!cancelled) {
        setCanvasCss({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
        setBoxes(nextBoxes);
        onReadyRef.current?.(pageNumber);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inView, pdf, pageNumber, zoom, highlightQuery]);

  return (
    <div
      ref={wrapRef}
      data-pdf-page={pageNumber}
      className="flex justify-center py-3 px-2"
      style={{ minHeight: boxHeight || undefined }}
    >
      <div className="relative" style={canvasCss ? { width: canvasCss.width, height: canvasCss.height } : undefined}>
        <canvas ref={canvasRef} className="block max-w-full bg-white shadow-lg" />
        {boxes.length > 0 && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {boxes.map((box, i) => (
              <div
                key={i}
                data-find-hit=""
                className="absolute rounded-sm"
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.w,
                  height: box.h,
                  background: 'rgba(251, 191, 36, 0.45)',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ManualPdfViewer({
  manualId,
  title: titleFromQuery,
  storagePath: storagePathFromQuery,
  sourceUrl,
  initialPage,
  initialSection,
  initialFind,
  pageOutOfRange = false,
  embedded = false,
}: {
  manualId?: string | null;
  title?: string | null;
  storagePath?: string | null;
  /** Same-origin or already-authorized URL (fixture demo). Skips library entitlements. */
  sourceUrl?: string | null;
  initialPage?: string | number | null;
  initialSection?: string | null;
  initialFind?: string | null;
  /** Citation flag `page_out_of_range` / `oor=1`. Do not scroll to `initialPage`. */
  pageOutOfRange?: boolean;
  /** Assistant side panel. Parent owns Back/Close so this view does not navigate away. */
  embedded?: boolean;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PdfDoc | null>(null);
  const searchGen = useRef(0);
  const zoomRef = useRef(1);
  const pendingJump = useRef<number | null>(null);
  const jumpLockUntil = useRef(0);
  /** Chapter grid click. Suppress the citation deep-link jump for that open. */
  const chapterPick = useRef(false);
  const currentChapterRef = useRef<HTMLAnchorElement | null>(null);
  /** Set before a user chapter change so the landing seed cannot replace that entry. */
  const userChapterNav = useRef(false);
  /** Chapter that was open on arrival, when that history entry has no storage_path. */
  const landedChapterRef = useRef<ManualChapter | null>(null);
  const chaptersRef = useRef<ManualChapter[]>([]);
  const openStoragePathRef = useRef<string | null>(storagePathFromQuery || null);
  const openChapterRef = useRef<(ch: ManualChapter, history?: 'push' | 'none') => Promise<void>>(
    async () => {}
  );
  const outlineGen = useRef(0);

  const [title, setTitle] = useState(titleFromQuery || 'Service Manual');
  const [catalogPath, setCatalogPath] = useState(storagePathFromQuery || '');
  const [catalogBrand, setCatalogBrand] = useState<string | null>(null);
  const [catalogModel, setCatalogModel] = useState<string | null>(null);
  const [isIncomplete, setIsIncomplete] = useState(false);
  const [languageCode, setLanguageCode] = useState<string | null>(null);
  const [showRail, setShowRail] = useState(!embedded);
  const [chapters, setChapters] = useState<ManualChapter[]>([]);
  const [downloads, setDownloads] = useState<ManualDownload[]>([]);
  const [showChapters, setShowChapters] = useState(false);
  const [storedToc, setStoredToc] = useState<TocEntry[]>([]);
  const [pdfOutline, setPdfOutline] = useState<TocEntry[]>([]);
  const [showContents, setShowContents] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const [fileOffer, setFileOffer] = useState<FileOffer | null>(null);
  /** Local page inside the opened chapter. undefined keeps initialPage as-is. null: joined page is past the folder. */
  const [folderLocalPage, setFolderLocalPage] = useState<number | null | undefined>(undefined);
  /** Joined index page when the open file is the chapter that contains it. */
  const [joinedPageLabel, setJoinedPageLabel] = useState<number | null>(null);
  /** User picked a chapter. The citation page belongs to a different file. */
  const [chapterBrowse, setChapterBrowse] = useState(false);
  const [openStoragePath, setOpenStoragePath] = useState<string | null>(storagePathFromQuery || null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pageBoxHeight, setPageBoxHeight] = useState(0);
  const [zoom, setZoom] = useState(1);
  zoomRef.current = zoom;
  chaptersRef.current = chapters;
  openStoragePathRef.current = openStoragePath;
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
    if (pdfRef.current?.destroy) {
      try {
        pdfRef.current.destroy();
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
    async (src: { url?: string; data?: ArrayBuffer }, opts?: { readOutline?: boolean }) => {
      const pdfjs = await loadPdfJs();
      const doc = await openPdfDocument(pdfjs, src, (loaded, total) => {
        if (total > 0) setProgress(Math.min(95, Math.round((loaded / total) * 100)));
      });
      let height = 0;
      try {
        const first = await doc.getPage(1);
        const base = first.getViewport({ scale: 1 });
        const width = scrollRef.current?.clientWidth || 800;
        height = fittedPageBoxHeight(base.width, base.height, width, zoomRef.current);
      } catch {
        const width = scrollRef.current?.clientWidth || 800;
        height = fittedPageBoxHeight(612, 792, width, zoomRef.current);
      }
      setPageBoxHeight(height);
      attachDoc(doc);
      if (opts?.readOutline) {
        const gen = ++outlineGen.current;
        void (async () => {
          try {
            const outline = doc.getOutline ? await doc.getOutline() : null;
            const entries = await tocFromPdfOutline(outline, doc);
            if (outlineGen.current === gen) setPdfOutline(entries);
          } catch {
            if (outlineGen.current === gen) setPdfOutline([]);
          }
        })();
      } else {
        outlineGen.current += 1;
        setPdfOutline([]);
      }
    },
    [attachDoc]
  );

  const openPath = useCallback(
    async (
      payload: ManualViewPayload,
      storagePath?: string | null,
      opts?: { metadataOnly?: boolean },
    ): Promise<OpenedManualFile> => {
      setLoading(true);
      setError(null);
      setFileOffer(null);
      setProgress(10);
      const { ok, json, token } = await fetchManualUrl({
        manual_id: payload.manualId,
        storage_path: storagePath || payload.storagePath,
      });
      setProgress(35);
      if (!ok) {
        const openError = manualOpenErrorMessage(json?.error);
        if (openError) throw new Error(openError);
        throw new Error(String(json?.error || 'Could not open manual'));
      }
      const nextChapters = Array.isArray(json.chapters) ? (json.chapters as ManualChapter[]) : payload.chapters || [];
      if (showManualChaptersButton(nextChapters)) setChapters(nextChapters);
      if (Array.isArray(json.downloads)) setDownloads(json.downloads as ManualDownload[]);
      const openedPath = String(json.storage_path || storagePath || payload.storagePath || '') || null;
      if (openedPath) setOpenStoragePath(openedPath);
      if (opts?.metadataOnly) {
        return { chapters: nextChapters, openedPath, stampHistory: false };
      }
      const fileKind = String(json.file_kind || '');
      if (json.render === 'download' || (fileKind && fileKind !== 'pdf')) {
        const url = String(json.url || '');
        if (!url) throw new Error(MANUAL_FILE_MISSING);
        const fileType = String(json.file_type || '');
        setFileOffer({
          url,
          fileName: fileNameFromPath(String(json.storage_path || openedPath || '')),
          message: manualDownloadSentence(fileKind || manualFileKind(fileType)),
          fileType,
        });
        setLoading(false);
        setProgress(100);
        return { chapters: nextChapters, openedPath, stampHistory: false };
      }

      if (!storagePath && !json.url && !json.data_base64 && showManualChaptersButton(nextChapters)) {
        setChapters(nextChapters);
        setShowChapters(true);
        setLoading(false);
        return { chapters: nextChapters, openedPath, stampHistory: false };
      }

      const chapterPath =
        storagePath ||
        json.storage_path ||
        payload.storagePath ||
        nextChapters.find((c) => c.storage_path)?.storage_path ||
        null;

      const signedUrl = json.url || payload.url || null;
      const dataBase64 = json.data_base64 || payload.dataBase64 || null;

      const readOutline = !showManualChaptersButton(nextChapters);
      if (dataBase64) {
        const bin = atob(dataBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await openSrc({ data: bytes.buffer }, { readOutline });
        return { chapters: nextChapters, openedPath, stampHistory: true };
      }

      // Prefer the signed URL so pdf.js can stream the whole file (range/progress).
      // Proxying every byte through /api/manuals/file can truncate large manuals
      // on Netlify function limits and leave only page 1 parseable.
      if (signedUrl) {
        try {
          await openSrc({ url: signedUrl }, { readOutline });
          return { chapters: nextChapters, openedPath, stampHistory: true };
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
      await openSrc({ data: bytes }, { readOutline });
      return { chapters: nextChapters, openedPath: chapterPath || openedPath, stampHistory: true };
    },
    [openSrc]
  );

  useEffect(() => {
    let cancelled = false;
    userChapterNav.current = false;
    landedChapterRef.current = null;
    (async () => {
      try {
        if (sourceUrl) {
          setLoading(true);
          setError(null);
          await openSrc({ url: sourceUrl }, { readOutline: true });
          return;
        }
        setStoredToc([]);
        setShowContents(false);
        const stashed = readManualView();
        chapterPick.current = false;
        setChapterBrowse(false);
        const pinnedPdf = isLikelyPdfPath(storagePathFromQuery);
        const joinedRequest = asPositivePage(initialPage);
        const suppressEntry = !pinnedPdf && joinedRequest != null && !pageOutOfRange;
        const payload: ManualViewPayload = {
          manualId: manualId || stashed?.manualId,
          title: titleFromQuery || stashed?.title || 'Service Manual',
          storagePath: pinnedPdf
            ? storagePathFromQuery
            : suppressEntry
              ? undefined
              : storagePathFromQuery || stashed?.storagePath,
          url: suppressEntry ? undefined : stashed?.url,
          dataBase64: suppressEntry ? undefined : stashed?.dataBase64,
          chapters: stashed?.chapters,
          isIncomplete: stashed?.isIncomplete,
          language: stashed?.language,
        };
        if (payload.title) setTitle(payload.title);
        if (!cancelled) setLanguageCode(resolveManualLanguage(payload));
        let incomplete = payload.isIncomplete === true;
        if (payload.manualId) {
          try {
            const supabase = getSupabaseClient();
            let row = await supabase
              .from('manuals')
              .select('is_incomplete,storage_path,brand,title,model,language,published')
              .eq('id', payload.manualId)
              .maybeSingle();
            if (row.error && isPublishedColumnMissing(row.error)) {
              row = await supabase
                .from('manuals')
                .select('is_incomplete,storage_path,brand,title,model,language')
                .eq('id', payload.manualId)
                .maybeSingle();
            } else if (row.error && isMissingColumn(row.error, 'language')) {
              row = await supabase
                .from('manuals')
                .select('is_incomplete,storage_path,brand,title,model,published')
                .eq('id', payload.manualId)
                .maybeSingle();
            }
            if (isUnpublishedManual(row.data as { published?: unknown } | null)) {
              if (!cancelled) {
                setError(MANUAL_NOT_AVAILABLE);
                setLoading(false);
              }
              return;
            }
            if (row.error && isMissingColumn(row.error, 'language')) {
              row = await supabase
                .from('manuals')
                .select('is_incomplete,storage_path,brand,title,model')
                .eq('id', payload.manualId)
                .maybeSingle();
            }
            if (row.error && isMissingColumn(row.error, 'is_incomplete')) {
              incomplete = payload.isIncomplete === true;
              row = await supabase
                .from('manuals')
                .select('storage_path,brand,title,model')
                .eq('id', payload.manualId)
                .maybeSingle();
            } else if (row.data && (row.data as { is_incomplete?: unknown }).is_incomplete === true) {
              incomplete = true;
            } else if (row.data) {
              incomplete = false;
            }
            const data = row.data as {
              storage_path?: string;
              brand?: string | null;
              title?: string | null;
              model?: string | null;
              language?: string | null;
            } | null;
            if (data?.storage_path && !cancelled) setCatalogPath(data.storage_path);
            if (data?.brand && !cancelled) setCatalogBrand(data.brand);
            if (data?.model && !cancelled) setCatalogModel(data.model);
            if (data?.title && !cancelled && !titleFromQuery) setTitle(data.title);
            if (data && !cancelled) {
              setLanguageCode(resolveManualLanguage({ language: data.language, title: data.title || payload.title }));
            }
          } catch {
            /* keep stashed flag */
          }
        }
        if (!cancelled) setIsIncomplete(incomplete);
        if (payload.manualId) {
          void readStoredToc(String(payload.manualId)).then((entries) => {
            if (!cancelled) setStoredToc(entries);
          });
        }
        if (showManualChaptersButton(payload.chapters)) {
          setChapters(payload.chapters);
        }
        if (!payload.manualId && !payload.storagePath && !payload.url && !payload.dataBase64) {
          setError('No manual specified.');
          setLoading(false);
          return;
        }
        let opened: OpenedManualFile | null = null;
        if (suppressEntry && joinedRequest) {
          const listed = await openPath(payload, undefined, { metadataOnly: true });
          if (cancelled) return;
          const target = viewerTargetForJoinedPage(listed.chapters, joinedRequest);
          if (target.kind === 'hit') {
            setFolderLocalPage(target.localPage);
            setJoinedPageLabel(joinedRequest);
            if (!sameStoragePath(target.storagePath, listed.openedPath)) {
              opened = await openPath(
                { ...payload, storagePath: target.storagePath, chapters: listed.chapters },
                target.storagePath,
              );
            } else {
              opened = await openPath(payload, listed.openedPath);
            }
          } else {
            setJoinedPageLabel(null);
            setFolderLocalPage(target.kind === 'out-of-range' ? null : undefined);
            opened = await openPath(payload);
          }
        } else {
          setJoinedPageLabel(null);
          setFolderLocalPage(undefined);
          opened = await openPath(payload, payload.storagePath);
        }
        if (
          !cancelled &&
          opened?.stampHistory &&
          opened.openedPath &&
          showManualChaptersButton(opened.chapters)
        ) {
          const openedPath = opened.openedPath;
          const match = opened.chapters.find((chapter) => sameStoragePath(chapter.storage_path, openedPath));
          const ch: ManualChapter = match?.storage_path ? match : { storage_path: openedPath };
          landedChapterRef.current = ch;
          // Name the open chapter on the entry that brought us here. Do not push,
          // and do not replace a chapter change the reader already made.
          if (!userChapterNav.current) writeChapterHistory(ch, 'replace', { keepPage: true });
        }
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
  }, [manualId, sourceUrl]);

  const scrollToPage = useCallback((n: number, behavior: ScrollBehavior = 'smooth') => {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-pdf-page="${n}"]`);
    if (el) el.scrollIntoView({ behavior, block: 'start' });
  }, []);

  const jumpToPhysicalPage = useCallback(
    (n: number) => {
      pendingJump.current = n;
      jumpLockUntil.current = Date.now() + 800;
      setPage(n);
      scrollToPage(n, 'auto');
    },
    [scrollToPage]
  );

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
        if (!n) return;
        const locked = pendingJump.current;
        if (locked && n !== locked && Date.now() < jumpLockUntil.current) return;
        if (locked && n === locked) pendingJump.current = null;
        setPage(n);
      },
      { root, threshold: [0.35, 0.6] }
    );
    root.querySelectorAll('[data-pdf-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pageCount, loading, docEpoch]);

  // 000936: report reads so the server can decide Remove & refund (downloads,
  // prints, heavy reading). Pages are batched; reporting never blocks reading.
  const trackManualId = sourceUrl ? null : manualId;
  const pageBatcher = useRef<ReturnType<typeof createPageViewBatcher> | null>(null);
  const pageCountRef = useRef(0);
  pageCountRef.current = pageCount;
  // Arrival order. Reading order is only the chapter list and Previous/Next.
  const chapterIndex = Math.max(
    0,
    chapters.findIndex((c) => c?.storage_path && c.storage_path === openStoragePath),
  );
  const isFolder = chapters.length > 1;
  useEffect(() => {
    if (!trackManualId) return;
    const supabase = getSupabaseClient();
    const source = librarySource(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    const batcher = createPageViewBatcher((pages) => {
      void recordManualAccess(supabase, trackManualId, 'page_view', {
        pages,
        // Last-resort fallback only (server uses chapter_metadata, then
        // manuals.page_count, then the MIN reported). Folder chapters would
        // undercount the whole manual, so only single files send it.
        pageCount: isFolder ? undefined : pageCountRef.current || undefined,
        source,
      });
    });
    pageBatcher.current = batcher;
    const timer = window.setInterval(() => batcher.flush(), 5000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') batcher.flush();
    };
    const onPrint = () => {
      void recordManualAccess(supabase, trackManualId, 'print', { source });
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeprint', onPrint);
    return () => {
      batcher.flush();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeprint', onPrint);
      pageBatcher.current = null;
    };
  }, [trackManualId, isFolder]);
  useEffect(() => {
    if (!trackManualId || !pageCount || loading || page < 1) return;
    // Folder manuals: keep chapter pages distinct (chapter index * 1000 + page).
    pageBatcher.current?.add(Math.min(100000, (isFolder ? chapterIndex * 1000 : 0) + page));
  }, [trackManualId, page, pageCount, loading, isFolder, chapterIndex]);
  const reportDownload = () => {
    if (!trackManualId) return;
    void recordManualAccess(getSupabaseClient(), trackManualId, 'download', {
      source: librarySource(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    });
  };

  async function runSearch(direction: 1 | 0 | -1 = 0, override?: string) {
    const q = (override ?? query).trim();
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
    if (loading || !pageCount || !pageBoxHeight) return;
    if (chapterPick.current) return;
    const requested = folderLocalPage === undefined ? asPositivePage(initialPage) : folderLocalPage;
    if (requested) {
      // Flagged past the PDF, or past the loaded page count: leave the document
      // where it is and show the notice. Do not clamp the deep link onto page 1.
      if (pageOutOfRange) return;
      const target = viewerPhysicalPage(requested, pageCount);
      if (!target) return;
      let cancelled = false;
      const jump = () => {
        if (!cancelled) jumpToPhysicalPage(target);
      };
      const first = window.setTimeout(jump, 0);
      const again = window.setTimeout(jump, 80);
      return () => {
        cancelled = true;
        window.clearTimeout(first);
        window.clearTimeout(again);
      };
    }
    const find = String(initialSection || initialFind || '').trim();
    if (!find) return;
    setQuery(find);
    void runSearch(0, find);
    // Deep-link jump after the fitted page height is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docEpoch, loading, pageCount, pageBoxHeight, initialPage, pageOutOfRange, jumpToPhysicalPage, folderLocalPage]);

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

  async function openDownload(storagePath: string) {
    if (!storagePath) return;
    try {
      setLoading(true);
      setError(null);
      setFileOffer(null);
      const { ok, json } = await fetchManualUrl({
        manual_id: manualId,
        storage_path: storagePath,
      });
      if (!ok || !json.url) {
        const openError = manualOpenErrorMessage(json?.error);
        if (openError) throw new Error(openError);
        throw new Error(String(json?.error || 'Could not open manual'));
      }
      const fileKind = String(json.file_kind || manualFileKind(String(json.file_type || storagePath)));
      const fileType = String(json.file_type || '');
      setFileOffer({
        url: String(json.url),
        fileName: fileNameFromPath(String(json.storage_path || storagePath)),
        message: manualDownloadSentence(fileKind),
        fileType,
      });
      setShowDownloads(false);
      setLoading(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open manual');
      setLoading(false);
    }
  }

  function writeChapterHistory(
    ch: ManualChapter,
    mode: 'push' | 'replace',
    opts?: { keepPage?: boolean },
  ) {
    if (typeof window === 'undefined' || !ch.storage_path) return;
    try {
      const next = chapterHistoryUrl(window.location.href, {
        manualId,
        storagePath: ch.storage_path,
        title: chapterCardCopy(ch).title,
        keepPage: opts?.keepPage,
      });
      if (!next) return;
      if (mode === 'push') window.history.pushState(null, '', next);
      else window.history.replaceState(null, '', next);
    } catch {
      /* the chapter still opens in the viewer */
    }
  }

  function openChapterFromLink(event: React.MouseEvent<HTMLAnchorElement>, ch: ManualChapter) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    void openChapter(ch);
  }

  function openContentsPage(event: React.MouseEvent<HTMLAnchorElement>, pageNumber: number) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const target = viewerPhysicalPage(pageNumber, pageCount);
    if (!target) return;
    event.preventDefault();
    chapterPick.current = false;
    setShowContents(false);
    jumpToPhysicalPage(target);
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (manualId) url.searchParams.set('id', String(manualId));
      url.searchParams.set('page', String(target));
      url.hash = `page=${target}`;
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* the page still scrolled */
    }
  }

  async function openChapter(ch: ManualChapter, history: 'push' | 'none' = 'push') {
    if (!ch.storage_path) return;
    if (history === 'push') {
      userChapterNav.current = true;
      writeChapterHistory(ch, 'push');
    }
    try {
      chapterPick.current = true;
      setChapterBrowse(true);
      setShowContents(false);
      setJoinedPageLabel(null);
      setTitle(chapterCardCopy(ch).title || title);
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

  openChapterRef.current = openChapter;

  useEffect(() => {
    function onPopState() {
      if (typeof window === 'undefined') return;
      let url: URL;
      try {
        url = new URL(window.location.href);
      } catch {
        return;
      }
      if (!url.pathname.includes('/manuals/view')) return;
      const path = url.searchParams.get('storage_path');
      if (path) {
        const ch = chaptersRef.current.find((chapter) => sameStoragePath(chapter.storage_path, path));
        if (!ch) return;
        if (sameStoragePath(ch.storage_path, openStoragePathRef.current)) {
          setShowChapters(false);
          return;
        }
        void openChapterRef.current(ch, 'none');
        return;
      }
      const landed = landedChapterRef.current;
      if (landed?.storage_path) {
        if (!sameStoragePath(landed.storage_path, openStoragePathRef.current)) {
          void openChapterRef.current(landed, 'none');
        }
        return;
      }
      setShowChapters(true);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const pdf = pdfRef.current;
  const pages = pageCount && pdf ? Array.from({ length: pageCount }, (_, i) => i + 1) : [];
  const languageBadge = manualLanguageBadge(languageCode);
  const requestedPage = asPositivePage(initialPage);
  const deepLinkPage = folderLocalPage === undefined ? requestedPage : folderLocalPage;
  const folderPastEnd = folderLocalPage === null;
  const pageNotice =
    joinedPageLabel != null || chapterBrowse
      ? null
      : folderPastEnd
        ? viewerFolderOutOfRangeNotice(requestedPage)
        : pageOutOfRange || (!loading && pageCount > 0)
          ? viewerCitedPageNotice(requestedPage, pageCount, pageOutOfRange)
          : null;
  const pageNoticeKey = folderPastEnd
    ? "Page {page} isn't in this manual"
    : "Page {page} isn't in this PDF";

  useEffect(() => {
    if (!showChapters) return;
    currentChapterRef.current?.scrollIntoView({ block: 'nearest' });
  }, [showChapters, openStoragePath, chapters]);

  const readingChapters = chaptersInReadingOrder(chapters);
  const chapterNav = chapterNeighbors(readingChapters, openStoragePath);
  const contents = showManualChaptersButton(chapters) ? [] : chooseDocumentToc(storedToc, pdfOutline);
  const chapterNavClass =
    'rounded-md border border-[#FBBF24] bg-[rgba(251,191,36,0.25)] px-2.5 py-1.5 text-[13px] text-[#fbbf24] disabled:opacity-40';

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d1117] text-[#E5E7EB]">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#1F2937] border-b border-[#374151] shrink-0">
        {!embedded && (
          <Link
            href={sourceUrl ? '/' : '/manuals'}
            className="rounded-lg bg-[var(--gold,#FBBF24)] text-[#111827] font-bold text-sm px-3 py-1.5"
          >
            {sourceUrl ? '← Home' : '← Library'}
          </Link>
        )}
        {showManualChaptersButton(chapters) && !showChapters && (
          <button
            type="button"
            data-testid="back-to-chapters"
            className={chapterNavClass}
            onClick={() => {
              setShowDownloads(false);
              setShowContents(false);
              setShowChapters(true);
            }}
          >
            ← {t('Back to chapters')}
          </button>
        )}
        {showManualChaptersButton(chapters) && !showChapters && (
          <button
            type="button"
            data-testid="previous-chapter"
            className={chapterNavClass}
            hidden={chapterNav.previous == null}
            disabled={chapterNav.previous == null || loading}
            onClick={() => {
              if (chapterNav.previous) void openChapter(chapterNav.previous);
            }}
          >
            ◄ {t('Previous chapter')}
          </button>
        )}
        {showManualChaptersButton(chapters) && !showChapters && (
          <button
            type="button"
            data-testid="next-chapter"
            className={chapterNavClass}
            hidden={chapterNav.next == null}
            disabled={chapterNav.next == null || loading}
            onClick={() => {
              if (chapterNav.next) void openChapter(chapterNav.next);
            }}
          >
            {t('Next chapter')} ►
          </button>
        )}
        <div className="flex-1 min-w-[8rem] font-semibold text-[var(--gold,#FBBF24)] truncate">{title}</div>
        {isIncomplete && (
          <span
            className="shrink-0 rounded-full bg-stone-600 text-white text-[10px] font-extrabold px-2 py-0.5"
            title={INCOMPLETE_FREE_TITLE}
          >
            {INCOMPLETE_FREE_BADGE}
          </span>
        )}
        {languageBadge && (
          <span className="manual-language-chip" title={languageBadge.code}>
            {languageBadge.label}
          </span>
        )}
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
            {joinedPageLabel != null && (
              <span data-testid="joined-page" className="text-[#9CA3AF]">
                {t('Manual p. {page}').replace('{page}', String(joinedPageLabel))}
              </span>
            )}
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
          <button
            type="button"
            className="rounded-md border border-[#374151] bg-[rgba(251,191,36,0.1)] px-2.5 py-1.5 text-[13px] text-[#fbbf24]"
            onClick={() => setShowRail((v) => !v)}
            aria-expanded={showRail}
            aria-controls="viewer-rail"
          >
            {showRail ? 'Hide tools' : 'Search / AI'}
          </button>
          {showManualChaptersButton(chapters) && (
            <button
              type="button"
              aria-label="Chapters"
              className="rounded-md border border-[#FBBF24] bg-[rgba(251,191,36,0.25)] px-2.5 py-1.5 text-[13px] text-[#fbbf24]"
              onClick={() => {
                setShowDownloads(false);
                setShowContents(false);
                setShowChapters((v) => !v);
              }}
            >
              📚 Chapters
            </button>
          )}
          {contents.length > 0 && (
            <button
              type="button"
              aria-label={t('Contents')}
              aria-expanded={showContents}
              className="rounded-md border border-[#FBBF24] bg-[rgba(251,191,36,0.25)] px-2.5 py-1.5 text-[13px] text-[#fbbf24]"
              onClick={() => {
                setShowDownloads(false);
                setShowChapters(false);
                setShowContents((v) => !v);
              }}
            >
              {t('Contents')}
            </button>
          )}
          {downloads.length > 0 && (
            <button
              type="button"
              aria-label="Other files"
              className="rounded-md border border-[#FBBF24] bg-[rgba(251,191,36,0.25)] px-2.5 py-1.5 text-[13px] text-[#fbbf24]"
              onClick={() => setShowDownloads((v) => !v)}
            >
              {t('Other files')}
            </button>
          )}
        </div>
      </div>

      {pageNotice && (
        <div
          role="alert"
          data-testid="pdf-page-notice"
          className="shrink-0 px-3 py-2 text-sm font-semibold bg-amber-950 text-amber-100 border-b border-amber-500/50"
        >
          {t(pageNoticeKey).replace('{page}', String(requestedPage ?? ''))}
        </div>
      )}

      <div className={`viewer-layout ${showRail ? 'is-rail-open' : ''}`}>
        <aside id="viewer-rail" className="viewer-rail" aria-label="Manual search and AI tools">
          <div className="viewer-rail-label">Search tools</div>
          <form
            className="viewer-find"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(0);
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find in manual"
              className="viewer-find-input"
              disabled={loading || !pageCount}
            />
            <div className="viewer-find-row">
              <button
                type="submit"
                className="viewer-tool-btn"
                disabled={loading || !pageCount || searching || !query.trim()}
              >
                Find
              </button>
              <button
                type="button"
                className="viewer-tool-btn"
                onClick={() => void runSearch(-1)}
                disabled={hits.length < 2}
                aria-label="Previous match"
              >
                ↑
              </button>
              <button
                type="button"
                className="viewer-tool-btn"
                onClick={() => void runSearch(1)}
                disabled={hits.length < 2}
                aria-label="Next match"
              >
                ↓
              </button>
            </div>
          </form>
          {searchNote && <div className="viewer-search-note">{searchNote}</div>}

          <ViewerAiPanel
            manualId={manualId}
            title={title}
            storagePath={catalogPath || storagePathFromQuery}
            brand={catalogBrand}
            model={catalogModel}
          />
        </aside>

        <div ref={scrollRef} className="viewer-pages flex-1 min-h-0 overflow-auto relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#9CA3AF] z-10">
              <div>Loading manual in the app…</div>
              <div className="w-64 h-2 rounded-full bg-[#374151] overflow-hidden">
                <div className="h-full bg-[var(--gold,#FBBF24)]" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {error === MANUAL_FILE_MISSING && !loading && (
            <div
              role="alert"
              data-testid="manual-file-missing"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center z-10"
            >
              <div className="text-lg font-bold text-[#E5E7EB] max-w-md">{t(MANUAL_FILE_MISSING)}</div>
              {!embedded && (
                <Link href={sourceUrl ? '/' : '/manuals'} className="btn btn-primary text-sm px-4 py-2">
                  {sourceUrl ? 'Back home' : 'Back to library'}
                </Link>
              )}
            </div>
          )}
          {error === MANUAL_NOT_AVAILABLE && !loading && (
            <div
              role="alert"
              data-testid="manual-not-available"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center z-10"
            >
              <div className="text-lg font-bold text-[#E5E7EB] max-w-md">{t(MANUAL_NOT_AVAILABLE)}</div>
              {!embedded && (
                <Link href={sourceUrl ? '/' : '/manuals'} className="btn btn-primary text-sm px-4 py-2">
                  {sourceUrl ? 'Back home' : 'Back to library'}
                </Link>
              )}
            </div>
          )}
          {error && error !== MANUAL_FILE_MISSING && error !== MANUAL_NOT_AVAILABLE && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center z-10">
              <div className="text-lg font-bold text-red-400">Could not open manual</div>
              <div className="text-sm text-[#9CA3AF] max-w-md">{error}</div>
              {!embedded && (
                <Link href={sourceUrl ? '/' : '/manuals'} className="btn btn-primary text-sm px-4 py-2">
                  {sourceUrl ? 'Back home' : 'Back to library'}
                </Link>
              )}
            </div>
          )}
          {fileOffer && !loading && !error && (
            <div
              data-testid="manual-download"
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center z-10"
            >
              <div className="text-lg font-bold text-[#E5E7EB] max-w-md">
                {fileOffer.message.includes('{type}')
                  ? t(fileOffer.message).replace('{type}', (fileOffer.fileType || 'FILE').toUpperCase())
                  : t(fileOffer.message)}
              </div>
              <a
                href={fileOffer.url}
                download={fileOffer.fileName}
                onClick={reportDownload}
                rel="noopener noreferrer"
                className="btn btn-primary text-sm px-4 py-2"
              >
                {t('Download file')}
              </a>
              {pageCount > 0 && (
                <button
                  type="button"
                  className="text-sm text-[#fbbf24] underline"
                  onClick={() => setFileOffer(null)}
                >
                  {t('Back to the PDF')}
                </button>
              )}
            </div>
          )}
          {showDownloads && downloads.length > 0 && (
            <div className="absolute inset-0 z-10 bg-[#0f172a] p-6 overflow-auto">
              <div className="max-w-xl mx-auto">
                <h2 className="text-xl font-bold text-[var(--gold,#FBBF24)] mb-4">{t('Other files')}</h2>
                <div className="grid gap-2">
                  {downloads.map((item, i) => {
                    const kind = manualFileKind(item.file_type || item.storage_path || '');
                    const sentence = manualDownloadSentence(kind);
                    const label = sentence.includes('{type}')
                      ? t(sentence).replace('{type}', (item.file_type || 'FILE').toUpperCase())
                      : t(sentence);
                    return (
                      <button
                        key={`${item.storage_path || i}`}
                        type="button"
                        onClick={() => void openDownload(item.storage_path || '')}
                        className="text-left rounded-lg border border-[#374151] bg-[#1F2937] px-3 py-3 hover:border-[var(--gold,#FBBF24)]"
                      >
                        <div className="text-sm">{item.title || item.storage_path}</div>
                        <div className="text-[11px] text-[#9CA3AF] mt-1">{label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {showChapters && chapters.length > 0 && (
            <div className="absolute inset-0 z-10 bg-[#0f172a] p-6 overflow-auto">
              <div className="max-w-4xl mx-auto">
                <h2 className="text-xl font-bold text-[var(--gold,#FBBF24)] mb-4">📚 Chapters</h2>
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))' }}>
                  {readingChapters.map((ch, i) => {
                    const current = sameStoragePath(ch.storage_path, openStoragePath);
                    const range = chapterCardPageRange(ch);
                    const card = chapterCardCopy(ch);
                    const href = manualChapterHref({
                      id: manualId,
                      storagePath: ch.storage_path,
                      title: card.title || title,
                    });
                    const tileClass = `text-left rounded-lg border bg-[#1F2937] px-3 py-3 hover:border-[var(--gold,#FBBF24)] ${
                      current ? 'border-[var(--gold,#FBBF24)]' : 'border-[#374151]'
                    }`;
                    const tileBody = (
                      <>
                        <div className="text-sm">{card.title}</div>
                        {card.docNumber || range ? (
                          <div className="mt-1 text-[10px] text-[#9CA3AF]">
                            {card.docNumber ? (
                              <span data-testid="chapter-doc-number">{card.docNumber}</span>
                            ) : null}
                            {card.docNumber && range ? <span> · </span> : null}
                            {range ? <span>{range}</span> : null}
                          </div>
                        ) : null}
                      </>
                    );
                    if (!href) {
                      return (
                        <div key={`${ch.storage_path || i}`} className={tileClass}>
                          {tileBody}
                        </div>
                      );
                    }
                    return (
                      <a
                        key={`${ch.storage_path || i}`}
                        href={href}
                        ref={current ? currentChapterRef : undefined}
                        data-testid="chapter-link"
                        aria-current={current ? 'true' : undefined}
                        onClick={(event) => openChapterFromLink(event, ch)}
                        className={tileClass}
                      >
                        {tileBody}
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {showContents && contents.length > 0 && (
            <div className="absolute inset-0 z-10 bg-[#0f172a] p-6 overflow-auto" data-testid="manual-toc">
              <div className="max-w-xl mx-auto">
                <h2 className="text-xl font-bold text-[var(--gold,#FBBF24)] mb-4">{t('Contents')}</h2>
                <nav aria-label={t('Contents')} className="grid gap-1">
                  {contents.map((entry, i) => {
                    const href = manualTocPageHref({ id: manualId, page: entry.page, title });
                    if (!href) return null;
                    return (
                      <a
                        key={`${entry.depth}-${entry.page}-${i}`}
                        href={href}
                        data-testid="toc-link"
                        onClick={(event) => openContentsPage(event, entry.page)}
                        className="flex items-baseline justify-between gap-3 rounded-md px-3 py-2 text-sm text-[#E5E7EB] hover:bg-[#1F2937] hover:text-[var(--gold,#FBBF24)]"
                        style={{ paddingInlineStart: 12 + entry.depth * 16 }}
                      >
                        <span className="min-w-0">{entry.title}</span>
                        <span className="shrink-0 text-[11px] text-[#9CA3AF] tabular-nums">{entry.page}</span>
                      </a>
                    );
                  })}
                </nav>
              </div>
            </div>
          )}
          {!loading && !error && pages.length > 0 && pdf && pageBoxHeight > 0 && (
            <div key={docEpoch} className="pb-8">
              {pages.map((n) => (
                <PdfPageCanvas
                  key={`${docEpoch}-${n}`}
                  pdf={pdf}
                  pageNumber={n}
                  zoom={zoom}
                  boxHeight={pageBoxHeight}
                  eager={n <= 2 || n === viewerPhysicalPage(deepLinkPage || 0, pageCount)}
                  highlightQuery={hits.includes(n) ? query : ''}
                  onReady={(readyPage) => {
                    if (pendingJump.current === readyPage) jumpToPhysicalPage(readyPage);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
