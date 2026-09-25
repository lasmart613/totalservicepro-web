/**
 * Resolve the selected AI-assistant manual without prefix collisions.
 *
 * Live catalog example: Elite Service Manual lives at `shared/cynosure/elite`
 * (folder) while Elite MPX Op Man is `shared/cynosure/elite_mpx/...pdf`.
 * A loose `includes()` / `startsWith(elite)` match picks MPX when the user
 * selects Elite SM. Paths only align on an exact match or a slash boundary.
 */

export type CatalogManual = {
  id?: number | string | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  storage_path?: string | null;
  is_incomplete?: unknown;
};

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

/**
 * Sanitize a manuals-bucket path without changing case.
 * Storage download/list/upload are case-sensitive — mixed-case keys
 * (e.g. Cutera Xeo id 105: `Xeo Service Manual RevB.pdf`) 404 if lowercased.
 */
export function normalizeManualPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[?#].*$/, '');
}

/** Case-folded key for comparing paths only. Never pass this to Storage I/O. */
export function manualPathKey(value: unknown): string {
  return normalizeManualPath(value).toLowerCase();
}

function uniqueStoragePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = manualPathKey(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function asManualId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** True when selected and catalog paths are the same file or one is a folder prefix of the other. */
export function manualPathsAlign(selected: unknown, catalog: unknown): boolean {
  const a = manualPathKey(selected);
  const b = manualPathKey(catalog);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function resolveManualFromCatalog<T extends CatalogManual>(
  catalog: T[],
  opts: { manualId?: unknown; manualPath?: unknown }
): T | null {
  const wantId = asManualId(opts.manualId);
  if (wantId != null) {
    const byId = catalog.find((m) => asManualId(m.id) === wantId);
    if (byId) return byId;
  }

  const path = manualPathKey(opts.manualPath);
  if (!path) return null;

  const matches = catalog.filter((m) => manualPathsAlign(path, m.storage_path));
  matches.sort((a, b) => {
    const ap = manualPathKey(a.storage_path);
    const bp = manualPathKey(b.storage_path);
    const aExact = ap === path ? 1 : 0;
    const bExact = bp === path ? 1 : 0;
    if (bExact !== aExact) return bExact - aExact;
    return bp.length - ap.length;
  });
  return matches[0] || null;
}

export type GrokChatPayload = {
  action: 'chat';
  voiceMode: boolean;
  manualPath: string | null;
  manualId: number | null;
  messages: ChatMessage[];
  scopeChanged: boolean;
};

/**
 * Build the grok-assistant chat body from the *current* dropdown, not a
 * previously saved path. Changing brand/manual drops prior turns so the
 * model cannot keep citing the last book.
 */
export function buildGrokChatPayload(opts: {
  messages: ChatMessage[];
  manualId?: unknown;
  manualPath?: unknown;
  lastSentManualId?: unknown;
  lastSentManualPath?: unknown;
  voiceMode?: boolean;
}): GrokChatPayload {
  const manualId = asManualId(opts.manualId);
  const manualPath = normalizeManualPath(opts.manualPath) || null;
  const lastId = asManualId(opts.lastSentManualId);
  const lastPath = normalizeManualPath(opts.lastSentManualPath) || null;

  const hadPriorScope = lastId != null || lastPath != null;
  const scopeChanged =
    hadPriorScope &&
    (manualId !== lastId ||
      (manualId == null && lastId == null && manualPathKey(manualPath) !== manualPathKey(lastPath)));

  const nonSys = opts.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const messages = scopeChanged
    ? nonSys.filter((m) => m.role === 'user').slice(-1)
    : nonSys.slice(-12);

  return {
    action: 'chat',
    voiceMode: opts.voiceMode === true,
    manualPath,
    manualId,
    messages,
    scopeChanged,
  };
}

const EXCERPT_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'what', 'does', 'did', 'mean', 'means',
  'how', 'why', 'when', 'where', 'which', 'who', 'with', 'from', 'this', 'that',
  'into', 'about', 'your', 'you', 'our', 'can', 'could', 'would', 'should',
  'please', 'tell', 'have', 'has', 'had', 'not', 'but', 'its', 'than', 'then',
  'them', 'they', 'his', 'her', 'she', 'him', 'any', 'all', 'on', 'of', 'to', 'in',
  'is', 'it', 'or', 'as', 'at', 'by', 'be', 'an', 'if',
]);

function excerptQueryTerms(query: string): string[] {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter(Boolean);
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    if (/^\d+$/.test(token)) {
      seen.add(token);
      terms.push(token);
    } else if (token.length >= 2 && !EXCERPT_STOPWORDS.has(token)) {
      seen.add(token);
      terms.push(token);
    }
    if (terms.length >= 12) break;
  }
  return terms;
}

