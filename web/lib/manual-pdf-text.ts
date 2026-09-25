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

function pdfObjectBodies(latin: string): Map<number, string> {
  const objs = new Map<number, string>();
  const re = /(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin))) objs.set(Number(match[1]), match[2]);
  return objs;
}

function contentObjectIds(body: string): number[] {
  const list = body.match(/\/Contents\s*\[([^\]]*)\]/);
  if (list) return [...list[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
  const one = body.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
  return one ? [Number(one[1])] : [];
}

function pageIdsInOrder(objs: Map<number, string>): number[] {
  let pagesId: number | null = null;
  for (const [id, body] of objs) {
    if (/\/Type\s*\/Catalog\b/.test(body)) {
      const ref = body.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
      if (ref) pagesId = Number(ref[1]);
      break;
    }
  }
  if (pagesId == null) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const body = objs.get(id);
    if (!body) return;
    if (/\/Type\s*\/Pages\b/.test(body) || /\/Kids\s*\[/.test(body)) {
      const kids = body.match(/\/Kids\s*\[([^\]]*)\]/);
      if (!kids) return;
      for (const ref of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(ref[1]));
      return;
    }
    if (/\/Type\s*\/Page\b/.test(body) || /\/Contents\b/.test(body)) out.push(id);
  };
  walk(pagesId);
  return out;
}

function textForObject(objs: Map<number, string>, id: number): string {
  const body = objs.get(id) || '';
  const streams = [...body.matchAll(/stream\r?\n([\s\S]*?)endstream/g)];
  return streams.map((stream) => textFromStream(body, stream[1] || '')).join(' ');
}

/**
 * Page-ordered text with a form feed and [[pdfpage:N]] stamp between pages.
 * Null when the page tree cannot be read.
 */
function pageOrderedSearchText(latin: string): string | null {
  const objs = pdfObjectBodies(latin);
  const pages = pageIdsInOrder(objs);
  if (pages.length < 2) return null;
  const parts = pages.map((pageId, index) => {
    const body = objs.get(pageId) || '';
    const contentIds = contentObjectIds(body);
    const chunks = (contentIds.length ? contentIds : [pageId]).map((id) => textForObject(objs, id));
    return `[[pdfpage:${index + 1}]] ${chunks.join(' ')}`.trim();
  });
  if (!parts.some((part) => part.replace(/\[\[pdfpage:\d+\]\]/g, '').trim())) return null;
  return parts.join('\f');
}

/**
 * Pull visible strings from PDF content streams. Best-effort for typical
 * service-manual PDFs; not a full renderer. Multi-page files keep the
 * physical page index (form feed + [[pdfpage:N]]), not the printed label.
 */
export function extractPdfSearchText(bytes: Uint8Array | Buffer): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!buf.length) return '';
  const latin = buf.toString('latin1');
  const loose = looseStreamText(latin);
  const ordered = pageOrderedSearchText(latin);
  const looseLen = loose.replace(/\s/g, '').length;
  const orderedLen = ordered ? ordered.replace(/\[\[pdfpage:\d+\]\]/g, '').replace(/\s/g, '').length : 0;
  if (ordered && orderedLen >= Math.max(1, looseLen) * 0.5) return clipManualSearchText(ordered);
  return clipManualSearchText(loose);
}

export function looksLikePdf(bytes: Uint8Array | Buffer): boolean {
  const head = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  return head.startsWith('%PDF-');
}
