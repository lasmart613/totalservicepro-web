/**
 * Invoice PDF attached to the Finalize & Email / resend message.
 *
 * Preview / PDF does not build a file. It writes buildInvoiceHtml (document
 * theme, no pay button, no account footer) into a new tab; Save as PDF is the
 * browser's print of that HTML. Headless Chromium would match those pixels,
 * but it blows the Netlify Next.js function bundle. This draws the same
 * fields, money format, translations, and RTL direction with pdf-lib.
 * Arabic is reshaped from the Unicode joining tables before bidi reordering.
 * A failure here must not block the email — the send route catches and logs.
 */

import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { readableOn, type CompanyTheme } from '../company-theme.ts';
import { documentDirection, localeToBcp47, translateApp, translateAppFill } from '../i18n/translate-app.ts';
import { displayModelText } from '../model-display.ts';
import { formatOrgMoney } from '../money-format.ts';
import { DEFAULT_ORG_TIMEZONE, formatDateInTimeZone } from '../org-timezone.ts';
import { reshapeArabic } from './arabic-join.ts';
import type { DocCompany, InvoiceHtmlInput } from './doc-html.ts';
import { INVOICE_FONT_BASE64 } from './invoice-font-data.ts';

/** Resend's whole message, attachments included, must stay under 40MB. */
export const INVOICE_PDF_MAX_BYTES = 25 * 1024 * 1024;

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 28.8;
const CONTENT_W = PAGE_W - MARGIN * 2;

const bidi = bidiFactory();

export type InvoicePdfAttachment = {
  filename: string;
  content: string;
  content_type: 'application/pdf';
};

type Align = 'left' | 'right' | 'center';
type Dir = 'ltr' | 'rtl';
type Family = 'latin' | 'hebrew' | 'arabic';

type GlyphFont = { hasGlyphForCodePoint(codePoint: number): boolean };
type Face = { pdf: PDFFont; kit: GlyphFont };

type Rgb = ReturnType<typeof rgb>;

const fontByteCache = new Map<string, Uint8Array>();
const fontKitCache = new Map<string, GlyphFont>();

function fontBytes(key: string): Uint8Array {
  const cached = fontByteCache.get(key);
  if (cached) return cached;
  const encoded = INVOICE_FONT_BASE64[key as keyof typeof INVOICE_FONT_BASE64];
  if (!encoded) throw new Error(`Missing invoice font ${key}`);
  const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
  fontByteCache.set(key, bytes);
  return bytes;
}

function fontKit(key: string): GlyphFont {
  const cached = fontKitCache.get(key);
  if (cached) return cached;
  const kit = fontkit.create(fontBytes(key)) as GlyphFont;
  fontKitCache.set(key, kit);
  return kit;
}

