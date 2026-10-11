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
  manualTitle: string | null;
  manualBrand: string | null;
  manualModel: string | null;
  /** ISO 639-1 site language. The assistant answers in this language. */
  replyLanguage: string | null;
  /** ISO 639-1 of the selected manual. Null when no manual is selected. */
  manualLanguage: string | null;
  messages: ChatMessage[];
  scopeChanged: boolean;
};

/**
 * Build the grok-assistant chat body from the *current* dropdown, not a
 * previously saved path. Changing brand/manual drops prior turns so the
 * model cannot keep citing the last book.
 */
function cleanManualHint(value: unknown): string | null {
  const s = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return s || null;
}

export function buildGrokChatPayload(opts: {
  messages: ChatMessage[];
  manualId?: unknown;
  manualPath?: unknown;
  manualTitle?: unknown;
  manualBrand?: unknown;
  manualModel?: unknown;
  manualLanguage?: unknown;
  replyLanguage?: unknown;
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
    manualTitle: cleanManualHint(opts.manualTitle),
    manualBrand: cleanManualHint(opts.manualBrand),
    manualModel: cleanManualHint(opts.manualModel),
    replyLanguage: cleanManualHint(opts.replyLanguage),
    manualLanguage: cleanManualHint(opts.manualLanguage),
    messages,
    scopeChanged,
  };
}

/**
 * A known catalog id is enough to scope RAG. An empty title must not fall
 * through to an unscoped collection search (PostgREST's 1000-row page used
 * to drop manuals such as id 1086, which then looked "unselected").
 */
export function collectionSearchRequiresManualMatch(opts: {
  manualId?: unknown;
  manualLabel?: unknown;
}): boolean {
  if (asManualId(opts.manualId) != null) return true;
  return String(opts.manualLabel ?? '').trim().length > 0;
}

/** Brand + title, without repeating the brand when the title already starts with it. */
export function manualDisplayLabel(brand: unknown, title: unknown): string {
  const b = String(brand ?? '').trim();
  const t = String(title ?? '').trim();
  if (!b) return t;
  if (!t) return b;
  if (t.toLowerCase().startsWith(b.toLowerCase())) return t;
  return `${b} ${t}`;
}

/**
 * System-prompt block for the open manual. Includes the catalog title and model
 * so the assistant does not ask which chair is selected.
 */
export function selectedManualContext(opts: {
  id?: unknown;
  title?: unknown;
  brand?: unknown;
  model?: unknown;
  storagePath?: unknown;
}): string {
  const id = asManualId(opts.id);
  const brand = String(opts.brand ?? '').trim();
  const title = String(opts.title ?? '').trim();
  const modelRaw = String(opts.model ?? '').trim();
  const model = humanizeDeviceCode(modelRaw);
  const label = manualDisplayLabel(brand, title);
  const path = normalizeManualPath(opts.storagePath) || 'n/a';
  if (id == null && !label && !model) {
    return '\n\n## SELECTED MANUAL\nNone selected. Prefer asking which system if the question is device-specific.';
  }
  const who = label || (id != null ? `manual ${id}` : 'Selected manual');
  const device = [brand, model].filter(Boolean).join(' ') || model;
  const modelBit = model
    ? ` Model: ${device} (catalog model ${modelRaw}).`
    : '';
  return (
    `\n\n## SELECTED MANUAL\n"${who}" is selected (id: ${id ?? 'n/a'}; path: ${path}).${modelBit} ` +
    `Answer only for this device. Use this manual's indexed text before any other book. ` +
    `Do not cite a different manual's pages.`
  );
}

const REPLY_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  fa: 'Farsi',
  es: 'Spanish',
  fr: 'French',
  he: 'Hebrew',
  it: 'Italian',
  de: 'German',
  pt: 'Brazilian Portuguese',
  ar: 'Arabic',
  ja: 'Japanese',
  zh: 'Chinese',
  nl: 'Dutch',
  ko: 'Korean',
  ru: 'Russian',
  pl: 'Polish',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  tr: 'Turkish',
  el: 'Greek',
  cs: 'Czech',
  hu: 'Hungarian',
  ro: 'Romanian',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  hi: 'Hindi',
  fa: 'Farsi',
  uk: 'Ukrainian',
};

/** Site or catalog language. Unknown values stay English so the prompt does not invent a locale. */
export function normalizeReplyLanguage(raw: unknown): string {
  const primary = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .split('-')[0];
  if (/^[a-z]{2}$/.test(primary)) return primary;
  return 'en';
}

function replyLanguageName(code: string): string {
  return REPLY_LANGUAGE_NAMES[code] || code.toUpperCase();
}

/**
 * Tell the model to answer in the technician's site language and still cite
 * the selected manual when that PDF is in another language.
 */
