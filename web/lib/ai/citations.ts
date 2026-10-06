/**
 * Structured service-manual citations for AI replies.
 *
 * grok-assistant appends [[cite:id=&p=&s=&t=]] markers from retrieval _meta
 * (manualId / page / section). The client turns those into in-app viewer
 * links — never raw PDF / signed Storage URLs.
 */

import { humanizeGeneralGuidanceDisplay } from './manual-scope.ts';

/** Keep in sync with MANUAL_VIEW_PATH — avoid importing manuals.ts (Node test vs Next). */
const VIEWER_PATH = '/manuals/view';

export type ManualCitation = {
  manualId: number;
  title?: string;
  page?: number;
  section?: string;
  /** `page` is past that PDF. Keep the 1-based number; do not scroll to it. */
  pageOutOfRange?: boolean;
  /** Passage belongs to a different catalog row than the manual open in the assistant. */
  crossManual?: boolean;
};

const CITE_RE = /\[\[cite:([^\]]+)\]\]/gi;

export function asPositivePage(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n < 1 || n > 9999) return undefined;
  return Math.floor(n);
}

export function cleanSection(value: unknown): string | undefined {
  const s = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return s || undefined;
}

/** Heading-style section/chapter from a retrieved passage. */
export function extractSectionRef(text: string): string | undefined {
  const raw = String(text || '');
  const sect = raw.match(/\b(?:section|sect\.?|§)\s*([0-9]+(?:\.[0-9]+){0,3})\b/i);
  if (sect?.[1]) return sect[1];
  const ch = raw.match(/\b(?:ch(?:apter)?\.?)\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (ch?.[1]) return `Ch.${ch[1]}`;
  return undefined;
}

/** A printed span such as "pages 7-8" is a label, not a physical page. */
function isPrintedPageRange(text: string, matchEnd: number): boolean {
  return /^\s*[-–—]\s*\d/.test(text.slice(matchEnd));
}

/** First explicit page mention in a retrieved passage or model reply. */
export function extractPageRef(text: string): number | undefined {
  const raw = String(text || '');
  const re = /\b(?:pages?|pp?\.?)\s*(\d{1,4})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    if (isPrintedPageRange(raw, match.index + match[0].length)) continue;
    const page = asPositivePage(match[1]);
    if (page) return page;
  }
  return undefined;
}