function termAt(hay: string, term: string, from: number): number {
  let i = from;
  while (i <= hay.length) {
    const at = hay.indexOf(term, i);
    if (at < 0) return -1;
    const before = at > 0 ? hay.charAt(at - 1) : '';
    const after = hay.charAt(at + term.length);
    const edge = (ch: string) => ch === '' || /[^a-z0-9+]/.test(ch);
    if (edge(before) && edge(after)) return at;
    i = at + 1;
  }
  return -1;
}

/** Figure and section numbers such as 6-43 or 6.43 are not an error code. #43 still counts. */
function gluedManualNumber(hay: string, term: string, at: number): boolean {
  const before = at > 0 ? hay.charAt(at - 1) : '';
  const after = hay.charAt(at + term.length);
  if (before === '-' || before === '.' || before === '/') return true;
  if (after === '-' || after === '/') return true;
  if (after === '.' && /\d/.test(hay.charAt(at + term.length + 1))) return true;
  return false;
}

function collectHits(hay: string, term: string): number[] {
  const hits: number[] = [];
  const numeric = /^\d+$/.test(term);
  let from = 0;
  while (hits.length < 8000) {
    const at = termAt(hay, term, from);
    if (at < 0) break;
    from = at + Math.max(1, term.length);
    if (numeric && gluedManualNumber(hay, term, at)) continue;
    hits.push(at);
  }
  return hits;
}

function manualPageSpans(hay: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < hay.length; i++) {
    if (hay.charCodeAt(i) !== 12) continue;
    if (i > start) spans.push({ start, end: i });
    start = i + 1;
  }
  if (start < hay.length) spans.push({ start, end: hay.length });
  if (!spans.length) spans.push({ start: 0, end: hay.length });
  return spans;
}

function hitsOnSpan(hits: number[], start: number, end: number): number[] {
  const out: number[] = [];
  for (const hit of hits) {
    if (hit < start) continue;
    if (hit >= end) break;
    out.push(hit);
  }
  return out;
}

/** Rare terms outrank a brand word that is printed on many pages. */
function idfTermWeight(term: string, pageHits: number, pages: number): number {
  const df = Math.max(0, pageHits);
  let w = Math.log((pages + 1) / (df + 1)) + 1;
  if (/^\d+$/.test(term)) w += 4;
  if (pages > 1 && df > pages * 0.25) w *= 0.2;
  return w;
}

const PHRASE_GAP = 120;

function orderedTermChain(
  terms: string[],
  positions: Map<string, number[]>,
  start: number,
  end: number
): { len: number; at: number } {
  const lists = terms.map((term) => hitsOnSpan(positions.get(term) || [], start, end));
  let bestLen = 0;
  let bestAt = -1;
  const walk = (index: number, cursor: number, origin: number, len: number) => {
    if (len > bestLen || (len === bestLen && origin > bestAt)) {
      bestLen = len;
      bestAt = origin;
    }
    if (index >= terms.length) return;
    walk(index + 1, cursor, origin, len);
    const list = lists[index];
    for (const hit of list) {
      if (hit < cursor) continue;
      if (len > 0 && hit > cursor + PHRASE_GAP) break;
      walk(index + 1, hit + terms[index].length, len === 0 ? hit : origin, len + 1);
      break;
    }
  };
  walk(0, start, -1, 0);
  return { len: bestLen, at: bestAt };
}

function errorCodeBoost(
  hay: string,
  terms: string[],
  positions: Map<string, number[]>,
  start: number,
  end: number
): { score: number; at: number } {
  let score = 0;
  let at = -1;
  const words = terms.filter((term) => !/^\d+$/.test(term) && term.length >= 3);
  for (const term of terms) {
    if (!/^\d+$/.test(term)) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const errorRe = new RegExp(`error\\W{0,12}#?\\W{0,4}${escaped}`, 'i');
    const hashRe = new RegExp(`#\\W{0,4}${escaped}`, 'i');
    for (const hit of hitsOnSpan(positions.get(term) || [], start, end)) {
      const winStart = Math.max(start, hit - 60);
      const winEnd = Math.min(end, hit + term.length + 60);
      const window = hay.slice(winStart, winEnd);
      let add = 0;
      if (errorRe.test(window)) add += 48;
      if (hashRe.test(window)) add += 48;
      if (/cw\s+laser/.test(window)) add += 36;
      for (const word of words) {
        const wordHits = positions.get(word) || [];
        if (wordHits.some((where) => where >= winStart && where < winEnd)) add += 8;
      }
      if (add > score) {
        score = add;
        at = hit;
      }
    }
  }
  return { score, at };
}