export function assistantLanguageDirective(opts: {
  replyLanguage?: unknown;
  manualLanguage?: unknown;
}): string {
  const reply = normalizeReplyLanguage(opts.replyLanguage);
  const manual = normalizeReplyLanguage(opts.manualLanguage ?? 'en');
  const replyName = replyLanguageName(reply);
  const manualName = replyLanguageName(manual);
  return (
    `\n\n## ANSWER LANGUAGE\n` +
    `The technician's site language is ${replyName} (${reply}). Write the answer in ${replyName}.\n` +
    `The selected manual's catalog language is ${manualName} (${manual}). ` +
    `Still retrieve and cite this manual when it is not ${replyName}. ` +
    `Translate the explanation into ${replyName}. ` +
    `Keep fault codes, part numbers, and short procedure labels in the manual's original wording.`
  );
}

const EXCERPT_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'what', 'does', 'did', 'mean', 'means',
  'how', 'why', 'when', 'where', 'which', 'who', 'with', 'from', 'this', 'that',
  'into', 'about', 'your', 'you', 'our', 'can', 'could', 'would', 'should',
  'please', 'tell', 'have', 'has', 'had', 'not', 'but', 'its', 'than', 'then',
  'them', 'they', 'his', 'her', 'she', 'him', 'any', 'all', 'on', 'of', 'to', 'in',
  'is', 'it', 'or', 'as', 'at', 'by', 'be', 'an', 'if',
]);

function splitExcerptTokens(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}+]+/u)
    .filter(Boolean);
}

/**
 * Terms that score a page. The catalog title is prepended to the search
 * string, and a long title ("… Rev B, June 2012") used to fill the whole
 * budget, so "June" on the title page beat "maximum delivered energy".
 * Question words come first. Title words only fill slots the question left open.
 */
function excerptQueryTerms(query: string, label?: string): string[] {
  const labelTerms = new Set<string>();
  if (label) {
    for (const token of splitExcerptTokens(label)) {
      if (/^\d+$/.test(token) || (token.length >= 2 && !EXCERPT_STOPWORDS.has(token))) labelTerms.add(token);
    }
  }
  const question: string[] = [];
  const fromLabel: string[] = [];
  const seen = new Set<string>();
  for (const token of splitExcerptTokens(query)) {
    if (seen.has(token)) continue;
    const keep = /^\d+$/.test(token) || (token.length >= 2 && !EXCERPT_STOPWORDS.has(token));
    if (!keep) continue;
    seen.add(token);
    if (labelTerms.has(token)) fromLabel.push(token);
    else question.push(token);
    if (question.length >= 12) break;
  }
  const out = question.slice(0, 12);
  for (const term of fromLabel) {
    if (out.length >= 12) break;
    out.push(term);
  }
  return out;
}