export function extractPageRefs(text: string): number[] {
  const raw = String(text || '');
  const out: number[] = [];
  const seen = new Set<number>();
  const re = /\b(?:pages?|pp?\.?)\s*(\d{1,4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (isPrintedPageRange(raw, m.index + m[0].length)) continue;
    const page = asPositivePage(m[1]);
    if (!page || seen.has(page)) continue;
    seen.add(page);
    out.push(page);
  }
  return out.slice(0, 8);
}

/**
 * Model prose names PRINTED labels ("troubleshooting table on page 7-8", "page 7").
 * Those stay in the text but only become `page=` when the same physical
 * [[pdfpage:N]] stamp is present. Otherwise cites keep the backend's physical page.
 */
export function attachProsePages(citations: ManualCitation[], text: string): ManualCitation[] {
  if (!citations.length) return [];
  const pages = extractPageRefs(text).filter((page) => hasPhysicalPageStamp([text], page));
  if (!pages.length) return mergeCitations(citations);
  const scoped = citations[0];
  const upgraded = citations.map((c, i) => {
    if (c.page) return c;
    const page = pages[i] || pages[0];
    return page ? { ...c, page } : c;
  });
  const have = new Set(upgraded.map((c) => c.page).filter((p): p is number => !!p));
  for (const page of pages) {
    if (have.has(page)) continue;
    upgraded.push({ manualId: scoped.manualId, title: scoped.title, page });
    have.add(page);
  }
  return mergeCitations(upgraded);
}

/**
 * In-app viewer deep link. ManualPdfViewer sends `ai_context: true` on
 * get-manual-url so service-company users can read shared catalog manuals
 * from these links without a company-library slot. The manuals shelf does
 * not send that flag and prompts Add to library when the org does not own it.
 */
export function citationViewerHref(c: ManualCitation): string {
  const qs = new URLSearchParams();
  qs.set('id', String(c.manualId));
  if (c.title) qs.set('title', String(c.title).slice(0, 160));
  if (c.page) qs.set('page', String(c.page));
  else if (!c.section) qs.set('page', '1');
  if (c.section) qs.set('section', String(c.section).slice(0, 80));
  if (c.pageOutOfRange) qs.set('oor', '1');
  return `${VIEWER_PATH}?${qs.toString()}`;
}

export function embedCitationMarker(c: ManualCitation): string {
  const qs = new URLSearchParams();
  qs.set('id', String(c.manualId));
  if (c.page) qs.set('p', String(c.page));
  if (c.section) qs.set('s', String(c.section).slice(0, 80));
  if (c.title) qs.set('t', String(c.title).slice(0, 80));
  if (c.pageOutOfRange) qs.set('oor', '1');
  return `[[cite:${qs.toString()}]]`;
}

export function parseCitationMarkerQuery(raw: string): ManualCitation | null {
  try {
    const qs = new URLSearchParams(String(raw || '').trim());
    const id = Number(qs.get('id') || qs.get('manualId') || '');
    if (!Number.isSafeInteger(id) || id < 1) return null;
    const page = asPositivePage(qs.get('p') || qs.get('page'));
    const section = cleanSection(qs.get('s') || qs.get('section'));
    const title = cleanSection(qs.get('t') || qs.get('title'));
    const oor = String(qs.get('oor') || '').trim().toLowerCase();
    const pageOutOfRange = oor === '1' || oor === 'true';
    return {
      manualId: id,
      ...(page ? { page } : {}),
      ...(section ? { section } : {}),
      ...(title ? { title } : {}),
      ...(pageOutOfRange ? { pageOutOfRange: true } : {}),
    };
  } catch {
    return null;
  }
}

export function parseCitationMarkers(content: string): ManualCitation[] {
  const out: ManualCitation[] = [];
  const seen = new Set<string>();
  const re = new RegExp(CITE_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(content || '')))) {
    const cite = parseCitationMarkerQuery(m[1] || '');
    if (!cite) continue;
    const key = `${cite.manualId}|${cite.page || ''}|${cite.section || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cite);
  }
  return out;
}

export function stripCitationMarkers(content: string): string {
  return String(content || '')
    .replace(CITE_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function mergeCitations(...lists: Array<ManualCitation[] | undefined | null>): ManualCitation[] {
  const out: ManualCitation[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const c of list || []) {
      const id = Number(c?.manualId);
      if (!Number.isSafeInteger(id) || id < 1) continue;
      const page = asPositivePage(c.page);
      const section = cleanSection(c.section);
      const title = cleanSection(c.title);
      const pageOutOfRange = c.pageOutOfRange === true;
      const crossManual = c.crossManual === true;
      const key = `${id}|${page || ''}|${section || ''}`;
      if (seen.has(key)) {
        const prev = out.find((item) => `${item.manualId}|${item.page || ''}|${item.section || ''}` === key);
        if (prev) {
          if (pageOutOfRange) prev.pageOutOfRange = true;
          if (crossManual) prev.crossManual = true;
          if (!prev.title && title) prev.title = title;
        }
        continue;
      }
      seen.add(key);
      out.push({
        manualId: id,
        ...(page ? { page } : {}),
        ...(section ? { section } : {}),
        ...(title ? { title } : {}),
        ...(pageOutOfRange ? { pageOutOfRange: true } : {}),
        ...(crossManual ? { crossManual: true } : {}),
      });
    }
  }
  // A bare document cite (opens page 1) is redundant once the same manual has a physical page/section.
  const located = new Set(out.filter((c) => c.page || c.section).map((c) => c.manualId));
  return out.filter((c) => c.page || c.section || !located.has(c.manualId));
}

export function citationLabel(c: ManualCitation): string {
  const title = (c.title || 'Service manual').trim();
  const bits: string[] = [];
  if (c.page) bits.push(`p.${c.page}`);
  if (c.section) bits.push(`§${c.section}`);
  return bits.length ? `${title}, ${bits.join(', ')}` : title;
}

/** Chip text. A different catalog row is labeled with that row's title, not the open manual. */
export function citationChipLabel(c: ManualCitation): string {
  if (!c.crossManual) return citationLabel(c);
  const title = (c.title || 'Service manual').trim();
  const bits: string[] = [];
  if (c.page) bits.push(`p. ${c.page}`);
  if (c.section) bits.push(`§${c.section}`);
  return bits.length ? `From: ${title}, ${bits.join(', ')}` : `From: ${title}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function viewerAnchor(c: ManualCitation, label: string): string {
  const href = citationViewerHref(c);
  if (!href.startsWith(`${VIEWER_PATH}?`) && href !== VIEWER_PATH) {
    return escapeHtml(label);
  }
  const id = Number(c.manualId);
  const idAttr = Number.isSafeInteger(id) && id >= 1 ? ` data-cite-manual="${id}"` : '';
  const pageAttr = c.page ? ` data-cite-page="${c.page}"` : '';
  const oorAttr = c.pageOutOfRange ? ' data-cite-oor="1"' : '';
  const titleAttr = c.title ? ` data-cite-title="${escapeHtml(c.title)}"` : '';
  return `<a class="ai-cite-link" href="${escapeHtml(href)}"${idAttr}${pageAttr}${oorAttr}${titleAttr}>${escapeHtml(label)}</a>`;
}

function hasPhysicalPageStamp(sources: Array<string | undefined>, page: number): boolean {
  const re = new RegExp(`\\[\\[pdfpage:${page}\\]\\]`);
  return sources.some((src) => re.test(String(src || '')));
}

/**
 * A source line may deep-link only when it names the cited manual.
 * Auriga page labels must not become links to a different open manual.
 */
const SOURCE_TITLE_STOP = new Set([
  'service',
  'manual',
  'operator',
  'system',
  'special',
  'procedure',
  'table',
  'user',
  'guide',
  'technical',
  'repair',
  'the',
  'and',
  'for',
]);

const SOURCE_LINE = /^\s*[—\-]\s*Source:\s*\S/i;
const PAGE_IN_SOURCE = /\b(?:p\.?|pages?)\s*\d{1,4}\b/i;

/** One "— Source:" line. Prefer the last line that names a page. */
export function collapseDuplicateSourceLines(text: string): string {
  const lines = String(text || '').split('\n');
  const indexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SOURCE_LINE.test(lines[i])) indexes.push(i);
  }
  if (indexes.length < 2) return text;
  let keep = -1;
  for (const i of indexes) {
    if (PAGE_IN_SOURCE.test(lines[i])) keep = i;
  }
  if (keep < 0) keep = indexes[indexes.length - 1];
  const drop = new Set(indexes.filter((i) => i !== keep));
  return lines
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function sourceLineMatchesCitation(source: string, citation: ManualCitation | undefined): boolean {
  if (!citation) return false;
  const title = String(citation.title || '')
    .trim()
    .toLowerCase();
  const text = String(source || '')
    .trim()
    .toLowerCase();
  if (!title || !text) return false;
  if (text.includes(title) || title.includes(text)) return true;
  const tokens = title.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !SOURCE_TITLE_STOP.has(t));
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => text.includes(t));
  return hits.length >= Math.min(2, tokens.length);
}

