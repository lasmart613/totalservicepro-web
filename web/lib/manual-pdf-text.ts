/**
 * Extract searchable text from PDF bytes for the manuals library index.
 * Uses FlateDecode stream inflation + Tj/TJ operators (no extra npm dep).
 * Image-only / scanned PDFs yield little or no text — OCR is out of scope.
 */

import { inflateRawSync, inflateSync } from 'node:zlib';
import { clipManualSearchText } from './manual-search-text.ts';

export { clipManualSearchText, normalizeManualSearchText, MANUAL_SEARCH_TEXT_MAX } from './manual-search-text.ts';

export const MANUAL_SEARCH_PDF_MAX_BYTES = 18_000_000;

const STREAM_RE = /stream\r?\n([\s\S]*?)endstream/g;
const FILTER_WINDOW = 400;

function decodePdfLiteral(inner: string): string {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = inner[i + 1];
    if (next == null) break;
    i += 1;
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b' || next === 'f') out += ' ';
    else if (next >= '0' && next <= '7') {
      let oct = next;
      for (let k = 0; k < 2 && i + 1 < inner.length; k++) {
        const d = inner[i + 1];
        if (d < '0' || d > '7') break;
        oct += d;
        i += 1;
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (next === '\n' || next === '\r') {
      if (next === '\r' && inner[i + 1] === '\n') i += 1;
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHex(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.slice(i, i + 2), 16));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (code) out += String.fromCharCode(code);
    }
    return out;
  }
  return bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : b === 0 ? '' : ' ')).join('');
}

/**
 * TJ kerning is thousandths of a text unit, subtracted from x.
 * A large negative value is a word gap. Small negatives (CO2RE uses about -8
 * per glyph) must stay glued. Tune on the full manual when that file is present.
 */
const TJ_SPACE_KERN = -200;

type TextPiece = string | number | Array<string | number>;

/** Share of alphabetic tokens that are a single letter. Letter-spaced TJ output is near 1. */
export function singleLetterTokenRatio(text: string): number {
  const tokens = String(text || '')
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return 1;
  const singles = tokens.filter((token) => token.length === 1 && /[A-Za-z]/.test(token)).length;
  return singles / tokens.length;
}

/**
 * One left-to-right pass over a content stream.
 * Tj, hex Tj, TJ, ' and " stay in stream order. TJ pieces are concatenated;
 * a space is inserted only for a large negative kern or a space already in the string.
 * Td, TD, T-star, and Tm line moves become newlines, and a large same-line jump becomes a space.
 */
