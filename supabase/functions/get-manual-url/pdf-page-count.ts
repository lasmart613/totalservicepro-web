/**
 * Page count that matches pdf.js numPages for a cleartext /Type /Pages /Count.
 * Indirect `/Count 8 0 R` is rejected. Object streams with no cleartext Pages
 * dictionary return null so the joined map is omitted instead of shifted.
 * The value is the max direct /Count: the root count is at least any child.
 */

const COUNT_MAX = 9999;

function asLatin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function matchingClose(text: string, start: number): number | null {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text.charCodeAt(i) === 60 && text.charCodeAt(i + 1) === 60) {
      depth++;
      i++;
      continue;
    }
    if (text.charCodeAt(i) === 62 && text.charCodeAt(i + 1) === 62) {
      depth--;
      if (depth === 0) return i + 2;
      i++;
    }
  }
  return null;
}

/** Dictionary that directly contains `at`, excluding an outer wrapper. */
function enclosingDict(text: string, at: number): string | null {
  let depth = 0;
  for (let i = at; i >= 1; i--) {
    if (text.charCodeAt(i) === 62 && text.charCodeAt(i - 1) === 62) {
      depth++;
      i--;
      continue;
    }
    if (text.charCodeAt(i) === 60 && text.charCodeAt(i - 1) === 60) {
      if (depth === 0) {
        const start = i - 1;
        const end = matchingClose(text, start);
        return end == null ? null : text.slice(start, end);
      }
      depth--;
      i--;
    }
  }
  return null;
}

/** Drop nested << >> so a child /Count is not read as this dictionary's. */
function stripNested(dict: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < dict.length - 1; i++) {
    if (dict.charCodeAt(i) === 60 && dict.charCodeAt(i + 1) === 60) {
      depth++;
      if (depth === 1) out += '<<';
      i++;
      continue;
    }
    if (dict.charCodeAt(i) === 62 && dict.charCodeAt(i + 1) === 62) {
      if (depth === 1) out += '>>';
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 1) out += dict[i];
  }
  return out;
}

function directCount(dict: string): number | null {
  const flat = stripNested(dict);
  const re = /\/Count\s+(\d+)\b(?!\s+\d+\s+R)/g;
  let best: number | null = null;
  for (const match of flat.matchAll(re)) {
    const n = Number(match[1]);
    if (!Number.isInteger(n) || n < 0 || n > COUNT_MAX) continue;
    if (best == null || n > best) best = n;
  }
  return best;
}

export function countPdfPages(bytes: Uint8Array): number | null {
  if (!bytes || bytes.length < 8) return null;
  const head = asLatin1(bytes.subarray(0, Math.min(bytes.length, 1024)));
  if (!head.includes('%PDF')) return null;
  const text = asLatin1(bytes);
  const typeRe = /\/Type\s*\/Pages\b/g;
  let max: number | null = null;
  for (const match of text.matchAll(typeRe)) {
    const dict = enclosingDict(text, match.index ?? 0);
    if (!dict) continue;
    const count = directCount(dict);
    if (count == null) continue;
    if (max == null || count > max) max = count;
  }
  return max;
}