function termAt(hay: string, term: string, from: number): number {
  let i = from;
  while (i <= hay.length) {
    const at = hay.indexOf(term, i);
    if (at < 0) return -1;
    const before = at > 0 ? hay.charAt(at - 1) : '';
    const after = hay.charAt(at + term.length);
    const edge = (ch: string) => ch === '' || !/[\p{L}\p{N}+]/u.test(ch);
    // "setting" also matches "settings" on the fluence table page.
    const plural = term.length >= 4 && !term.endsWith('s') && after === 's' && edge(hay.charAt(at + term.length + 1));
    if (edge(before) && (edge(after) || plural)) return at;
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

/** "Page 83 of 178" and "p. 83" are running labels, not the value 83. */
function isRunningPageNumber(hay: string, at: number): boolean {
  const before = hay.slice(Math.max(0, at - 20), at);
  return /(?:^|[^a-z0-9])(?:page|pages|pp)\.?\s+$/.test(before) || /(?:^|[^a-z0-9])p\.\s*$/.test(before);
}

function collectHits(hay: string, term: string): number[] {
  const hits: number[] = [];
  const numeric = /^\d+$/.test(term);
  let from = 0;
  while (hits.length < 8000) {
    const at = termAt(hay, term, from);
    if (at < 0) break;
    from = at + Math.max(1, term.length);
    if (numeric && (gluedManualNumber(hay, term, at) || isRunningPageNumber(hay, at))) continue;
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
      // Title words sit next to "Page 83" on every leaf. Only count them when
      // the number is already an error, a #code, or CW Laser.
      if (add > 0) {
        for (const word of words) {
          const wordHits = positions.get(word) || [];
          if (wordHits.some((where) => where >= winStart && where < winEnd)) add += 8;
        }
      }
      if (add > score) {
        score = add;
        at = hit;
      }
    }
  }
  return { score, at };
}

/** Drop running-header words that are printed on most pages. */
function rareExcerptTerms(terms: string[], df: Map<string, number>, pageCount: number): string[] {
  const rare = terms.filter((term) => {
    const n = df.get(term) || 0;
    return !(pageCount > 1 && n > pageCount * 0.25);
  });
  return rare.length ? rare : terms;
}

/**
 * Consecutive rare terms a few characters apart ("Maximum Fluence").
 * One hit is enough: it marks the spec table, not a later procedure that
 * only mentions one of the words.
 */
function rarePhraseHit(
  terms: string[],
  positions: Map<string, number[]>,
  df: Map<string, number>,
  pageCount: number,
  start: number,
  end: number
): { bonus: number; at: number } {
  const rare = rareExcerptTerms(terms, df, pageCount);
  const gap = 24;
  for (let i = 0; i < rare.length - 1; i++) {
    const left = hitsOnSpan(positions.get(rare[i]) || [], start, end);
    const right = hitsOnSpan(positions.get(rare[i + 1]) || [], start, end);
    for (const ha of left) {
      const limit = ha + rare[i].length + gap;
      for (const hb of right) {
        if (hb < ha + rare[i].length) continue;
        if (hb > limit) break;
        return { bonus: 18, at: ha };
      }
    }
  }
  return { bonus: 0, at: -1 };
}

function queryMentionsTransmission(terms: string[]): boolean {
  return terms.some((term) => term === 'tx' || term.startsWith('transmiss'));
}

/**
 * "If TX = <83%" is the threshold. A later cal-port table that only says
 * "TX 83" or "Average Transmission", and a see-also that names another
 * chapter, are not. Running footers never get here.
 */
function transmissionThresholdBoost(
  hay: string,
  terms: string[],
  positions: Map<string, number[]>,
  start: number,
  end: number
): { bonus: number; at: number } {
  if (!queryMentionsTransmission(terms)) return { bonus: 0, at: -1 };
  const wantsThreshold = terms.some((term) =>
    /^(?:threshold|below|under|above|over|less|greater)$/.test(term)
  );
  let bonus = 0;
  let at = -1;
  const consider = (numAt: number, numLen: number, compared: boolean) => {
    const winStart = Math.max(start, numAt - 90);
    const winEnd = Math.min(end, numAt + numLen + 48);
    const window = hay.slice(winStart, winEnd);
    if (!/\btx\b/.test(window) && !/transmiss/.test(window)) return;
    let add = compared ? 48 : 32;
    if (/\bsee also\b/.test(hay.slice(Math.max(start, numAt - 90), Math.min(end, numAt + 32)))) add -= 48;
    if (add > bonus) {
      bonus = add;
      at = numAt;
    }
  };
  for (const term of terms) {
    if (!/^\d+$/.test(term)) continue;
    for (const hit of hitsOnSpan(positions.get(term) || [], start, end)) {
      if (!/^\s*%/.test(hay.slice(hit + term.length, hit + term.length + 4))) continue;
      const before = hay.slice(Math.max(start, hit - 24), hit);
      const compared = /[<>=]\s*$/.test(before) || /\b(?:below|under|above|over|less|greater)\b/.test(before);
      consider(hit, term.length, compared);
    }
  }
  // "transmission threshold" names no digits. The body still says "TX = <83%".
  if (bonus <= 0 && wantsThreshold) {
    const page = hay.slice(start, end);
    const re = /[<>=]\s*(\d{1,3})\s*%/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(page))) {
      const digits = match[1];
      const numAt = start + match.index + match[0].lastIndexOf(digits);
      consider(numAt, digits.length, true);
    }
  }
  return { bonus, at };
}

/**
 * Letter-prefixed fault tokens (F14.1). The dot is literal and the tail is a
 * word boundary, so F14.1 does not match F14.10.
 * A manual label can look the same (M22). Those tokens are ignoreCodes, not codes.
 */
export function faultCodeTokens(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\b[A-Za-z]{1,6}-?\d+(?:\.\d+)?\b/g;
  for (const match of String(query || '').matchAll(re)) {
    const code = match[0];
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }
  return out;
}

/**
 * Dotted or bare fault numbers ("fault 2.1", "Fault 7", "error 221").
 * Letter-prefixed codes stay in faultCodeTokens. "2.1" is not split into "2" and "1".
 */
function numericFaultCodes(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (code: string) => {
    const trimmed = String(code || '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  const text = String(query || '');
  for (const match of text.matchAll(/\b(?:faults?|errors?|alarms?)\s*(?:codes?\s*)?[#:=-]?\s*(\d+(?:\.\d+)?)\b/gi)) {
    add(match[1]);
  }
  for (const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:faults?|errors?|alarms?)\b/gi)) {
    add(match[1]);
  }
  return out;
}

/** Fault codes in the question. Tokens in ignoreCodes (the manual label) are not codes. */
function faultCodesForQuery(query: string, ignoreCodes?: string[]): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const code of [...faultCodeTokens(query), ...numericFaultCodes(query)]) {
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
  }
  if (!ignoreCodes?.length) return codes;
  const skip = new Set(
    ignoreCodes.map((code) => String(code || '').toLowerCase()).filter(Boolean)
  );
  if (!skip.size) return codes;
  return codes.filter((code) => !skip.has(code.toLowerCase()));
}