/**
 * Link a source line to a cite that actually names that book.
 * A cross-manual title is used only when the line contains it, so a Pro
 * source line is not rewritten as PRO PLUS (or the reverse).
 */
function sourceLineCitation(source: string, citations: ManualCitation[]): ManualCitation | undefined {
  const hits = citations.filter((c) => sourceLineMatchesCitation(source, c));
  if (!hits.length) return undefined;
  const text = source.toLowerCase();
  const namedCross = hits.find(
    (c) => c.crossManual && c.title && text.includes(c.title.trim().toLowerCase())
  );
  if (namedCross) return namedCross;
  return hits.find((c) => !c.crossManual);
}

/**
 * Safe HTML for an assistant bubble: escaped text, bold, citation links.
 * Page/section phrases become links only when a scoped manualId is known.
 * A printed range links to its first page only when that physical page is stamped.
 */
export function formatAssistantHtml(
  content: string,
  extra?: ManualCitation[],
  indexText?: string
): string {
  const fromMarkers = parseCitationMarkers(content);
  const citations = attachProsePages(mergeCitations(extra, fromMarkers), stripCitationMarkers(content));
  const scopedId = citations[0]?.manualId;
  // Device name on the general-guidance first line only. Never rewrite the reply body.
  let body = humanizeGeneralGuidanceDisplay(stripCitationMarkers(content));
  body = collapseDuplicateSourceLines(body);
  body = escapeHtml(body);
  body = body.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  body = body.replace(/\[\[pdfpage:\d+\]\]/g, '');

  if (scopedId) {
    const fallback: ManualCitation = {
      manualId: scopedId,
      title: citations.find((c) => c.title)?.title,
    };
    body = body.replace(
      /\b((?:pages?|p\.?)\s*)(\d{1,4})(?!\d)\s*([-–—])\s*(\d{1,4})(?!\d)/gi,
      (all, prefix: string, num: string, dash: string, end: string) => {
        const page = asPositivePage(num);
        if (!page || !hasPhysicalPageStamp([content, indexText], page)) return all;
        const hit = citations.find((c) => c.page === page) || { ...fallback, page };
        return viewerAnchor(hit, `${prefix}${num}${dash}${end}`);
      }
    );
    body = body.replace(
      /\b((?:pages?|p\.?)\s*)(\d{1,4})(?!\d)(?!\s*[-–—]\s*\d)/gi,
      (all, prefix: string, num: string) => {
      const page = asPositivePage(num);
      // A printed "page 7" stays plain unless a cite or stamp says that physical page.
      // Do not retarget it at page 1 of a different open manual.
      const physical = !!page && hasPhysicalPageStamp([content, indexText], page);
      const hit = page ? citations.find((c) => c.page === page) : undefined;
      if (hit) return viewerAnchor(hit, `${prefix}${num}`);
      if (physical && page) return viewerAnchor({ ...fallback, page }, `${prefix}${num}`);
      return all;
    });
    body = body.replace(
      /\b((?:section|sect\.?|§)\s*)([0-9]+(?:\.[0-9]+){0,3})\b/gi,
      (_all, prefix: string, num: string) => {
        const hit = citations.find((c) => c.section === num) || { ...fallback, section: num };
        return viewerAnchor(hit, `${prefix}${num}`);
      }
    );
  }

  body = body.replace(/(^|\n|<br\/>)[—\-]\s*Source:\s*([^<\n]+)/gi, (_all, lead: string, src: string) => {
    const primary = sourceLineCitation(src, citations);
    if (!primary) return `${lead}— Source: ${src}`;
    return `${lead}— Source: ${viewerAnchor(primary, src.trim() || citationChipLabel(primary))}`;
  });

  if (citations.length) {
    const chips = citations
      .map((c) =>
        viewerAnchor(c, c.crossManual || c.page || c.section ? citationChipLabel(c) : `Open ${citationChipLabel(c)}`)
      )
      .join(' · ');
    body += `<div class="ai-cite-row">${chips}</div>`;
  }

  return body.replace(/\n/g, '<br/>');
}

