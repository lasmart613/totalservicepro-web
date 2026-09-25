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

function extractOperators(payload: string): string {
  const chunks: string[] = [];
  const tj = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  const hexTj = /<([0-9A-Fa-f \t\r\n]+)>\s*Tj/g;
  const tjArr = /\[([\s\S]*?)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = tj.exec(payload))) {
    const inner = m[0].slice(1, m[0].lastIndexOf(')'));
    chunks.push(decodePdfLiteral(inner));
  }
  while ((m = hexTj.exec(payload))) {
    chunks.push(decodePdfHex(m[1]));
  }
  while ((m = tjArr.exec(payload))) {
    const body = m[1];
    const lit = /\((?:\\.|[^\\)])*\)/g;
    const hx = /<([0-9A-Fa-f \t\r\n]+)>/g;
    let p: RegExpExecArray | null;
    while ((p = lit.exec(body))) {
      chunks.push(decodePdfLiteral(p[0].slice(1, -1)));
    }
    while ((p = hx.exec(body))) {
      chunks.push(decodePdfHex(p[1]));
    }
  }
  return chunks.join(' ');
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