function extractOperators(payload: string): string {
  const out: string[] = [];
  const stack: TextPiece[] = [];
  let i = 0;
  const n = payload.length;
  let textX = 0;
  let textY = 0;
  let hasPos = false;

  function skipSpace(): void {
    while (i < n) {
      const c = payload[i];
      if (c === '%') {
        while (i < n && payload[i] !== '\n') i += 1;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0') {
        i += 1;
        continue;
      }
      break;
    }
  }

  function readLiteral(): string | null {
    if (payload[i] !== '(') return null;
    i += 1;
    let depth = 1;
    let inner = '';
    while (i < n && depth > 0) {
      const c = payload[i];
      if (c === '\\') {
        inner += c;
        i += 1;
        if (i < n) {
          inner += payload[i];
          i += 1;
        }
        continue;
      }
      if (c === '(') {
        depth += 1;
        inner += c;
        i += 1;
        continue;
      }
      if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
        inner += c;
        i += 1;
        continue;
      }
      inner += c;
      i += 1;
    }
    return decodePdfLiteral(inner);
  }

  function readHex(): string | null {
    if (payload[i] !== '<' || payload[i + 1] === '<') return null;
    i += 1;
    const start = i;
    while (i < n && payload[i] !== '>') i += 1;
    const hex = payload.slice(start, i);
    if (payload[i] === '>') i += 1;
    return decodePdfHex(hex);
  }

  function readNumber(): number | null {
    const start = i;
    if (payload[i] === '+' || payload[i] === '-') i += 1;
    const digits = () => {
      let saw = false;
      while (i < n && payload[i] >= '0' && payload[i] <= '9') {
        saw = true;
        i += 1;
      }
      return saw;
    };
    const sawInt = digits();
    let sawFrac = false;
    if (i < n && payload[i] === '.') {
      i += 1;
      sawFrac = digits();
    }
    if (!sawInt && !sawFrac) {
      i = start;
      return null;
    }
    const next = payload[i];
    if (next && /[A-Za-z]/.test(next)) {
      i = start;
      return null;
    }
    const value = Number(payload.slice(start, i));
    if (!Number.isFinite(value)) {
      i = start;
      return null;
    }
    return value;
  }

  function readName(): void {
    if (payload[i] !== '/') return;
    i += 1;
    while (i < n && !/[\s<>[\](){}/%]/.test(payload[i])) i += 1;
  }

  function skipDict(): void {
    if (payload[i] !== '<' || payload[i + 1] !== '<') return;
    i += 2;
    let depth = 1;
    while (i < n && depth > 0) {
      if (payload[i] === '<' && payload[i + 1] === '<') {
        depth += 1;
        i += 2;
        continue;
      }
      if (payload[i] === '>' && payload[i + 1] === '>') {
        depth -= 1;
        i += 2;
        continue;
      }
      if (payload[i] === '(') {
        readLiteral();
        continue;
      }
      i += 1;
    }
  }

  function skipInlineImage(): void {
    const idAt = payload.indexOf('ID', i);
    if (idAt < 0) {
      i = n;
      return;
    }
    i = idAt + 2;
    if (payload[i] === '\r') i += 1;
    if (payload[i] === '\n' || payload[i] === ' ') i += 1;
    const eiAt = payload.indexOf('EI', i);
    i = eiAt < 0 ? n : eiAt + 2;
  }

  function endsWithSpace(): boolean {
    const last = out[out.length - 1];
    return !!last && /\s$/.test(last);
  }

  function breakLine(): void {
    if (!out.length || endsWithSpace()) return;
    out.push('\n');
  }

  function breakSpace(): void {
    if (!out.length || endsWithSpace()) return;
    out.push(' ');
  }

  function moveText(tx: number, ty: number, absolute: boolean): void {
    const x = absolute ? tx : textX + tx;
    const y = absolute ? ty : textY + ty;
    if (!hasPos) {
      hasPos = true;
      textX = x;
      textY = y;
      breakLine();
      return;
    }
    if (Math.abs(y - textY) >= 0.5) breakLine();
    else if (Math.abs(x - textX) >= 12) breakSpace();
    textX = x;
    textY = y;
  }

  function showString(value: string): void {
    if (value) out.push(value);
  }

  function showArray(items: Array<string | number>): void {
    for (const item of items) {
      if (typeof item === 'number') {
        if (item <= TJ_SPACE_KERN) breakSpace();
        continue;
      }
      showString(item);
    }
  }

  while (i < n) {
    skipSpace();
    if (i >= n) break;
    const c = payload[i];
    if (c === '(') {
      const text = readLiteral();
      if (text != null) stack.push(text);
      continue;
    }
    if (c === '<') {
      if (payload[i + 1] === '<') {
        skipDict();
        continue;
      }
      const text = readHex();
      if (text != null) stack.push(text);
      continue;
    }
    if (c === '[') {
      i += 1;
      const items: Array<string | number> = [];
      while (i < n) {
        skipSpace();
        if (i >= n) break;
        if (payload[i] === ']') {
          i += 1;
          break;
        }
        if (payload[i] === '(') {
          const text = readLiteral();
          if (text != null) items.push(text);
          continue;
        }
        if (payload[i] === '<') {
          const text = readHex();
          if (text != null) items.push(text);
          continue;
        }
        const num = readNumber();
        if (num != null) {
          items.push(num);
          continue;
        }
        i += 1;
      }
      stack.push(items);
      continue;
    }
    if (c === '/') {
      readName();
      continue;
    }
    const num = readNumber();
    if (num != null) {
      stack.push(num);
      continue;
    }
    let word = '';
    if (c === "'" || c === '"') {
      word = c;
      i += 1;
    } else if (/[A-Za-z*]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z*]/.test(payload[i])) i += 1;
      word = payload.slice(start, i);
    } else {
      i += 1;
      continue;
    }

    if (word === 'BI') {
      stack.length = 0;
      skipInlineImage();
      continue;
    }
    if (word === 'Tj') {
      const text = stack.pop();
      if (typeof text === 'string') showString(text);
      continue;
    }
    if (word === 'TJ') {
      const items = stack.pop();
      if (Array.isArray(items)) showArray(items);
      continue;
    }
    if (word === "'") {
      const text = stack.pop();
      breakLine();
      if (typeof text === 'string') showString(text);
      continue;
    }
    if (word === '"') {
      const text = stack.pop();
      stack.pop();
      stack.pop();
      breakLine();
      if (typeof text === 'string') showString(text);
      continue;
    }
    if (word === 'Td' || word === 'TD') {
      const ty = Number(stack.pop());
      const tx = Number(stack.pop());
      if (Number.isFinite(tx) && Number.isFinite(ty)) moveText(tx, ty, false);
      continue;
    }
    if (word === 'T*') {
      breakLine();
      textY -= 1;
      continue;
    }
    if (word === 'Tm') {
      const f = Number(stack.pop());
      const e = Number(stack.pop());
      stack.pop();
      stack.pop();
      stack.pop();
      stack.pop();
      if (Number.isFinite(e) && Number.isFinite(f)) moveText(e, f, true);
      continue;
    }
    if (word === 'ET') breakLine();
    stack.length = 0;
  }
  return out.join('');
}