function queryAboutParts(query: string): boolean {
  return /\b(?:spare\s+parts?|parts?\s+(?:list|catalog(?:ue)?)|bill\s+of\s+materials|\bbom\b|part\s*(?:no\.?|number|#)s?|replacement\s+parts?)\b/i.test(
    query
  );
}

function queryIsFaultOrTroubleshooting(query: string, ignoreCodes?: string[]): boolean {
  return (
    faultCodesForQuery(query, ignoreCodes).length > 0 ||
    /\b(?:faults?|errors?|alarms?|troubleshoot\w*)\b/i.test(query)
  );
}

/**
 * Spare-parts, parts-list, parts-catalog, and BOM leaves.
 * A heading ("Spare Parts", "Parts List", "Part No.") or a dense part-number table.
 */
function isSparePartsPage(text: string): boolean {
  const body = String(text || '');
  if (/\bspare\s+parts?\b/i.test(body)) return true;
  if (/\bparts?\s+list\b/i.test(body)) return true;
  if (/\bparts?\s+catalog(?:ue)?\b/i.test(body)) return true;
  if (/\bbill\s+of\s+materials\b/i.test(body)) return true;
  if (/\bbom\b/i.test(body) && /\bparts?\b/i.test(body)) return true;
  if (/\bpart\s+nos?\.?\b/i.test(body)) return true;
  const partNumbers = body.match(/\b\d{3,5}-\d{2}-\d{3,5}\b/g);
  if ((partNumbers?.length || 0) >= 4) return true;
  return /\bpart\s*#\b/i.test(body) && /\bitem\s*#/i.test(body);
}

/** Down-rank a parts leaf for a fault or troubleshooting question that is not about parts. */
export function excerptSparePartsDownRank(query: string, pageText: string, ignoreCodes?: string[]): boolean {
  if (queryAboutParts(query) || !queryIsFaultOrTroubleshooting(query, ignoreCodes)) return false;
  return isSparePartsPage(pageText);
}

function queryAboutDiagram(query: string): boolean {
  return /\b(?:schematics?|block\s+diagrams?|wiring\s+diagrams?|interconnect(?:\s+diagram)?s?)\b/i.test(query);
}

/**
 * A functional block diagram or schematic sheet. A fault table that only
 * says "see the block diagram" is not one: the page still has to be the drawing.
 */
export function isDiagramOrSchematicPage(text: string): boolean {
  const body = String(text || '');
  if (/\bfunctional\s+block\s+diagram\b/i.test(body)) return true;
  if (/\bblock\s+diagram\b/i.test(body) && !/\bfault\s*(?:#|codes?|messages?)\b/i.test(body)) return true;
  if (/\b(?:schematics?|wiring\s+diagram)\b/i.test(body) && !/\bfault\s*(?:#|codes?)\b/i.test(body)) return true;
  return false;
}

/** Down-rank a diagram for a fault question, the same way a parts leaf is down-ranked. */
export function excerptDiagramDownRank(query: string, pageText: string, ignoreCodes?: string[]): boolean {
  if (queryAboutDiagram(query) || !queryIsFaultOrTroubleshooting(query, ignoreCodes)) return false;
  return isDiagramOrSchematicPage(pageText);
}

/**
 * Where this fault code sits on the page, or -1.
 * F14.1 and 2.1 are exact tokens. A figure number such as 6-43 is not error 43.
 * A one- or two-digit code ("Fault 7", "Fault 2") counts only next to the word
 * fault, error, or alarm, so "Page 2 of 5" does not.
 */
function pageHasQueryFaultCode(hay: string, code: string): number {
  const token = String(code || '').toLowerCase();
  if (!token) return -1;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'gi');
  const text = String(hay || '').toLowerCase();
  const lettered = /[a-z]/i.test(token);
  const short = !lettered && !token.includes('.') && token.replace(/\D/g, '').length < 3;
  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0;
    if (!lettered && gluedManualNumber(text, token, at)) continue;
    if (!short) return at;
    const window = text.slice(Math.max(0, at - 40), at + token.length + 24);
    if (/\b(?:faults?|errors?|alarms?)\b/i.test(window)) return at;
  }
  return -1;
}

const CHAPTER_LANG_CODES: Record<string, string> = {
  english: 'en',
  en: 'en',
  portuguese: 'pt',
  brazilian: 'pt',
  pt: 'pt',
  spanish: 'es',
  espanol: 'es',
  es: 'es',
  french: 'fr',
  fr: 'fr',
  german: 'de',
  deutsch: 'de',
  de: 'de',
  italian: 'it',
  it: 'it',
  dutch: 'nl',
  nl: 'nl',
  chinese: 'zh',
  zh: 'zh',
  japanese: 'ja',
  ja: 'ja',
  greek: 'el',
  el: 'el',
  russian: 'ru',
  ru: 'ru',
};

export type ChapterLanguageHint = { language: string; markers: string[] };

export type ExcerptLanguageBias = { prefer: string; hints: ChapterLanguageHint[] };

export type ExcerptRankScope = {
  /** Catalog title. Its tokens must not crowd out the question. */
  label?: string;
  language?: ExcerptLanguageBias;
};

/** chapter_metadata.language plus a part number that shows up in that file's header. */
export function chapterLanguageHints(chapters: unknown): ChapterLanguageHint[] {
  if (!Array.isArray(chapters)) return [];
  const out: ChapterLanguageHint[] = [];
  for (const item of chapters) {
    if (!item || typeof item !== 'object') continue;
    const raw = String((item as { language?: unknown }).language ?? '')
      .trim()
      .toLowerCase();
    if (!raw) continue;
    const primary = raw.split(/[^a-z]+/).filter(Boolean)[0] || '';
    const language = CHAPTER_LANG_CODES[raw] || CHAPTER_LANG_CODES[primary];
    if (!language) continue;
    const blob = `${(item as { storage_path?: unknown }).storage_path || ''} ${(item as { title?: unknown }).title || ''}`;
    const markers = [
      ...new Set((blob.match(/\d{3,5}-\d{2}-\d{3,5}/g) || []).map((part) => part.toLowerCase())),
    ];
    if (!markers.length) continue;
    out.push({ language, markers });
  }
  return out;
}

const QUESTION_LANGUAGE: Array<{ code: string; re: RegExp }> = [
  { code: 'pt', re: /\b(?:não|nao|falha|página|pagina|qual|deve|são|sao|também|tambem|verifique|certifique)\b/gi },
  { code: 'es', re: /\b(?:qué|cuál|cual|cómo|falla|página|pagina|debe|también|tambien)\b/gi },
  { code: 'de', re: /\b(?:nicht|fehler|seite|muss|prüfen|prufen|für)\b/gi },
  { code: 'fr', re: /\b(?:erreur|doit|vérifiez|verifiez|pour|avec)\b/gi },
];

/** Question language when the wording is clearly not English. Otherwise undefined. */
export function detectQuestionLanguage(question: string): string | undefined {
  const text = String(question || '');
  let best: string | undefined;
  let bestN = 0;
  for (const row of QUESTION_LANGUAGE) {
    const n = text.match(row.re)?.length || 0;
    if (n >= 2 && n > bestN) {
      best = row.code;
      bestN = n;
    }
  }
  return best;
}

/** User locale, else the question language, else English. */
export function preferredExcerptLanguage(opts: { replyLanguage?: unknown; question?: string }): string {
  const asked = detectQuestionLanguage(opts.question || '');
  if (asked) return asked;
  const reply = String(opts.replyLanguage ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .split('-')[0];
  if (/^[a-z]{2}$/.test(reply)) return reply;
  return 'en';
}

const FOREIGN_PAGE_WORDS: Record<string, RegExp> = {
  pt: /\b(?:falha|página|pagina|não|nao|certifique|verifique|fluxo|janelas)\b/gi,
  es: /\b(?:falla|página|pagina|debe|verifique|flujo)\b/gi,
  de: /\b(?:fehler|seite|prüfen|prufen|nicht|muss)\b/gi,
  fr: /\b(?:erreur|vérifiez|verifiez|doit)\b/gi,
};

function pageLanguageCodes(pageText: string, hints: ChapterLanguageHint[]): string[] {
  const hay = String(pageText || '').toLowerCase();
  const codes: string[] = [];
  for (const hint of hints) {
    if (hint.markers.some((marker) => hay.includes(marker))) codes.push(hint.language);
  }
  return codes;
}

/** True when this page belongs to a chapter in some other language than the one we prefer. */
export function excerptLanguageDownRank(pageText: string, bias?: ExcerptLanguageBias): boolean {
  if (!bias?.prefer) return false;
  const codes = pageLanguageCodes(pageText, bias.hints || []);
  if (codes.length) return !codes.includes(bias.prefer);
  if (bias.prefer !== 'en') return false;
  const hay = String(pageText || '');
  for (const [code, re] of Object.entries(FOREIGN_PAGE_WORDS)) {
    if (code === bias.prefer) continue;
    if ((hay.match(re)?.length || 0) >= 2) return true;
  }
  return false;
}

/** F14.10 contains the characters of F14.1 plus another digit. That is a different code. */
function pageHasExtendedFaultCode(hay: string, code: string): boolean {
  const needle = String(code || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!needle) return false;
  return new RegExp(`(?<![a-z0-9])${needle}\\d`, 'i').test(String(hay || '').toLowerCase());
}

/**
 * Score multiplier for one page.
 * Parts leaves and diagram/schematic sheets drop for fault and troubleshooting questions.
 * A page in another language than the question (or English, by default) drops too.
 * A longer code (F14.10) does not collect the score of the shorter code (F14.1).
 */
export function excerptSpanScoreScale(
  query: string,
  pageText: string,
  ignoreCodes?: string[],
  language?: ExcerptLanguageBias
): number {
  let scale = 1;
  if (excerptSparePartsDownRank(query, pageText, ignoreCodes)) scale *= 0.25;
  if (excerptDiagramDownRank(query, pageText, ignoreCodes)) scale *= 0.25;
  if (excerptLanguageDownRank(pageText, language)) scale *= 0.15;
  const codes = faultCodesForQuery(query, ignoreCodes);
  if (
    codes.length &&
    codes.every((code) => pageHasQueryFaultCode(pageText, code) < 0) &&
    codes.some((code) => pageHasExtendedFaultCode(pageText, code))
  ) {
    scale *= 0.05;
  }
  return scale;
}

/**
 * Page that contains the fault code itself (F14.1, not F14.10; Fault 2.1, not 12.1).
 * A spare-parts leaf or a block diagram loses to another page that also contains
 * the code, unless the question is about parts or diagrams.
 * Returns -1 when no page has the code.
 */
export function excerptFaultCodeAnchor(
  hay: string,
  query: string,
  spans: Array<{ start: number; end: number }>,
  scoreByStart: Map<number, number>,
  ignoreCodes?: string[]
): number {
  const codes = faultCodesForQuery(query, ignoreCodes);
  if (!codes.length) return -1;
  const aboutParts = queryAboutParts(query);
  const aboutDiagram = queryAboutDiagram(query);
  const hits: Array<{ at: number; score: number; parts: boolean; diagram: boolean }> = [];
  for (const span of spans) {
    const page = hay.slice(span.start, span.end);
    let at = -1;
    for (const code of codes) {
      const hit = pageHasQueryFaultCode(page, code);
      if (hit < 0) continue;
      at = span.start + hit;
      break;
    }
    if (at < 0) continue;
    hits.push({
      at,
      score: scoreByStart.get(span.start) ?? 0,
      parts: isSparePartsPage(page),
      diagram: isDiagramOrSchematicPage(page),
    });
  }
  if (!hits.length) return -1;
  let pool = hits;
  if (!aboutParts && pool.some((hit) => !hit.parts)) pool = pool.filter((hit) => !hit.parts);
  if (!aboutDiagram && pool.some((hit) => !hit.diagram)) pool = pool.filter((hit) => !hit.diagram);
  pool.sort((a, b) => b.score - a.score || b.at - a.at);
  return pool[0].at;
}

function contentTermPresent(hay: string, term: string): boolean {
  const numeric = /^\d+$/.test(term);
  let from = 0;
  while (from <= hay.length) {
    const at = termAt(hay, term, from);
    if (at < 0) return false;
    if (!numeric || !isRunningPageNumber(hay, at)) return true;
    from = at + Math.max(1, term.length);
  }
  return false;
}

function distinctiveQuoteTerms(
  query: string,
  indexText: string,
  ignoreCodes?: string[]
): { numbers: string[]; words: string[] } {
  const terms = excerptQueryTerms(query);
  const hay = String(indexText || '').toLowerCase();
  const spans = manualPageSpans(hay);
  const skip = new Set((ignoreCodes || []).map((code) => String(code || '').toLowerCase()).filter(Boolean));
  const numbers: string[] = [];
  const words: string[] = [];
  for (const term of terms) {
    if (skip.has(term)) continue;
    if (/^\d$/.test(term)) continue;
    const positions = hay ? collectHits(hay, term) : [];
    let pages = 0;
    for (const span of spans) {
      if (positions.some((hit) => hit >= span.start && hit < span.end)) pages += 1;
    }
    if (!pages) continue;
    if (spans.length > 1 && pages > spans.length * 0.25) continue;
    if (/^\d+$/.test(term)) numbers.push(term);
    else if (term.length >= 2) words.push(term);
  }
  return { numbers, words };
}

/**
 * How well this page backs a page the answer named.
 * A fault-code question only matches a page that contains that exact code.
 * Otherwise the page must contain the distinctive query terms. A multi-digit
 * value such as 83 counts only outside a running footer ("Page 83 of 178").
 * Returns 0 when the page lacks the code and the terms.
 */
export function quotedPageSupport(
  pageText: string,
  query: string,
  indexText: string,
  ignoreCodes?: string[]
): number {
  const codes = faultCodesForQuery(query, ignoreCodes);
  let codeHits = 0;
  for (const code of codes) {
    if (pageHasQueryFaultCode(pageText, code) >= 0) codeHits += 1;
  }
  if (codes.length > 0 && codeHits === 0) return 0;
  const { numbers, words } = distinctiveQuoteTerms(query, indexText, ignoreCodes);
  const hay = String(pageText || '')
    .toLowerCase()
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ');
  let numberHits = 0;
  for (const term of numbers) {
    if (contentTermPresent(hay, term)) numberHits += 1;
  }
  if (numbers.length > 0 && numberHits === 0 && codeHits === 0) return 0;
  let wordHits = 0;
  for (const term of words) {
    if (contentTermPresent(hay, term)) wordHits += 1;
  }
  if (codeHits > 0) return 100 + codeHits * 10 + wordHits + numberHits;
  if (words.length >= 2 && wordHits < 2 && numberHits === 0) return 0;
  if (words.length > 0 && wordHits === 0) return 0;
  if (wordHits + numberHits <= 0) return 0;
  return wordHits + numberHits;
}

/**
 * Anchor where the specific query terms cluster.
 * Error codes (#43, a bare 43 beside CW Laser, error 43) and multi-word phrases
 * outrank a brand word. Terms are weighted by how many pages they appear on.
 * A running header is not a phrase. "Page 83" is not the value 83.
 * An adjacent rare pair ("Maximum Fluence") outranks a later page that only
 * shares one of those words. A transmission percentage threshold ("TX = <83%")
 * outranks a later weak "TX 83" or see-also.
 * Equal scores prefer the later hit so a contents line loses to the procedure.
 * A fault code (F14.1, not F14.10; Fault 2.1) is cited on the page that contains that token.
 * Spare-parts leaves and diagram sheets are down-ranked for fault questions
 * unless the question is about parts or diagrams.
 * A catalog title passed in scope does not outrank the question.
 * Returns -1 when nothing in the query is present.
 */
function excerptAnchor(raw: string, query: string, ignoreCodes?: string[], scope?: ExcerptRankScope): number {
  const hay = String(raw || '').toLowerCase();
  const terms = excerptQueryTerms(query, scope?.label);
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
  const scoreByStart = new Map<number, number>();
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
    const chain = orderedTermChain(
      rareExcerptTerms(terms, df, spans.length),
      positions,
      span.start,
      span.end
    );
    if (chain.len >= 3) score += chain.len * 8;
    if (chain.len >= 5) score += 24;
    const phrase = rarePhraseHit(terms, positions, df, spans.length, span.start, span.end);
    score += phrase.bonus;
    const threshold = transmissionThresholdBoost(hay, terms, positions, span.start, span.end);
    score += threshold.bonus;
    const code = errorCodeBoost(hay, terms, positions, span.start, span.end);
    score += code.score;
    let at = chain.len >= 3 && chain.at >= 0 ? chain.at : rareAt;
    if (phrase.at >= 0) at = phrase.at;
    if (threshold.bonus >= 32 && threshold.at >= 0) at = threshold.at;
    if (code.score >= 36 && code.at >= 0) at = code.at;
    const head = hay.slice(span.start, Math.min(span.end, span.start + 48));
    const stamped = /\[\[pdfpage:\d{1,4}\]\]/.exec(head);
    if (stamped && at < span.start + stamped.index + stamped[0].length) {
      at = Math.min(span.end - 1, span.start + stamped.index + stamped[0].length);
    }
    if (at < span.start) at = span.start;
    // Scale before the fault-code pick. A later translation of the same code
    // must not beat the preferred language on an equal raw score.
    score *= excerptSpanScoreScale(query, hay.slice(span.start, span.end), ignoreCodes, scope?.language);
    scoreByStart.set(span.start, score);
    if (score > bestScore || (score === bestScore && at > bestAt)) {
      bestScore = score;
      bestAt = at;
    }
  }
  const faultAt = excerptFaultCodeAnchor(hay, query, spans, scoreByStart, ignoreCodes);
  if (faultAt >= 0) return faultAt;
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
export function indexedExcerptPage(
  raw: string,
  query: string,
  ignoreCodes?: string[],
  scope?: ExcerptRankScope
): number | undefined {
  const text = String(raw || '');
  if (!text) return undefined;
  const at = excerptAnchor(text, query, ignoreCodes, scope);
  if (at < 0) return undefined;
  const before = text.slice(0, at);
  const stamped = lastPhysicalPageStamp(before);
  if (stamped) return stamped;
  const feeds = before.match(/\f/g);
  if (feeds && feeds.length) return Math.min(9999, feeds.length + 1);
  return undefined;
}

const HEADING_UNITS = new Set([
  'hz', 'khz', 'mhz', 'j', 'mj', 'nm', 'mm', 'cm', 'ms', 'sec', 'min', 'vac', 'vdc',
  'ma', 'kw', 'in', 'ft', 'joule', 'joules', 'watt', 'watts', 'volt', 'volts', 'amp', 'amps',
]);

/**
 * Section label on the physical page that owns `anchor`.
 * Accepts a numbered heading ("13 Preventative", "5.5.4 Error Codes", "Section 8.4")
 * and a chapter heading that is not a see-also. Drops list items ("6)"), units
 * ("2 Hz"), part numbers ("7122-00-…"), and "see Chapter 26".
 * No label when nothing on this page looks like a heading.
 */
export function sectionHeadingOnPage(raw: string, anchor: number): string | undefined {
  const text = String(raw || '');
  if (!text || anchor < 0) return undefined;
  const startBound = text.lastIndexOf('\f', Math.max(0, anchor - 1));
  const start = startBound < 0 ? 0 : startBound + 1;
  const endBound = text.indexOf('\f', anchor);
  const end = endBound < 0 ? text.length : endBound;
  const page = text.slice(start, end).replace(/\[\[pdfpage:\d+\]\]/g, ' ');
  const local = Math.max(0, anchor - start);
  type Hit = { at: number; label: string; chapter: boolean };
  const hits: Hit[] = [];
  const numRe = /(?:^|\s)(\d{1,2}(?:\.\d{1,2}){0,3})([ \t]+)([A-Za-z][A-Za-z0-9/+-]*)/g;
  for (const match of page.matchAll(numRe)) {
    const num = match[1];
    const gap = match[2];
    const word = match[3];
    // "43   Power" is a table column. A heading uses a single space.
    if (gap.length !== 1) continue;
    if (word.length < 3 || HEADING_UNITS.has(word.toLowerCase())) continue;
    if (!/^[A-Z]/.test(word)) continue;
    const at = (match.index ?? 0) + match[0].indexOf(num);
    const pre = page.slice(Math.max(0, at - 24), at);
    if (/\b(?:pages?|pp?\.|p[áa]gina|seite)\s*$/i.test(pre)) continue;
    if (/\b(?:faults?|errors?|alarms?)\b/i.test(pre)) continue;
    hits.push({ at, label: num, chapter: false });
  }
  const keyRe = /\b(section|sect\.?|chapter|ch\.)\s*(\d{1,2}(?:\.\d{1,2}){0,3})\b/gi;
  for (const match of page.matchAll(keyRe)) {
    const at = match.index ?? 0;
    const before = page.slice(Math.max(0, at - 30), at);
    if (/\b(?:see|refer|also|cf\.?|per)\b/i.test(before)) continue;
    if (/[•·\-–—*]\s*$/.test(before)) continue;
    const num = match[2];
    const chapter = /^ch/i.test(match[1]);
    hits.push({ at, label: chapter ? `Ch.${num}` : num, chapter });
  }
  const numbered = hits.filter((hit) => !hit.chapter);
  const pool = (numbered.length ? numbered : hits).filter((hit) => hit.at <= local + 80);
  const near = pool.length ? pool : (numbered.length ? numbered : hits).filter((hit) => hit.at <= local + 400);
  if (!near.length) return undefined;
  near.sort((a, b) => b.at - a.at);
  return near[0].label;
}

/** Section heading on the stamped page that owns the anchor. Missing when unsure. */
export function indexedExcerptSection(
  raw: string,
  query: string,
  ignoreCodes?: string[],
  scope?: ExcerptRankScope
): string | undefined {
  const text = String(raw || '');
  if (!text) return undefined;
  const at = excerptAnchor(text, query, ignoreCodes, scope);
  if (at < 0) return undefined;
  return sectionHeadingOnPage(text, at);
}

/**
 * Text sent to the model. The cited page is included in full when it fits,
 * so a hit at the end of the page cannot drop the sentence that answers the question.
 */
export function excerptManualSearchText(
  text: string,
  query: string,
  maxChars = 8000,
  ignoreCodes?: string[],
  scope?: ExcerptRankScope
): string {
  const raw = String(text || '');
  const body = raw
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return '';
  if (body.length <= maxChars) return body;
  const at = excerptAnchor(raw, query, ignoreCodes, scope);
  if (at < 0) return body.slice(0, maxChars);
  const startBound = raw.lastIndexOf('\f', Math.max(0, at - 1));
  const pageStart = startBound < 0 ? 0 : startBound + 1;
  const endBound = raw.indexOf('\f', at);
  const pageEnd = endBound < 0 ? raw.length : endBound;
  const start = pageEnd - pageStart > maxChars ? Math.max(pageStart, at - 400) : pageStart;
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

/** Rewrite snake_case device codes inside an already-built guidance sentence. */
export function humanizeGeneralGuidanceDisplay(content: string): string {
  return String(content || '').replace(/[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+/g, (code) =>
    humanizeDeviceCode(code)
  );
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
