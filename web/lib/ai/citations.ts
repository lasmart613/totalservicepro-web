/**
 * Structured service-manual citations for AI replies.
 *
 * grok-assistant appends [[cite:id=&p=&s=&t=]] markers from retrieval _meta
 * (manualId / page / section). The client turns those into in-app viewer
 * links — never raw PDF / signed Storage URLs.
 */

/** Keep in sync with MANUAL_VIEW_PATH — avoid importing manuals.ts (Node test vs Next). */
const VIEWER_PATH = '/manuals/view';

export type ManualCitation = {
  manualId: number;
  title?: string;
  page?: number;
  section?: string;
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

/** First explicit page mention in a retrieved passage or model reply. */
export function extractPageRef(text: string): number | undefined {
  const raw = String(text || '');
  const page = raw.match(/\b(?:pages?|pp?\.?)\s*(\d{1,4})\b/i);
  return page?.[1] ? asPositivePage(page[1]) : undefined;
}

export function extractPageRefs(text: string): number[] {
  const raw = String(text || '');
  const out: number[] = [];
  const seen = new Set<number>();
  const re = /\b(?:pages?|pp?\.?)\s*(\d{1,4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const page = asPositivePage(m[1]);
    if (!page || seen.has(page)) continue;
    seen.add(page);
    out.push(page);
  }
  return out.slice(0, 8);
}

/**
 * xAI chunks often omit page_number. If the passage or reply names "page N",
 * attach that to document-level cites so Source chips get `page=`.
 */
export function attachProsePages(citations: ManualCitation[], text: string): ManualCitation[] {
  if (!citations.length) return [];
  const pages = extractPageRefs(text);
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

export function citationViewerHref(c: ManualCitation): string {
  const qs = new URLSearchParams();
  qs.set('id', String(c.manualId));
  if (c.title) qs.set('title', String(c.title).slice(0, 160));
  if (c.page) qs.set('page', String(c.page));
  else if (!c.section) qs.set('page', '1');
  if (c.section) qs.set('section', String(c.section).slice(0, 80));
  return `${VIEWER_PATH}?${qs.toString()}`;
}

export function embedCitationMarker(c: ManualCitation): string {
  const qs = new URLSearchParams();
  qs.set('id', String(c.manualId));
  if (c.page) qs.set('p', String(c.page));
  if (c.section) qs.set('s', String(c.section).slice(0, 80));
  if (c.title) qs.set('t', String(c.title).slice(0, 80));
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
    return { manualId: id, ...(page ? { page } : {}), ...(section ? { section } : {}), ...(title ? { title } : {}) };
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
      const key = `${id}|${page || ''}|${section || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ manualId: id, ...(page ? { page } : {}), ...(section ? { section } : {}), ...(title ? { title } : {}) });
    }
  }
  return out;
}

export function citationLabel(c: ManualCitation): string {
  const title = (c.title || 'Service manual').trim();
  const bits: string[] = [];
  if (c.page) bits.push(`p.${c.page}`);
  if (c.section) bits.push(`§${c.section}`);
  return bits.length ? `${title}, ${bits.join(', ')}` : title;
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
  return `<a class="ai-cite-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

/**
 * Safe HTML for an assistant bubble: escaped text, bold, citation links.
 * Page/section phrases become links only when a scoped manualId is known.
 */
export function formatAssistantHtml(content: string, extra?: ManualCitation[]): string {
  const fromMarkers = parseCitationMarkers(content);
  const citations = attachProsePages(mergeCitations(extra, fromMarkers), stripCitationMarkers(content));
  const scopedId = citations[0]?.manualId;
  let body = stripCitationMarkers(content);
  body = escapeHtml(body);
  body = body.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  if (scopedId) {
    const fallback: ManualCitation = {
      manualId: scopedId,
      title: citations.find((c) => c.title)?.title,
    };
    body = body.replace(/\b((?:page|p\.?)\s*)(\d{1,4})\b/gi, (_all, prefix: string, num: string) => {
      const page = asPositivePage(num);
      const hit = (page && citations.find((c) => c.page === page)) || {
        ...fallback,
        ...(page ? { page } : {}),
      };
      return viewerAnchor(hit, `${prefix}${num}`);
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
    const primary = citations[0];
    if (!primary) return `${lead}— Source: ${src}`;
    return `${lead}— Source: ${viewerAnchor(primary, src.trim() || citationLabel(primary))}`;
  });

  if (citations.length) {
    const chips = citations
      .map((c) => viewerAnchor(c, c.page || c.section ? citationLabel(c) : `Open ${citationLabel(c)}`))
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

export function citationsFromMeta(meta: unknown, fallbackManualId?: number | null): ManualCitation[] {
  const obj = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
  const raw = Array.isArray(obj.citations) ? obj.citations : [];
  const fallbackId =
    Number(obj.manualId) ||
    (fallbackManualId != null && Number.isSafeInteger(fallbackManualId) ? fallbackManualId : 0);
  const parsed = raw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const id = Number(r.manualId ?? r.manual_id ?? fallbackId);
      if (!Number.isSafeInteger(id) || id < 1) return null;
      return {
        manualId: id,
        title: cleanSection(r.title || r.label || obj.manualLabel),
        page: asPositivePage(r.page),
        section: cleanSection(r.section),
      } satisfies ManualCitation;
    })
    .filter((c): c is ManualCitation => !!c);
  if (parsed.length) return mergeCitations(parsed);
  return [];
}