function tryInflate(bytes: Buffer): string | null {
  try {
    return inflateSync(bytes).toString('latin1');
  } catch {
    try {
      return inflateRawSync(bytes).toString('latin1');
    } catch {
      return null;
    }
  }
}

function headerLooksFlate(header: string): boolean {
  return /\/FlateDecode|\/Fl/.test(header);
}

function textFromStream(header: string, raw: string): string {
  if (!raw) return '';
  const payloadBytes = Buffer.from(raw.replace(/^\r?\n/, ''), 'latin1');
  let payload = raw;
  if (headerLooksFlate(header)) {
    const inflated = tryInflate(payloadBytes);
    if (!inflated) return '';
    payload = inflated;
  }
  return extractOperators(payload);
}

function looseStreamText(latin: string): string {
  const parts: string[] = [];
  STREAM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STREAM_RE.exec(latin))) {
    const headerStart = Math.max(0, match.index - FILTER_WINDOW);
    const header = latin.slice(headerStart, match.index);
    const text = textFromStream(header, match[1] || '');
    if (text.trim()) parts.push(text);
  }
  if (!parts.length) {
    const loose = extractOperators(latin);
    if (loose.trim()) parts.push(loose);
  }
  return parts.join('\n');
}

type ScannedObject = { header: string; payload: string | null };

/**
 * Walk objects by /Length so compressed streams are not scanned as objects.
 * Object streams (PDF 1.5+) hold the page tree for manuals such as CO2RE.
 */
function scanPdfObjects(latin: string): Map<number, ScannedObject> {
  const objs = new Map<number, ScannedObject>();
  const re = /(\d+)\s+\d+\s+obj/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin))) {
    const id = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const window = latin.slice(bodyStart, bodyStart + 2000);
    const streamMatch = /stream\r?\n/.exec(window);
    const endObjAt = window.indexOf('endobj');
    if (streamMatch && (endObjAt < 0 || streamMatch.index < endObjAt)) {
      const header = window.slice(0, streamMatch.index);
      const absStream = bodyStart + streamMatch.index + streamMatch[0].length;
      const lengthMatch = header.match(/\/Length\s+(\d+)/);
      let raw = '';
      let nextFrom = absStream;
      if (lengthMatch) {
        const length = Number(lengthMatch[1]);
        raw = latin.slice(absStream, absStream + length);
        nextFrom = absStream + length;
      } else {
        const endStream = latin.indexOf('endstream', absStream);
        raw = endStream >= 0 ? latin.slice(absStream, endStream) : '';
        nextFrom = endStream >= 0 ? endStream : absStream + 1;
      }
      const payload = /FlateDecode|\/Fl\b/.test(header) ? tryInflate(Buffer.from(raw, 'latin1')) : raw;
      objs.set(id, { header, payload });
      const endObj = latin.indexOf('endobj', nextFrom);
      re.lastIndex = endObj >= 0 ? endObj + 6 : nextFrom;
      continue;
    }
    const end = latin.indexOf('endobj', bodyStart);
    if (end < 0) break;
    objs.set(id, { header: latin.slice(bodyStart, end), payload: null });
    re.lastIndex = end + 6;
  }
  return objs;
}

function expandObjectStreams(objs: Map<number, ScannedObject>): Map<number, string> {
  const bodies = new Map<number, string>();
  for (const [id, obj] of objs) {
    bodies.set(id, obj.header);
    if (!obj.payload || !/\/ObjStm\b/.test(obj.header)) continue;
    const first = Number(obj.header.match(/\/First\s+(\d+)/)?.[1]);
    const count = Number(obj.header.match(/\/N\s+(\d+)/)?.[1]);
    if (!Number.isFinite(first) || !Number.isFinite(count) || count < 1) continue;
    const toks = obj.payload.slice(0, first).trim().split(/\s+/);
    if (toks.length < count * 2) continue;
    const packed = obj.payload.slice(first);
    for (let k = 0; k < count; k++) {
      const innerId = Number(toks[k * 2]);
      const off = Number(toks[k * 2 + 1]);
      const end = k + 1 < count ? Number(toks[(k + 1) * 2 + 1]) : packed.length;
      if (!Number.isFinite(innerId) || off < 0 || end < off || end > packed.length) continue;
      bodies.set(innerId, packed.slice(off, end));
    }
  }
  return bodies;
}