/**
 * Anchor where the specific query terms cluster.
 * Error codes (#43, a bare 43 beside CW Laser, error 43) and multi-word phrases
 * outrank a brand word. Terms are weighted by how many pages they appear on.
 * Equal scores prefer the later hit so a contents line loses to the procedure.
 * Returns -1 when nothing in the query is present.
 */
function excerptAnchor(raw: string, query: string): number {
  const hay = String(raw || '').toLowerCase();
  const terms = excerptQueryTerms(query);
  if (!hay || !terms.length) return -1;
  const positions = new Map<string, number[]>();
  for (const term of terms) {
    const hits = collectHits(hay, term);
    if (hits.length) positions.set(term, hits);
  }
  if (!positions.size) return -1;

  const spans = manualPageSpans(hay);
  const df = new Map<string, number>();
  for (const [term, hits] of positions) {
    let pages = 0;
    for (const span of spans) {
      if (hits.some((hit) => hit >= span.start && hit < span.end)) pages += 1;
    }
    df.set(term, pages);
  }

  let bestScore = -1;
  let bestAt = -1;
  for (const span of spans) {
    let score = 0;
    let rareAt = -1;
    let rareW = -1;
    for (const term of terms) {
      const hits = positions.get(term);
      if (!hits) continue;
      const onPage = hitsOnSpan(hits, span.start, span.end);
      if (!onPage.length) continue;
      const w = idfTermWeight(term, df.get(term) || onPage.length, spans.length);
      score += w;
      const at = onPage[onPage.length - 1];
      if (w > rareW || (w === rareW && at > rareAt)) {
        rareW = w;
        rareAt = at;
      }
    }
    if (score <= 0) continue;
    const chain = orderedTermChain(terms, positions, span.start, span.end);
    if (chain.len >= 3) score += chain.len * 8;
    if (chain.len >= 5) score += 24;
    const code = errorCodeBoost(hay, terms, positions, span.start, span.end);
    score += code.score;
    let at = chain.len >= 3 && chain.at >= 0 ? chain.at : rareAt;
    if (code.score >= 36 && code.at >= 0) at = code.at;
    const head = hay.slice(span.start, Math.min(span.end, span.start + 48));
    const stamped = /\[\[pdfpage:\d{1,4}\]\]/.exec(head);
    if (stamped && at < span.start + stamped.index + stamped[0].length) {
      at = Math.min(span.end - 1, span.start + stamped.index + stamped[0].length);
    }
    if (at < span.start) at = span.start;
    if (score > bestScore || (score === bestScore && at > bestAt)) {
      bestScore = score;
      bestAt = at;
    }
  }
  return bestAt < 0 || bestScore <= 0 ? -1 : bestAt;
}

function lastPhysicalPageStamp(text: string): number | undefined {
  const stamps = [...String(text || '').matchAll(/\[\[pdfpage:(\d{1,4})\]\]/g)];
  if (!stamps.length) return undefined;
  const n = Number(stamps[stamps.length - 1][1]);
  if (n >= 1 && n <= 9999) return Math.floor(n);
  return undefined;
}

/**
 * Physical PDF page (1-based) for an indexed excerpt.
 * Uses [[pdfpage:N]] stamps or form-feed breaks carried from extraction.
 * Printed labels such as "page 7-8" or "(p. 7)" are not page numbers.
 * Page 1 is not invented when the excerpt has no physical marker.
 */
export function indexedExcerptPage(raw: string, query: string): number | undefined {
  const text = String(raw || '');
  if (!text) return undefined;
  const at = excerptAnchor(text, query);
  if (at < 0) return undefined;
  const before = text.slice(0, at);
  const stamped = lastPhysicalPageStamp(before);
  if (stamped) return stamped;
  const feeds = before.match(/\f/g);
  if (feeds && feeds.length) return Math.min(9999, feeds.length + 1);
  return undefined;
}

/** Section marker nearest the indexed excerpt, when the chunk has no section field. */
export function indexedExcerptSection(raw: string, query: string): string | undefined {
  const text = String(raw || '');
  if (!text) return undefined;
  const at = excerptAnchor(text, query);
  const window = text.slice(Math.max(0, at - 1500), at + 400);
  const sect = window.match(/\b(?:section|sect\.?|§)\s*([0-9]+(?:\.[0-9]+){0,3})\b/i);
  return sect?.[1] || undefined;
}

