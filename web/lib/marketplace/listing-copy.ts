/**
 * Turn marketplace / eBay descriptions into buyer-facing copy.
 * Markdown and HTML are sanitized; source markers are not shown.
 */

import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist for buyer-facing listing copy (eBay imports, seller HTML,
 * our own markdown output). Everything not listed is removed: every on*
 * handler, style, class, id, svg, math, iframe, object, form controls,
 * script/style bodies. Links: http, https, mailto only, rel=noopener.
 * Images: http(s) src + alt only (eBay descriptions embed product shots).
 */
export const LISTING_ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 'code',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'img',
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: LISTING_ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
    img: ['src', 'alt'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'], a: ['http', 'https', 'mailto'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  allowedStyles: {},
  allowVulnerableTags: false,
  // Drop the element and its text for these; other disallowed tags keep their text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'svg', 'math', 'iframe', 'object', 'embed', 'template', 'title', 'head'],
  disallowedTagsMode: 'discard',
  enforceHtmlBoundary: false,
  parseStyleAttributes: false,
  transformTags: {
    a: (_tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag => {
      const href = String(attribs.href || '').trim();
      // Absolute http(s)/mailto only: no relative, protocol-relative or other schemes.
      if (!/^(https?:\/\/|mailto:)/i.test(href) || /[\s<>"]/.test(href)) return { tagName: 'span', attribs: {} as sanitizeHtml.Attributes };
      return {
        tagName: 'a',
        attribs: { href, rel: 'noopener noreferrer', target: '_blank' },
      };
    },
  },
  exclusiveFilter: (frame) =>
    frame.tag === 'img' && !/^https?:\/\/[^\s<>"]+$/i.test(String(frame.attribs.src || '').trim()),
};

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

export function sanitizeListingHtml(html: string): string {
  const out = sanitizeHtml(String(html || ''), SANITIZE_OPTIONS);
  return out.replace(/<span>\s*<\/span>/g, '');
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
  // Markdown output is built from escaped text; sanitize it too (defence in depth).
  const html = sanitizeListingHtml(looksLikeHtml(text) ? text : markdownToHtml(text));
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
