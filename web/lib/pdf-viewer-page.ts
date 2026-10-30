/**
 * Page from a cite fragment: `#page=1329` or `#p=1329`.
 * Query `page=` wins when the caller already has it; this is only the hash.
 */
export function citedPageFromHash(hash: string | null | undefined): string | undefined {
  const raw = String(hash || '').replace(/^#/, '').trim();
  if (!raw) return undefined;
  try {
    const qs = new URLSearchParams(raw);
    const page = qs.get('page') || qs.get('p');
    if (page && page.trim()) return page.trim();
  } catch {
    /* fragment was not a query string */
  }
  const match = raw.match(/(?:^|[?&])(?:page|p)=(\d+)/i);
  return match?.[1];
}

/**
 * Deep-link target for /manuals/view?page=N.
 * N is the physical PDF page. Do not clamp to a shorter loaded range:
 * wait until the document reports at least N pages.
 */
export function viewerPhysicalPage(requested: number, documentPages: number): number | null {
  const page = Math.floor(Number(requested));
  const total = Math.floor(Number(documentPages));
  if (!Number.isFinite(page) || page < 1) return null;
  if (!Number.isFinite(total) || total < 1 || page > total) return null;
  return page;
}

/**
 * Shown when a deep link asks for a page past the loaded PDF.
 * Do not clamp that request onto page 1.
 */
export function viewerPageOutOfRangeNotice(
  requested: number | null | undefined,
  documentPages: number
): string | null {
  const page = Math.floor(Number(requested));
  const total = Math.floor(Number(documentPages));
  if (!Number.isFinite(page) || page < 1) return null;
  if (!Number.isFinite(total) || total < 1 || page <= total) return null;
  return `Page ${page} isn't in this PDF`;
}

/**
 * Notice for a deep link. `flaggedOutOfRange` is `_meta.citations[].page_out_of_range`
 * (marker `oor=1`). That flag shows the notice even before the PDF reports a page count,
 * and even when the loaded file happens to contain that page number.
 */
export function viewerCitedPageNotice(
  requested: number | null | undefined,
  documentPages: number,
  flaggedOutOfRange = false
): string | null {
  const page = Math.floor(Number(requested));
  if (!Number.isFinite(page) || page < 1) return null;
  if (flaggedOutOfRange) return `Page ${page} isn't in this PDF`;
  return viewerPageOutOfRangeNotice(page, documentPages);
}

/** Joined page is past the folder. Single-PDF deep links keep the PDF wording. */
export function viewerFolderOutOfRangeNotice(requested: number | null | undefined): string | null {
  const page = Math.floor(Number(requested));
  if (!Number.isFinite(page) || page < 1) return null;
  return `Page ${page} isn't in this manual`;
}

/** One page is `p. N`. A span is `pp. start–end`. */
export function chapterPageRangeLabel(pageStart: number, pageCount: number): string | null {
  const start = Math.floor(Number(pageStart));
  const count = Math.floor(Number(pageCount));
  if (!Number.isFinite(start) || start < 1 || !Number.isFinite(count) || count < 1) return null;
  if (count === 1) return `p. ${start}`;
  return `pp. ${start}–${start + count - 1}`;
}

/**
 * 1-based rank by joined page start. The array order (service manual first)
 * is the display order and is not rearranged here.
 */
export function chapterTileNumber(
  chapters: readonly { pageStart?: number | null }[],
  index: number,
): number | null {
  const ranked = chapters
    .map((chapter, i) => ({ i, start: Math.floor(Number(chapter.pageStart)) }))
    .filter((chapter) => Number.isFinite(chapter.start) && chapter.start >= 1)
    .sort((a, b) => a.start - b.start || a.i - b.i);
  const place = ranked.findIndex((chapter) => chapter.i === index);
  return place >= 0 ? place + 1 : null;
}

/**
 * Stable placeholder height for one page, including the row's vertical padding.
 * Scroll-to-page must use this before canvases paint, or a short placeholder
 * lands the viewport on an earlier page after layout grows.
 */
export function fittedPageBoxHeight(
  pageWidth: number,
  pageHeight: number,
  containerWidth: number,
  zoom = 1
): number {
  const sidePadding = 24;
  const verticalPadding = 24;
  const avail = Math.max(280, containerWidth - sidePadding);
  const width = Number(pageWidth) || 612;
  const height = Number(pageHeight) || 792;
  const fit = avail / width;
  return Math.max(1, Math.round(height * fit * Math.max(zoom, 0.25)) + verticalPadding);
}
