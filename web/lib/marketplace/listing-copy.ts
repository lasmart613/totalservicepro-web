/**
 * Turn marketplace / eBay descriptions into buyer-facing copy.
 * Markdown and HTML are sanitized; source markers are not shown.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'div',
  'img',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

const HTML_HINT =
  /<\/?(?:p|div|br|ul|ol|li|h[1-6]|table|span|strong|em|b|i|a|img|blockquote|section|article|td|tr)\b/i;

export function looksLikeHtml(raw: string): boolean {
  return HTML_HINT.test(raw);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function pickAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrs.match(re);
  if (!m) return null;
  return decodeEntities((m[1] || m[2] || m[3] || '').trim());
}

function safeHttpUrl(raw: string | null): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (/[\s<>]/.test(url)) return null;
  return url;
}

export function sanitizeListingHtml(html: string): string {
  let s = String(html || '');
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|form|input|button|textarea|select|option|svg|math|video|audio|source|track|base)(?:\s[^>]*)?>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s+(?:style|srcset|srcdoc|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>/g, (full, name: string, attrs = '') => {
    const tag = name.toLowerCase();
    const closing = full.startsWith('</');
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (closing) return VOID_TAGS.has(tag) ? '' : `</${tag}>`;
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    if (tag === 'img') {
      const src = safeHttpUrl(pickAttr(attrs, 'src'));
      if (!src) return '';
      const alt = pickAttr(attrs, 'alt') || '';
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">`;
    }
    if (tag === 'a') {
      const href = safeHttpUrl(pickAttr(attrs, 'href'));
      if (!href) return '<span>';
      return `<a href="${escapeAttr(href)}" rel="noopener noreferrer" target="_blank">`;
    }
    return `<${tag}>`;
  });

  return s.replace(/<span>\s*<\/span>/g, '');
}

function wrapMarkdownLists(html: string): string {
  const lines = html.split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  const close = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };
  for (const line of lines) {
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ul) {
      if (inOl) close();
      if (!inUl) {
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${ul[1]}</li>`);
      continue;
    }
    if (ol) {
      if (inUl) close();
      if (!inOl) {
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${ol[1]}</li>`);
      continue;
    }
    close();
    out.push(line);
  }
  close();
  return out.join('\n');
}

function markdownToHtml(raw: string): string {
  let html = escapeHtml(raw.replace(/\r\n/g, '\n'));
  html = html.replace(/^#{6}\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^#{5}\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^\s*(?:[-*_]){3,}\s*$/gm, '<hr>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~\n]+)~~/g, '$1');
  html = html.replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>'
  );
  html = wrapMarkdownLists(html);
  const blocks = html
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^<(h[1-4]|ul|ol|hr|blockquote)\b/.test(block)) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    });
  return blocks.join('');
}

export function renderListingCopyHtml(raw: string | null | undefined): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  const html = looksLikeHtml(text) ? sanitizeListingHtml(text) : markdownToHtml(text);
  const compact = html.replace(/\s+/g, ' ').trim();
  if (!compact || compact === '<p></p>') return '';
  return html;
}

export function toPlainListingText(raw: string | null | undefined): string {
  let s = String(raw || '').replace(/\r\n/g, '\n');
  if (!s.trim()) return '';
  if (looksLikeHtml(s)) {
    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s);
  }
  s = s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return s;
}
