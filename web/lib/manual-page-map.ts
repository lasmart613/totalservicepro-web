/**
 * Joined folder-manual page map.
 *
 * The search index numbers pages across every chapter PDF, in chapter_metadata
 * array order (not display order). page N is (file, local page) using the same
 * offsets the indexer uses: skip a file with no pages, otherwise add pdf.js
 * numPages. A missing count omits the whole map so a later page is never shifted.
 */

export type JoinedPagePart = {
  storagePath: string;
  /** null: the count could not be read. 0: the indexer added no pages. */
  pageCount: number | null;
};

export type JoinedPageSpan = {
  storagePath: string;
  pageStart: number;
  pageCount: number;
};

/** Indexer clipPath. Storage keys stay case-sensitive. */
export function indexPathKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[?#].*$/, '');
}

/**
 * Write pdf.js page counts onto existing chapter_metadata entries.
 * Order and dedupe match the joined index: the first copy of a path owns
 * the offset. page_start is the joined page. A 0-page file is stored as 0
 * and does not move later files. Entries the indexer did not count are left
 * unchanged, so a missing count still omits the viewer map.
 */
export function chapterMetadataWithPageCounts(
  metadata: unknown,
  counts: readonly { storagePath: string; pageCount: number }[],
): unknown[] | null {
  if (!Array.isArray(metadata) || !metadata.length) return null;
  const known = new Map<string, number>();
  for (const part of counts) {
    const key = indexPathKey(part.storagePath);
    if (!key || known.has(key)) continue;
    if (!Number.isFinite(part.pageCount) || part.pageCount < 0 || part.pageCount > 9999) continue;
    known.set(key, Math.floor(part.pageCount));
  }
  if (!known.size) return null;
  const spans = buildJoinedPageMap(
    [...known.entries()].map(([storagePath, pageCount]) => ({ storagePath, pageCount })),
  );
  const byPath = new Map(spans.map((span) => [span.storagePath, span]));
  return metadata.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const key = indexPathKey((item as { storage_path?: unknown }).storage_path);
    if (!known.has(key)) return item;
    const pageCount = known.get(key) as number;
    const span = byPath.get(key);
    const copy: Record<string, unknown> = { ...(item as Record<string, unknown>), page_count: pageCount };
    if (span) copy.page_start = span.pageStart;
    else delete copy.page_start;
    return copy;
  });
}

export function buildJoinedPageMap(parts: readonly JoinedPagePart[]): JoinedPageSpan[] {
  const spans: JoinedPageSpan[] = [];
  const seen = new Set<string>();
  let next = 1;
  for (const part of parts) {
    const storagePath = indexPathKey(part.storagePath);
    if (!storagePath || seen.has(storagePath)) continue;
    seen.add(storagePath);
    const count = part.pageCount;
    if (count == null || !Number.isFinite(count) || count < 1) continue;
    const pageCount = Math.floor(count);
    spans.push({ storagePath, pageStart: next, pageCount });
    next += pageCount;
  }
  return spans;
}

export type ResolvedJoinedPage = {
  storagePath: string;
  localPage: number;
  pageStart: number;
  pageCount: number;
  joinedPage: number;
};

export function resolveJoinedPage(
  map: readonly JoinedPageSpan[],
  page: number,
): ResolvedJoinedPage | null {
  if (!Number.isFinite(page) || page < 1) return null;
  const joined = Math.floor(page);
  for (const span of map) {
    const end = span.pageStart + span.pageCount - 1;
    if (joined >= span.pageStart && joined <= end) {
      return {
        storagePath: span.storagePath,
        localPage: joined - span.pageStart + 1,
        pageStart: span.pageStart,
        pageCount: span.pageCount,
        joinedPage: joined,
      };
    }
  }
  return null;
}

export function annotateChaptersWithPageMap<T extends { storage_path: string }>(
  chapters: readonly T[],
  parts: readonly JoinedPagePart[],
): {
  chapters: Array<T & { pageStart?: number; pageCount?: number }>;
  joinedPageCount: number | null;
} {
  const unreadable = parts.some(
    (part) => part.pageCount == null || (typeof part.pageCount === 'number' && !Number.isFinite(part.pageCount)),
  );
  if (unreadable) {
    return { chapters: chapters.map((chapter) => ({ ...chapter })), joinedPageCount: null };
  }
  const map = buildJoinedPageMap(parts);
  const byPath = new Map(map.map((span) => [span.storagePath, span]));
  const annotated = chapters.map((chapter) => {
    const span = byPath.get(indexPathKey(chapter.storage_path));
    if (!span) return { ...chapter };
    return { ...chapter, pageStart: span.pageStart, pageCount: span.pageCount };
  });
  const joinedPageCount = map.reduce((sum, span) => sum + span.pageCount, 0);
  return { chapters: annotated, joinedPageCount: joinedPageCount || null };
}

/** Spans from chapter rows. Null unless they cover joined pages 1..N with no gaps. */
export function joinedMapFromChapters(
  chapters: readonly { storage_path?: string; pageStart?: number; pageCount?: number }[],
): JoinedPageSpan[] | null {
  const spans: JoinedPageSpan[] = [];
  const seen = new Set<string>();
  for (const chapter of chapters) {
    const storagePath = indexPathKey(chapter.storage_path);
    if (!storagePath || seen.has(storagePath)) continue;
    if (chapter.pageStart == null || chapter.pageCount == null) continue;
    if (!Number.isFinite(chapter.pageStart) || !Number.isFinite(chapter.pageCount) || chapter.pageCount < 1) {
      continue;
    }
    seen.add(storagePath);
    spans.push({
      storagePath,
      pageStart: Math.floor(chapter.pageStart),
      pageCount: Math.floor(chapter.pageCount),
    });
  }
  spans.sort((a, b) => a.pageStart - b.pageStart || a.storagePath.localeCompare(b.storagePath));
  if (!spans.length) return null;
  let expect = 1;
  for (const span of spans) {
    if (span.pageStart !== expect) return null;
    expect += span.pageCount;
  }
  return spans;
}

export type ViewerJoinedTarget =
  | {
      kind: 'hit';
      storagePath: string;
      localPage: number;
      joinedPage: number;
      pageStart: number;
      pageCount: number;
    }
  | { kind: 'unmapped' }
  | { kind: 'out-of-range' };

export function viewerTargetForJoinedPage(
  chapters: readonly { storage_path?: string; pageStart?: number; pageCount?: number }[] | null | undefined,
  page: number,
): ViewerJoinedTarget {
  const map = joinedMapFromChapters(chapters || []);
  if (!map) return { kind: 'unmapped' };
  const hit = resolveJoinedPage(map, page);
  if (!hit) {
    if (!Number.isFinite(page) || page < 1) return { kind: 'unmapped' };
    const last = map[map.length - 1];
    const end = last.pageStart + last.pageCount - 1;
    if (Math.floor(page) > end) return { kind: 'out-of-range' };
    return { kind: 'unmapped' };
  }
  return { kind: 'hit', ...hit };
}