export function formatUserHtml(content: string): string {
  return escapeHtml(String(content || ''))
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

/**
 * Citations to show under an assistant reply.
 * General-guidance replies are model knowledge, so they do not deep-link the selected manual.
 */
export function citationsForAssistantReply(
  meta: unknown,
  fallbackManualId: number | null | undefined,
  content: string
): ManualCitation[] {
  const obj = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
  if (obj.generalGuidance === true) return [];
  const fromMeta = citationsFromMeta(meta, fallbackManualId ?? null);
  const metaId = Number(obj.manualId);
  const fallbackId = Number(fallbackManualId);
  // Keep cites the server attributed to another catalog row (manual 5 while 110 is open).
  // Do not relabel those as the open manual. An empty list still must not invent one.
  if (fromMeta.length) return attachProsePages(fromMeta, String(content || ''));
  // The viewer id alone must not invent a page-1 cite. That retargeted
  // Auriga source lines onto the open manual when the server had not scoped it.
  const serverConfirmed =
    Number.isSafeInteger(metaId) &&
    metaId > 0 &&
    (obj.hasManualPassages === true || obj.hasCollectionPdfs === true) &&
    (!Number.isSafeInteger(fallbackId) || fallbackId < 1 || fallbackId === metaId);
  if (!serverConfirmed) return [];
  const title = cleanSection(obj.manualLabel);
  return attachProsePages(
    [{ manualId: metaId, ...(title ? { title } : {}) }],
    String(content || '')
  );
}

export function citationsFromMeta(meta: unknown, fallbackManualId?: number | null): ManualCitation[] {
  const obj = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
  const raw = Array.isArray(obj.citations) ? obj.citations : [];
  const fallbackId =
    Number(obj.manualId) ||
    (fallbackManualId != null && Number.isSafeInteger(fallbackManualId) ? fallbackManualId : 0);
  const parsed: ManualCitation[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const explicit = Number(r.manualId ?? r.manual_id);
    const id = Number.isSafeInteger(explicit) && explicit >= 1 ? explicit : fallbackId;
    if (!Number.isSafeInteger(id) || id < 1) continue;
    const own = !(fallbackId > 0) || id === fallbackId;
    const title = cleanSection(r.title || r.label || (own ? obj.manualLabel : ''));
    const page = asPositivePage(r.page);
    const section = cleanSection(r.section);
    const pageOutOfRange = r.page_out_of_range === true || r.pageOutOfRange === true;
    parsed.push({
      manualId: id,
      ...(title ? { title } : {}),
      ...(page ? { page } : {}),
      ...(section ? { section } : {}),
      ...(pageOutOfRange ? { pageOutOfRange: true } : {}),
      ...(!own ? { crossManual: true } : {}),
    });
  }
  if (parsed.length) return mergeCitations(parsed);
  return [];
}
