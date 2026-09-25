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