/** Pull the same clustered hit indexedExcerptPage uses, then strip page stamps. */
export function excerptManualSearchText(text: string, query: string, maxChars = 8000): string {
  const raw = String(text || '');
  const body = raw
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return '';
  if (body.length <= maxChars) return body;
  const at = excerptAnchor(raw, query);
  if (at < 0) return body.slice(0, maxChars);
  const start = Math.max(0, at - 400);
  return raw
    .slice(start, start + maxChars)
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/** PDF to attach when the row is a single file (no chapter_metadata). */
export function pdfPathsForAiAttach(manual: {
  storage_path?: string | null;
  entry_file_path?: string | null;
  chapter_metadata?: unknown;
}): string[] {
  const chapters = Array.isArray(manual.chapter_metadata)
    ? uniqueStoragePaths(
        manual.chapter_metadata
          .map((c) => normalizeManualPath((c as { storage_path?: unknown })?.storage_path))
          .filter((p) => /\.pdf$/i.test(p))
      )
    : [];
  if (chapters.length) return chapters;
  const entry = normalizeManualPath(manual.entry_file_path);
  if (entry && /\.pdf$/i.test(entry)) return [entry];
  const path = normalizeManualPath(manual.storage_path);
  if (path && /\.pdf$/i.test(path)) return [path];
  return [];
}

/** Folder prefix so attach-collection can list Storage PDFs (Elite SM style). */
export function folderPrefixForAiAttach(manual: {
  storage_path?: string | null;
  is_folder?: unknown;
}): string | null {
  const path = normalizeManualPath(manual.storage_path);
  if (!path || /\.pdf$/i.test(path)) return null;
  const folder =
    manual.is_folder === true ||
    manual.is_folder === 1 ||
    manual.is_folder === '1' ||
    manual.is_folder === 'true' ||
    manual.is_folder === 't';
  if (folder || !/\.[a-z0-9]+$/i.test(path)) return path;
  return null;
}

/** True when catalog hints a PDF file or a folder that may contain PDFs. */
export function hasAttachablePdfHint(manual: {
  storage_path?: string | null;
  entry_file_path?: string | null;
  chapter_metadata?: unknown;
  is_folder?: unknown;
}): boolean {
  if (pdfPathsForAiAttach(manual).length) return true;
  return folderPrefixForAiAttach(manual) != null;
}

/** Whole-PDF model attach above either limit times out the 22s responses call. */
export const WHOLE_PDF_ATTACH_MAX_BYTES = 3 * 1024 * 1024;
export const WHOLE_PDF_ATTACH_MAX_PAGES = 60;

export type PdfAttachStat = { bytes?: number | null; pages?: number | null };

/** Allow a signed-URL PDF attach only when every file is small enough to read in time. */
export function wholePdfAttachAllowed(files: PdfAttachStat[]): boolean {
  if (!files.length) return false;
  for (const file of files) {
    const bytes = file?.bytes;
    const pages = file?.pages;
    if (typeof bytes === 'number' && Number.isFinite(bytes) && bytes > WHOLE_PDF_ATTACH_MAX_BYTES) return false;
    if (typeof pages === 'number' && Number.isFinite(pages) && pages > WHOLE_PDF_ATTACH_MAX_PAGES) return false;
  }
  return true;
}

/** Best-effort page count from a PDF byte window (catalog head or trailer tail). */
export function pdfPageCountFromBytes(bytes: Uint8Array | string): number | null {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('latin1').decode(bytes);
  let max = 0;
  const patterns = [
    /\/Type\s*\/Pages\b[\s\S]{0,400}?\/Count\s+(\d+)/g,
    /\/Count\s+(\d+)[\s\S]{0,120}?\/Type\s*\/Pages\b/g,
  ];
  for (const rx of patterns) {
    rx.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text))) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > max && n < 100000) max = n;
    }
  }
  return max > 0 ? max : null;
}

export type GeneralGuidanceDevice = {
  brand?: string | null;
  model?: string | null;
  title?: string | null;
};

const DEVICE_CODE_TOKENS: Record<string, string> = {
  yag: 'YAG',
  co2: 'CO2',
  co2re: 'CO2RE',
  nd: 'Nd',
  er: 'Er',
  ktp: 'KTP',
  ipl: 'IPL',
  rf: 'RF',
  mpx: 'MPX',
  iii: 'III',
  ii: 'II',
  iv: 'IV',
  vi: 'VI',
  vii: 'VII',
  viii: 'VIII',
};