function contentObjectIds(body: string): number[] {
  const list = body.match(/\/Contents\s*\[([^\]]*)\]/);
  if (list) return [...list[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
  const one = body.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
  return one ? [Number(one[1])] : [];
}

function pageBodiesInOrder(bodies: Map<number, string>): string[] {
  let root: number | null = null;
  let best = -1;
  for (const [id, body] of bodies) {
    if (!/\/Type\s*\/Pages\b/.test(body)) continue;
    const count = Number(body.match(/\/Count\s+(\d+)/)?.[1] || 0);
    if (count >= best) {
      best = count;
      root = id;
    }
  }
  if (root == null) {
    for (const [id, body] of bodies) {
      if (/\/Type\s*\/Catalog\b/.test(body)) {
        const ref = body.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
        if (ref) root = Number(ref[1]);
        break;
      }
    }
  }
  if (root == null) return [];
  const out: string[] = [];
  const seen = new Set<number>();
  const walk = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const body = bodies.get(id);
    if (!body) return;
    if (/\/Type\s*\/Pages\b/.test(body)) {
      const kids = body.match(/\/Kids\s*\[([^\]]*)\]/);
      if (!kids) return;
      for (const ref of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(ref[1]));
      return;
    }
    if (/\/Type\s*\/Page(?!s)\b/.test(body)) out.push(body);
  };
  walk(root);
  return out;
}

function textForContent(id: number, objs: Map<number, ScannedObject>): string {
  const obj = objs.get(id);
  if (!obj?.payload) return '';
  return extractOperators(obj.payload);
}

export type PdfPageText = { page: number; text: string };

/**
 * One page-tree walk. `pages` is the requested physical slice; `total` is the
 * whole tree so a chunked reindex can resume without a second parse.
 */
export function extractPdfPageSlice(
  bytes: Uint8Array | Buffer,
  range?: { from?: number; count?: number }
): { total: number; pages: PdfPageText[] } {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!buf.length) return { total: 0, pages: [] };
  const latin = buf.toString('latin1');
  const objs = scanPdfObjects(latin);
  const ordered = pageBodiesInOrder(expandObjectStreams(objs));
  const from = Math.max(1, Math.floor(Number(range?.from) || 1));
  const to = range?.count == null ? ordered.length : from + Math.max(0, Math.floor(range.count)) - 1;
  const pages: PdfPageText[] = [];
  ordered.forEach((body, index) => {
    const page = index + 1;
    if (page < from || page > to) return;
    pages.push({
      page,
      text: contentObjectIds(body)
        .map((id) => textForContent(id, objs))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    });
  });
  return { total: ordered.length, pages };
}

/** Physical pages in tree order. Empty when the file has no readable page tree. */
export function extractPdfPages(
  bytes: Uint8Array | Buffer,
  range?: { from?: number; count?: number }
): PdfPageText[] {
  return extractPdfPageSlice(bytes, range).pages;
}

/** Index text with a [[pdfpage:N]] stamp and a form feed before every page after the first. */
export function stampPdfPages(pages: PdfPageText[]): string {
  if (!pages.length) return '';
  return pages.map((page) => `[[pdfpage:${page.page}]] ${page.text}`.trim()).join('\f');
}

/**
 * Pull visible strings from PDF content streams. Best-effort for typical
 * service-manual PDFs; not a full renderer. Multi-page files keep the
 * physical page index (form feed + [[pdfpage:N]]), not the printed label.
 */
/** Keep late physical pages. A 161-page manual does not fit in the old 200k clip. */
export const PDF_INDEX_TEXT_MAX = 1_500_000;

export function extractPdfSearchText(bytes: Uint8Array | Buffer): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!buf.length) return '';
  const pages = extractPdfPages(buf);
  if (pages.length) return clipManualSearchText(stampPdfPages(pages), PDF_INDEX_TEXT_MAX);
  return clipManualSearchText(looseStreamText(buf.toString('latin1')), PDF_INDEX_TEXT_MAX);
}

export function looksLikePdf(bytes: Uint8Array | Buffer): boolean {
  const head = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  return head.startsWith('%PDF-');
}