/** `Invoice-<number>.pdf`, with path characters removed from the number. */
export function invoicePdfFilename(invoiceNumber: unknown): string {
  const raw = String(invoiceNumber ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  const safe = raw
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  return safe ? `Invoice-${safe}.pdf` : 'Invoice.pdf';
}

export function toResendPdfAttachment(pdf: Uint8Array, filename: string): InvoicePdfAttachment | null {
  if (!pdf || pdf.byteLength < 5 || pdf.byteLength > INVOICE_PDF_MAX_BYTES) return null;
  if (pdf[0] !== 0x25 || pdf[1] !== 0x50 || pdf[2] !== 0x44 || pdf[3] !== 0x46) return null;
  return {
    filename,
    content: Buffer.from(pdf).toString('base64'),
    content_type: 'application/pdf',
  };
}

/** https logos only. Blocks loopback, link-local, and private addresses. */
export function isPublicLogoUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  if (host === 'metadata.google.internal' || host === '169.254.169.254') return false;
  if (isIpLiteral(host) && isPrivateIp(host)) return false;
  return true;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function isPrivateIp(host: string): boolean {
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  const parts = host.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return host.includes(':');
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function hexRgb(hex: string): Rgb {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return rgb(0.07, 0.07, 0.07);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function isHebrew(cp: number): boolean {
  return (cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0xfb1d && cp <= 0xfb4f);
}

function isArabic(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  );
}

function rank(cp: number): Family[] {
  if (isHebrew(cp)) return ['hebrew', 'arabic', 'latin'];
  if (isArabic(cp)) return ['arabic', 'hebrew', 'latin'];
  return ['latin', 'hebrew', 'arabic'];
}

type LineSpec = { text: string; size: number; bold?: boolean };
type Col = { label: string; align: Align; weight: number };

type PdfModel = {
  dir: Dir;
  lang: string;
  title: string;
  number: string;
  logoUrl: string;
  companyLines: string[];
  slogan: string;
  titleLines: LineSpec[];
  billHeading: string;
  billFields: string[];
  metaHeading: string;
  metaFields: string[];
  linesTitle: string;
  columns: Col[];
  rows: string[][];
  emptyLabel: string | null;
  notes: string;
  amountsTitle: string;
  amountLines: LineSpec[];
  callout: string[];
  footer: string[];
  headerBg: string | null;
  headerInk: string;
  headerMuted: string;
  numberColor: string;
  rule: string;
};

function buildModel(input: InvoiceHtmlInput): PdfModel {
  const dirMeta = documentDirection(input.locale);
  const dir = dirMeta.dir;
  const tr = (text: string) => translateApp(input.locale, text);
  const fill = (text: string, vars: Record<string, string | number>) => translateAppFill(input.locale, text, vars);
  const money = (n: number | null | undefined) => formatOrgMoney(n, input.moneyPrefs, input.locale);
  const bcp = input.locale ? localeToBcp47(input.locale) : 'en-US';
  const upper = (text: string) => tr(text).toLocaleUpperCase(bcp === 'en' ? 'en-US' : bcp);
  const zone = String(input.timeZone || '').trim() || DEFAULT_ORG_TIMEZONE;
  const dateOf = (value: string | null | undefined) =>
    formatDateInTimeZone(value || new Date(), zone, bcp === 'en' ? 'en-US' : bcp) || String(value || '');
  const dateLabel = input.invoiceDate ? dateOf(input.invoiceDate) : dateOf(null);
  const dueLabel = input.dueDate ? dateOf(input.dueDate) : '—';
  const branded = !!(input.theme?.branded && input.themeScope !== 'email');
  const theme: CompanyTheme | null = branded && input.theme ? input.theme : null;
  const company = input.company || ({} as DocCompany);
  const shopName = String(company.company_name || '').trim();
  const payableName = String(input.checksPayableTo ?? '').trim() || shopName;
  const address = [company.address, company.city, company.state, company.zip].filter(Boolean).join(', ');
  const companyLines = [shopName, address, company.phone || '', company.email || '', company.website || ''].filter(Boolean);

  const items = (input.lines || []).filter((it) => it.description || it.part_number || it.unit_price);
  let columns: Col[] = [
    { label: tr('Part #'), align: 'left', weight: 0.16 },
    { label: tr('Description'), align: 'left', weight: 0.42 },
    { label: tr('Qty'), align: 'right', weight: 0.12 },
    { label: tr('Price'), align: 'right', weight: 0.15 },
    { label: tr('Ext'), align: 'right', weight: 0.15 },
  ];
  let rows = items.map((it) => {
    const ext = it.ext ?? (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
    const qty = Number(it.qty || 0)
      .toFixed(2)
      .replace(/\.00$/, '');
    return [it.part_number || '', it.description || '', qty, money(it.unit_price), money(ext)];
  });
  if (dir === 'rtl') {
    columns = columns.map((col) => ({ ...col, align: col.align === 'left' ? 'right' : 'left' })).reverse();
    rows = rows.map((row) => row.slice().reverse());
  }

  const deposit = Number(input.deposit) || 0;
  const total = Number(input.total) || 0;
  const dueNow = Number(input.dueNow) || 0;
  const deferred = Number(input.deferred) || 0;
  const hasSplit = deferred > 0.004 && dueNow > 0;
  const balance = input.balanceDue != null ? Number(input.balanceDue) : Math.max(0, total - deposit);
  const depositBits = [
    `${tr('Deposit received')}: ${money(deposit)}`,
    input.depositDate ? fill('on {date}', { date: dateOf(input.depositDate) }) : '',
    input.depositMethod ? fill('via {method}', { method: tr(input.depositMethod) }) : '',
  ]
    .filter(Boolean)
    .join(' ');

  const callout: string[] = [];
  if (hasSplit) {
    callout.push(tr('Payment split'), `${tr('Due now (parts/travel deposit)')}: ${money(dueNow)}`, `${tr('Remaining (due on completion)')}: ${money(deferred)}`);
    if (deposit > 0) {
      callout.push(depositBits, `${tr('Still owed')}: ${money(balance)}`);
    }
  } else if (deposit > 0) {
    callout.push(depositBits, `${tr('Balance remaining')}: ${money(balance)}`);
  }

  const footer: string[] = [];
  if (hasSplit && deposit <= 0) {
    footer.push(
      fill('A parts/travel deposit of {due} is due now. The remaining {rest} is due upon completion of the service call.', {
        due: money(dueNow),
        rest: money(deferred),
      })
    );
  }
  if (hasSplit && deposit > 0 && !input.deferredReleased) {
    footer.push(
      fill('Deposit has been applied. Remaining balance of {balance} is payable upon completion of the service call.', {
        balance: money(balance),
      })
    );
  }
  if (!hasSplit && deposit > 0) {
    footer.push(tr('Deposit has been applied. Remaining balance is payable upon completion of the service call.'));
  }
  if (payableName) footer.push(fill('Make checks payable to {name}.', { name: payableName }));
  footer.push(fill('Thank you for choosing {shop}!', { shop: shopName || 'Total Service Pro' }));

  const metaFields = [
    `${upper('Invoice date')} ${dateLabel}`,
    `${upper('Invoice #')} ${input.invNumber || ''}`,
    `${upper('Due date')} ${dueLabel}`,
  ];
  const prepared = input.preparedBy || company.tech_name;
  if (prepared) metaFields.push(`${upper('Prepared by')} ${prepared}`);
  if (input.fromEstimateId != null && String(input.fromEstimateId).trim() !== '') {
    metaFields.push(`${upper('From estimate')} #${String(input.fromEstimateId).trim()}`);
  }

  const customer = input.customer;
  const custAddr = [customer?.address, customer?.city, customer?.state, customer?.zip].filter(Boolean).join(', ');
  const billFields = [
    `${upper('Name')} ${customer?.name || '—'}`,
    `${upper('Address')} ${custAddr || '—'}`,
    `${upper('Contact')} ${customer?.contact || '—'}`,
    `${upper('Phone')} ${customer?.phone || '—'}`,
    `${upper('Email')} ${customer?.email || '—'}`,
  ];
  if (customer?.website) billFields.push(`${upper('Website')} ${customer.website}`);

  return {
    dir,
    lang: dirMeta.lang,
    title: tr('Invoice'),
    number: String(input.invNumber || ''),
    logoUrl: String(company.logo_url || '').trim(),
    companyLines,
    slogan: company.logo_url && company.slogan ? String(company.slogan) : '',
    titleLines: [
      { text: tr('Invoice'), size: 16, bold: true },
      ...(input.invNumber ? [{ text: String(input.invNumber), size: 12, bold: true }] : []),
      { text: dateLabel, size: 10 },
    ],
    billHeading: upper('Customer / Bill To'),
    billFields,
    metaHeading: upper('Invoice'),
    metaFields,
    linesTitle: tr('Line Items'),
    columns,
    rows,
    emptyLabel: items.length ? null : tr('No line items'),
    notes: input.description ? `${tr('Notes')}: ${displayModelText(input.description)}` : '',
    amountsTitle: tr('Amounts'),
    amountLines: [
      { text: `${tr('Subtotal')}: ${money(input.subtotal)}`, size: 11 },
      { text: `${tr('Tax')}: ${money(input.tax)}`, size: 11 },
      { text: `${tr('Invoice Total')}: ${money(total)}`, size: 15, bold: true },
    ],
    callout,
    footer,
    headerBg: theme ? theme.primary : null,
    headerInk: theme ? theme.onPrimary : '#111111',
    headerMuted: theme ? theme.onPrimary : '#444444',
    numberColor: theme ? readableOn(theme.accent, theme.primary, theme.onPrimary) : '#B45309',
    rule: theme ? theme.accent : '#FBBF24',
  };
}

function modelStrings(model: PdfModel): string[] {
  return [
    ...model.companyLines,
    model.slogan,
    ...model.titleLines.map((line) => line.text),
    model.billHeading,
    ...model.billFields,
    model.metaHeading,
    ...model.metaFields,
    model.linesTitle,
    ...model.columns.map((col) => col.label),
    ...model.rows.flat(),
    model.emptyLabel || '',
    model.notes,
    model.amountsTitle,
    ...model.amountLines.map((line) => line.text),
    ...model.callout,
    ...model.footer,
  ].filter(Boolean);
}

class Sheet {
  doc: PDFDocument;
  page: PDFPage;
  top = PAGE_H - MARGIN;
  dir: Dir;
  faces: Partial<Record<Family | `${Family}Bold`, Face>> = {};

  constructor(doc: PDFDocument, page: PDFPage, dir: Dir) {
    this.doc = doc;
    this.page = page;
    this.dir = dir;
  }

  async embed(families: Set<Family>) {
    const keys: Array<Family | `${Family}Bold`> = [];
    for (const family of families) {
      keys.push(family, `${family}Bold`);
    }
    if (!families.has('latin')) keys.push('latin', 'latinBold');
    for (const key of keys) {
      const kit = fontKit(key);
      const pdf = await this.doc.embedFont(fontBytes(key), { subset: true });
      this.faces[key] = { pdf, kit };
    }
  }

  private face(ch: string, bold: boolean): Face {
    const cp = ch.codePointAt(0) || 0;
    for (const family of rank(cp)) {
      const boldFace = bold ? this.faces[`${family}Bold`] : undefined;
      if (boldFace && boldFace.kit.hasGlyphForCodePoint(cp)) return boldFace;
      const regular = this.faces[family];
      if (regular && regular.kit.hasGlyphForCodePoint(cp)) return regular;
    }
    return this.faces.latin as Face;
  }

  visual(logical: string): string {
    const shaped = reshapeArabic(String(logical ?? ''));
    if (!shaped) return '';
    const levels = bidi.getEmbeddingLevels(shaped, this.dir);
    return bidi.getReorderedString(shaped, levels);
  }

  measure(logical: string, size: number, bold: boolean): number {
    const visual = this.visual(logical);
    const chars = Array.from(visual);
    let width = 0;
    let i = 0;
    while (i < chars.length) {
      const face = this.face(chars[i], bold);
      let j = i + 1;
      while (j < chars.length && this.face(chars[j], bold) === face) j += 1;
      width += face.pdf.widthOfTextAtSize(chars.slice(i, j).join(''), size);
      i = j;
    }
    return width;
  }

  wrap(logical: string, maxWidth: number, size: number, bold: boolean): string[] {
    const text = String(logical ?? '');
    if (!text) return [];
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      const tokens = para.split(/([ \t]+)/).filter((token) => token !== '');
      let current = '';
      const push = (value: string) => {
        if (value) lines.push(value);
      };
      for (const token of tokens) {
        const next = current + token;
        if (current && this.measure(next, size, bold) > maxWidth) {
          push(current.trimEnd());
          const word = token.trim();
          if (word && this.measure(word, size, bold) > maxWidth) {
            let chunk = '';
            for (const ch of Array.from(word)) {
              const grown = chunk + ch;
              if (chunk && this.measure(grown, size, bold) > maxWidth) {
                push(chunk);
                chunk = ch;
              } else chunk = grown;
            }
            current = chunk;
          } else {
            current = word;
          }
        } else {
          current = next;
        }
      }
      push(current.trimEnd());
    }
    return lines;
  }

  drawVisual(logical: string, x: number, baseline: number, size: number, bold: boolean, color: Rgb) {
    const chars = Array.from(this.visual(logical));
    let cursor = x;
    let i = 0;
    while (i < chars.length) {
      const face = this.face(chars[i], bold);
      let j = i + 1;
      while (j < chars.length && this.face(chars[j], bold) === face) j += 1;
      const run = chars.slice(i, j).join('');
      this.page.drawText(run, { x: cursor, y: baseline, size, font: face.pdf, color });
      cursor += face.pdf.widthOfTextAtSize(run, size);
      i = j;
    }
  }

  ensure(height: number) {
    if (this.top - height >= MARGIN) return;
    if (this.top < PAGE_H - MARGIN - 1) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.top = PAGE_H - MARGIN;
    }
  }

  gap(amount: number) {
    this.top -= amount;
  }

  drawLines(text: string, opts: { size: number; bold?: boolean; color?: string; align?: Align; width?: number; x?: number }) {
    const size = opts.size;
    const bold = !!opts.bold;
    const width = opts.width ?? CONTENT_W;
    const x = opts.x ?? MARGIN;
    const align = opts.align ?? (this.dir === 'rtl' ? 'right' : 'left');
    const color = hexRgb(opts.color || '#111111');
    const lines = this.wrap(text, width, size, bold);
    const lineH = size * 1.35;
    for (const line of lines) {
      this.ensure(lineH);
      const baseline = this.top - size * 0.82;
      const measured = this.measure(line, size, bold);
      let start = x;
      if (align === 'right') start = x + width - measured;
      else if (align === 'center') start = x + (width - measured) / 2;
      this.drawVisual(line, start, baseline, size, bold, color);
      this.top -= lineH;
    }
    return lines.length * lineH;
  }

  rule(color: string, thickness = 1.5) {
    this.ensure(thickness + 2);
    this.page.drawLine({
      start: { x: MARGIN, y: this.top },
      end: { x: MARGIN + CONTENT_W, y: this.top },
      thickness,
      color: hexRgb(color),
    });
    this.top -= thickness + 4;
  }

  sectionTitle(text: string, ruleColor: string) {
    this.gap(8);
    this.drawLines(text, { size: 12, bold: true });
    this.rule(ruleColor, 1.6);
  }
}

function familiesUsed(texts: string[]): Set<Family> {
  const kits = {
    latin: fontKit('latin'),
    hebrew: fontKit('hebrew'),
    arabic: fontKit('arabic'),
  };
  const need = new Set<Family>(['latin']);
  for (const text of texts) {
    for (const ch of text) {
      const cp = ch.codePointAt(0) || 0;
      if (kits.latin.hasGlyphForCodePoint(cp)) continue;
      if (kits.hebrew.hasGlyphForCodePoint(cp)) need.add('hebrew');
      else if (kits.arabic.hasGlyphForCodePoint(cp)) need.add('arabic');
    }
  }
  return need;
}

async function loadLogo(url: string): Promise<Uint8Array | null> {
  if (!isPublicLogoUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.startsWith('text/') || type.includes('html') || type.includes('xml')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 8 || bytes.byteLength > 1_500_000) return null;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    return png || jpg ? bytes : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function drawPairGrid(sheet: Sheet, fields: string[], bg: string, border: string) {
  const colGap = 8;
  const colW = (CONTENT_W - 16 - colGap) / 2;
  const size = 9;
  const rows: string[][] = [];
  for (let i = 0; i < fields.length; i += 2) rows.push(fields.slice(i, i + 2));
  const rowHeights = rows.map((pair) => {
    const h = pair.map((field) => Math.max(1, sheet.wrap(field, colW, size, false).length) * size * 1.35);
    return Math.max(...h);
  });
  const height = 16 + rowHeights.reduce((sum, h) => sum + h, 0) + 8;
  sheet.ensure(height);
  const top = sheet.top;
  sheet.page.drawRectangle({
    x: MARGIN,
    y: top - height,
    width: CONTENT_W,
    height,
    color: hexRgb(bg),
    borderColor: hexRgb(border),
    borderWidth: 0.6,
  });
  sheet.top = top - 8;
  for (let r = 0; r < rows.length; r++) {
    const rowTop = sheet.top;
    rows[r].forEach((field, index) => {
      const onStart = index === 0;
      const x = sheet.dir === 'ltr' ? MARGIN + 8 + (onStart ? 0 : colW + colGap) : MARGIN + 8 + (onStart ? colW + colGap : 0);
      const saved = sheet.top;
      sheet.top = rowTop;
      sheet.drawLines(field, { size, width: colW, x, color: '#222222' });
      sheet.top = saved;
    });
    sheet.top = rowTop - rowHeights[r];
  }
  sheet.top = top - height - 8;
}

export async function renderInvoicePdf(input: InvoiceHtmlInput): Promise<Uint8Array> {
  const model = buildModel(input);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(model.number ? `${model.title} ${model.number}` : model.title);
  doc.setLanguage(model.lang);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const sheet = new Sheet(doc, page, model.dir);
  await sheet.embed(familiesUsed(modelStrings(model)));

  const logoBytes = model.logoUrl ? await loadLogo(model.logoUrl) : null;
  let logo: PDFImage | null = null;
  if (logoBytes) {
    try {
      const png = logoBytes[0] === 0x89;
      logo = png ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes);
    } catch {
      logo = null;
    }
  }

  const titleW = 150;
  const logoSlot = logo || model.slogan ? 100 : 0;
  const companyW = CONTENT_W - titleW - logoSlot - (logoSlot ? 8 : 0);
  const titleX = model.dir === 'rtl' ? MARGIN : MARGIN + CONTENT_W - titleW;
  const logoX = model.dir === 'rtl' ? MARGIN + CONTENT_W - logoSlot : MARGIN;
  const companyX = model.dir === 'rtl' ? MARGIN + titleW + 8 : MARGIN + logoSlot + (logoSlot ? 8 : 0);
  const titleAlign: Align = model.dir === 'rtl' ? 'left' : 'right';
  const companyAlign: Align = model.dir === 'rtl' ? 'right' : 'left';

  const companyHeight = model.companyLines.reduce((sum, _line, index) => sum + (index === 0 ? 13 : 9) * 1.35, 0);
  const titleHeight = model.titleLines.reduce((sum, line) => sum + line.size * 1.35, 0);
  let logoHeight = 0;
  let logoDrawW = 0;
  let logoDrawH = 0;
  if (logo) {
    const scale = Math.min(90 / logo.width, 48 / logo.height, 1);
    logoDrawW = logo.width * scale;
    logoDrawH = logo.height * scale;
    logoHeight = logoDrawH + (model.slogan ? 8 * 1.35 : 0);
  }
  const headerH = Math.max(companyHeight, titleHeight, logoHeight, 36) + 18;
  sheet.ensure(headerH + 6);
  const headerTop = sheet.top;
  if (model.headerBg) {
    sheet.page.drawRectangle({
      x: MARGIN,
      y: headerTop - headerH,
      width: CONTENT_W,
      height: headerH,
      color: hexRgb(model.headerBg),
    });
  }
  if (logo) {
    sheet.page.drawImage(logo, {
      x: model.dir === 'rtl' ? logoX + logoSlot - logoDrawW - 4 : logoX,
      y: headerTop - 8 - logoDrawH,
      width: logoDrawW,
      height: logoDrawH,
    });
  }
  const saved = sheet.top;
  sheet.top = headerTop - 6;
  if (model.slogan) {
    const sloganTop = headerTop - 8 - logoDrawH - 2;
    sheet.top = sloganTop;
    sheet.drawLines(model.slogan, {
      size: 8,
      width: logoSlot - 4,
      x: logoX,
      align: companyAlign,
      color: model.headerMuted,
    });
  }
  sheet.top = headerTop - 6;
  model.companyLines.forEach((line, index) => {
    sheet.drawLines(line, {
      size: index === 0 ? 13 : 9,
      bold: index === 0,
      width: companyW,
      x: companyX,
      align: companyAlign,
      color: index === 0 ? model.headerInk : model.headerMuted,
    });
  });
  const afterCompany = sheet.top;
  sheet.top = headerTop - 6;
  model.titleLines.forEach((line, index) => {
    sheet.drawLines(line.text, {
      size: line.size,
      bold: !!line.bold,
      width: titleW,
      x: titleX,
      align: titleAlign,
      color: index === 1 ? model.numberColor : index === 0 ? model.headerInk : model.headerMuted,
    });
  });
  sheet.top = Math.min(afterCompany, sheet.top, saved, headerTop - headerH) - 4;
  if (!model.headerBg) sheet.rule(model.rule, 2.5);
  else {
    sheet.page.drawLine({
      start: { x: MARGIN, y: sheet.top },
      end: { x: MARGIN + CONTENT_W, y: sheet.top },
      thickness: 3,
      color: hexRgb(model.rule),
    });
    sheet.top -= 10;
  }

  sheet.drawLines(model.billHeading, { size: 8, bold: true, color: '#8a6f2e' });
  drawPairGrid(sheet, model.billFields, '#f8f4e8', '#e8d9a0');
  sheet.drawLines(model.metaHeading, { size: 8, bold: true, color: '#666666' });
  drawPairGrid(sheet, model.metaFields, '#f9f9f9', '#eeeeee');

  sheet.sectionTitle(model.linesTitle, model.rule);
  drawTable(sheet, model);
  if (model.notes) {
    sheet.gap(4);
    sheet.drawLines(model.notes, { size: 10, color: '#444444' });
  }
  sheet.sectionTitle(model.amountsTitle, model.rule);
  const amountAlign: Align = model.dir === 'rtl' ? 'right' : 'left';
  for (const line of model.amountLines) {
    sheet.drawLines(line.text, { size: line.size, bold: !!line.bold, align: amountAlign });
  }
  if (model.callout.length) {
    sheet.gap(6);
    const innerW = CONTENT_W - 16;
    const lineH = 11 * 1.35;
    const boxH = 12 + model.callout.length * lineH;
    sheet.ensure(boxH);
    const top = sheet.top;
    sheet.page.drawRectangle({
      x: MARGIN,
      y: top - boxH,
      width: CONTENT_W,
      height: boxH,
      color: hexRgb('#fffbeb'),
      borderColor: hexRgb(model.rule),
      borderWidth: 0.8,
    });
    sheet.top = top - 6;
    model.callout.forEach((line, index) => {
      sheet.drawLines(line, {
        size: index === 0 ? 11 : 10,
        bold: index === 0,
        width: innerW,
        x: MARGIN + 8,
        align: amountAlign,
        color: index === 0 ? '#92400e' : '#111111',
      });
    });
    sheet.top = top - boxH - 8;
  }
  sheet.gap(10);
  for (const line of model.footer) {
    sheet.drawLines(line, { size: 10, align: 'center', color: '#555555' });
  }

  return doc.save();
}

function drawTable(sheet: Sheet, model: PdfModel) {
  const weights = model.columns.reduce((sum, col) => sum + col.weight, 0) || 1;
  // Columns are already in visual left-to-right order (reversed for RTL).
  const cols = model.columns.map((col) => ({ ...col, width: (CONTENT_W * col.weight) / weights }));
  const xs: number[] = [];
  let cursor = MARGIN;
  for (const col of cols) {
    xs.push(cursor);
    cursor += col.width;
  }
  const drawRow = (cells: string[], opts: { bold?: boolean; bg?: string; size: number }) => {
    const size = opts.size;
    const wrapped = cells.map((cell, index) => sheet.wrap(cell, (cols[index] || cols[0]).width - 6, size, !!opts.bold));
    const height = Math.max(...wrapped.map((lines) => Math.max(1, lines.length))) * size * 1.35 + 6;
    sheet.ensure(height);
    const top = sheet.top;
    if (opts.bg) {
      sheet.page.drawRectangle({
        x: MARGIN,
        y: top - height,
        width: CONTENT_W,
        height,
        color: hexRgb(opts.bg),
      });
    }
    cells.forEach((cell, index) => {
      const savedTop = sheet.top;
      sheet.top = top - 3;
      sheet.drawLines(cell, {
        size,
        bold: !!opts.bold,
        width: cols[index].width - 6,
        x: xs[index] + 3,
        align: cols[index].align,
        color: '#111111',
      });
      sheet.top = savedTop;
    });
    sheet.top = top - height;
    sheet.page.drawLine({
      start: { x: MARGIN, y: sheet.top },
      end: { x: MARGIN + CONTENT_W, y: sheet.top },
      thickness: opts.bold ? 1.4 : 0.4,
      color: hexRgb(opts.bold ? model.rule : '#eeeeee'),
    });
  };
  drawRow(
    cols.map((col) => col.label),
    { bold: true, bg: '#f5f5f5', size: 9 }
  );
  if (model.emptyLabel) {
    drawRow([model.emptyLabel], { size: 9 });
    return;
  }
  for (const row of model.rows) drawRow(row, { size: 9 });
}
