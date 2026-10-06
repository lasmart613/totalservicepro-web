/**
 * Small markdown subset for the legal pages: headings, paragraphs, lists,
 * **bold**, and [label](href). Enough for the two content files. Not a general parser.
 */

export type LegalBlock =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] };

export type InlinePiece =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'link'; text: string; href: string };

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: LegalBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;

  function flushPara() {
    if (!para.length) return;
    const text = para.join(' ').trim();
    para = [];
    if (text) blocks.push({ type: 'p', text });
  }

  function flushList() {
    if (!list) return;
    blocks.push({ type: 'ul', items: list });
    list = null;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith('## ')) {
      flushPara();
      flushList();
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith('- ')) {
      flushPara();
      if (!list) list = [];
      list.push(line.slice(2).trim());
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/** Drop javascript: and other non-navigation hrefs. Internal paths stay relative. */
export function safeLegalHref(href: string): string | null {
  const value = href.trim();
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^mailto:[^\s]+$/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return null;
}

export function parseInline(source: string): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ type: 'text', text: source.slice(last, index) });
    const token = match[0];
    if (token.startsWith('**')) {
      pieces.push({ type: 'strong', text: token.slice(2, -2) });
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const href = link ? safeLegalHref(link[2]) : null;
      if (link && href) pieces.push({ type: 'link', text: link[1], href });
      else pieces.push({ type: 'text', text: token });
    }
    last = index + token.length;
  }
  if (last < source.length) pieces.push({ type: 'text', text: source.slice(last) });
  return pieces;
}