function humanizeDeviceToken(token: string): string {
  const key = token.toLowerCase();
  if (DEVICE_CODE_TOKENS[key]) return DEVICE_CODE_TOKENS[key];
  if (/^[ivx]+$/i.test(token) && token.length <= 4) return token.toUpperCase();
  if (/\d/.test(token)) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** visulas_yag_iii → Visulas YAG III. Mixed-case titles are left alone. */
export function humanizeDeviceCode(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/[A-Z]/.test(raw) && !/[_-]/.test(raw)) return raw;
  if (!/[_-]/.test(raw) && /\s/.test(raw)) return raw;
  const parts = raw.split(/[_\-\s]+/).filter(Boolean);
  if (!parts.length) return raw;
  return parts.map(humanizeDeviceToken).join(' ');
}

const GENERAL_GUIDANCE_LEAD =
  "I couldn't search this manual's text yet, so this is general guidance for the ";

/**
 * Humanize only the device-name span on a general-guidance first line.
 * The rest of the reply (part numbers, fault codes, hyphenated words, URLs) stays as written.
 */
export function humanizeGeneralGuidanceDisplay(content: string): string {
  const text = String(content || '');
  const nl = text.search(/\r?\n/);
  const first = nl === -1 ? text : text.slice(0, nl);
  const rest = nl === -1 ? '' : text.slice(nl);
  if (!first.startsWith(GENERAL_GUIDANCE_LEAD) || !first.endsWith(':')) return text;
  const device = first.slice(GENERAL_GUIDANCE_LEAD.length, -1).trim();
  if (!device) return text;
  return `${GENERAL_GUIDANCE_LEAD}${humanizeDeviceCode(device)}:${rest}`;
}

export type AssistantManualPicker = {
  id: number;
  brand: string;
  storagePath: string;
  title: string;
};

/** Brand + manual row for /ai-assistant?manualId=. Id match is numeric, not string-strict. */
export function assistantManualPicker(
  rows: Array<Pick<CatalogManual, 'id' | 'brand' | 'storage_path' | 'title'>>,
  manualId: unknown
): AssistantManualPicker | null {
  const want = asManualId(manualId);
  if (want == null) return null;
  const hit = rows.find((row) => asManualId(row.id) === want);
  if (!hit) return null;
  const storagePath = String(hit.storage_path || '').trim();
  const title = String(hit.title || '').trim();
  if (!storagePath || !title) return null;
  return {
    id: want,
    brand: String(hit.brand || '').trim(),
    storagePath,
    title,
  };
}

/** Manufacturer + model label for a general-knowledge answer. */
export function generalGuidanceDeviceName(opts?: GeneralGuidanceDevice | null): string {
  const brand = humanizeDeviceCode(String(opts?.brand ?? '').trim());
  let device = humanizeDeviceCode(String(opts?.model ?? '').trim() || String(opts?.title ?? '').trim());
  if (brand && device.toLowerCase().startsWith(brand.toLowerCase())) {
    device = device.slice(brand.length).trim().replace(/^[-–:—\s]+/, '').trim();
  }
  return [brand, device].filter(Boolean).join(' ') || 'this device';
}

/** Visible disclaimer when the reply is not drawn from this manual's text. */
export function generalGuidancePrefix(opts?: GeneralGuidanceDevice | null): string {
  return `I couldn't search this manual's text yet, so this is general guidance for the ${generalGuidanceDeviceName(opts)}:`;
}

/**
 * System-prompt block for the no-index / no-collection / no-fault case.
 * Overrides the empty-source "do not invent" rule for this turn only.
 */
export function generalGuidanceSystemHint(opts?: GeneralGuidanceDevice | null): string {
  const who = generalGuidanceDeviceName(opts);
  return (
    `\n\n## GENERAL GUIDANCE (no manual text)\n` +
    `Override the empty-source rule for this turn. Indexed excerpts and a matching collection file are unavailable, so you cannot quote the ${who} manual. ` +
    `Still answer helpfully from general field-service knowledge for the ${who}. ` +
    `Give typical steps, values, and cautions, and say when a detail varies by revision. ` +
    `Do not claim you read or cited this manual. Do not end with a "— Source:" line. ` +
    `A disclaimer is added for you; do not repeat it.`
  );
}

/** Prefix a model answer and drop a trailing manual citation the prompt would otherwise demand. */
export function prefixGeneralGuidance(content: string, opts?: GeneralGuidanceDevice | null): string {
  const prefix = generalGuidancePrefix(opts);
  let body = String(content || '').trim();
  body = body.replace(/\n*—\s*Source:[\s\S]*$/i, '').trim();
  body = body.replace(/\[\[cite:[^\]]*\]\]/g, '').trim();
  if (!body || body === prefix) return prefix;
  if (body.startsWith(prefix)) return body;
  return `${prefix}\n\n${body}`;
}
