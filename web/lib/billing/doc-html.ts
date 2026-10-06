/**
 * HTML document builders matching Android estimate_generator / invoice_form PDF layout.
 * Used for on-screen preview and print-to-PDF (same visual quality as the app).
 * Free-account marketing CTA is email-only — see wrapCustomerFacingDocumentEmail.
 * Do not add that footer here or PDFs will pick it up.
 *
 * Company brand colors come from getCompanyTheme. Unbranded (free, or paid with
 * no colors) keeps this file's RepairPlanet gold rules. Email scope colors only
 * the header bar and logo; section rules stay gold. The email CTA is styled in
 * the wrapper, not here.
 */

import {
  readableOn,
  themeAccentForScope,
  type CompanyTheme,
  type ThemeScope,
} from '../company-theme.ts';
import { localeToBcp47, translateApp, translateAppFill, withDocDirection } from '../i18n/translate-app.ts';
import { displayModelName, displayModelText } from '../model-display.ts';
import { DEFAULT_ORG_TIMEZONE, formatDateInTimeZone } from '../org-timezone.ts';
import { formatOrgMoney, type OrgMoneyPrefs } from '../money-format.ts';
import { estimateEmailActionUrl } from '../share.ts';

function docT(locale: string | null | undefined, text: string): string {
  return translateApp(locale, text);
}

function docFill(
  locale: string | null | undefined,
  text: string,
  vars: Record<string, string | number>,
): string {
  return translateAppFill(locale, text, vars);
}

function docDate(value: string | undefined | null, locale?: string | null, empty = ''): string {
  if (!value) return empty;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const bcp = locale ? localeToBcp47(locale) : 'en-US';
  return formatDateInTimeZone(value, DEFAULT_ORG_TIMEZONE, bcp === 'en' ? 'en-US' : bcp) || value;
}

export type DocThemeScope = ThemeScope;

export type DocCompany = {
  company_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  slogan?: string;
  logo_url?: string;
  tech_name?: string;
};

export type DocCustomer = {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  contact?: string;
  phone?: string;
  email?: string;
  website?: string;
};

function esc(s: any) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strip explicit bidi marks so an LTR isolate keeps CLDR order (630.00 US$, not a visual $US). */
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function isolateUserText(value: string): string {
  return `<bdi dir="auto">${esc(value)}</bdi>`;
}

function isolateLtr(value: string): string {
  return `<bdi dir="ltr">${esc(String(value).replace(BIDI_CONTROLS, ''))}</bdi>`;
}

function partLineHtml(line: string): string {
  const times = /^(.*?)\s×\s*(\d+(?:\.\d+)?)\s@\s(.+?)\s=\s(.+)$/.exec(line.trim());
  if (times) {
    return `${isolateUserText(times[1].trim())} ×${times[2]} @ ${isolateLtr(times[3].trim())} = ${isolateLtr(times[4].trim())}`;
  }
  const colon = /^(.*?):\s*(\S.*)$/.exec(line.trim());
  if (colon && /[0-9$€£]/.test(colon[2])) {
    return `${isolateUserText(colon[1].trim())}: ${isolateLtr(colon[2].trim())}`;
  }
  return isolateUserText(line);
}

function money(
  n: number | undefined | null,
  prefs?: OrgMoneyPrefs | null,
  locale?: string | null
) {
  return formatOrgMoney(n, prefs, locale);
}

function estimateEmailActionHref(actionUrl: string, action: 'approve' | 'reject' | 'modify'): string {
  return estimateEmailActionUrl(actionUrl, action);
}

function estimateActionButtonCell(href: string, bg: string, color: string, label: string): string {
  return (
    `<td align="center" style="padding:6px 4px;" width="33%">\n` +
    `<a href="${href}" ` +
    `style="display:inline-block;background:${bg};color:${color};padding:14px 18px;border-radius:8px;` +
    `text-decoration:none;font-weight:800;font-size:16px;letter-spacing:0.02em;border:2px solid ${bg};min-width:110px;">` +
    `${label}</a>\n` +
    `</td>\n`
  );
}

function estimateActionButtonsRow(actionUrl: string, locale?: string | null): string {
  const approveHref = esc(estimateEmailActionHref(actionUrl, 'approve'));
  const rejectHref = esc(estimateEmailActionHref(actionUrl, 'reject'));
  const modifyHref = esc(estimateEmailActionHref(actionUrl, 'modify'));
  const tr = (text: string) => docT(locale, text);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    `<tr>\n` +
    estimateActionButtonCell(approveHref, '#15803D', '#ffffff', tr('Approve')) +
    estimateActionButtonCell(rejectHref, '#B91C1C', '#ffffff', tr('Reject')) +
    estimateActionButtonCell(modifyHref, '#FBBF24', '#111827', tr('Modify')) +
    `</tr></table>`
  );
}

/** High-contrast banner + 3 CTAs. Table-based so Gmail does not collapse the buttons. */
export function buildEstimateActionCtasHtml(
  actionUrl: string,
  variant: 'banner' | 'repeat' = 'banner',
  locale?: string | null,
): string {
  const cls = variant === 'banner' ? 'tsp-est-cta tsp-est-cta-top' : 'tsp-est-cta tsp-est-cta-bottom';
  const heading = docT(locale, variant === 'banner' ? 'Respond to this estimate' : 'Need to decide?');
  return (
    `<table class="${cls}" role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="margin:16px 0;border-collapse:collapse;background:#111827;border-radius:10px;">` +
    `<tr><td align="center" style="padding:16px 12px 8px;font-size:18px;color:#FBBF24;font-weight:800;letter-spacing:0.02em;">` +
    `${heading}` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:0 12px 10px;font-size:13px;color:#F9FAFB;font-weight:600;">` +
    `${docT(locale, 'Tap Approve, Reject, or Modify — no login required.')}` +
    `</td></tr>` +
    `<tr><td style="padding:4px 8px 14px;">${estimateActionButtonsRow(actionUrl, locale)}</td></tr>` +
    (variant === 'banner'
      ? `<tr><td align="center" style="padding:0 12px 14px;font-size:10px;color:#D1D5DB;">` +
        `${docT(locale, 'These links are unique to this estimate.')}` +
        `</td></tr>`
      : '') +
    `</table>`
  );
}

/** Remove a CTA table, including the nested button table, so the sentence is not left behind. */
function stripEstimateActionCtas(html: string): string {
  const re = /<table\b[^>]*>/gi;
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (!/tsp-est-cta/.test(match[0])) continue;
    const end = endOfTable(html, match.index);
    if (end < 0) break;
    out += html.slice(cursor, match.index);
    cursor = end;
    re.lastIndex = end;
  }
  return out + html.slice(cursor);
}

function endOfTable(html: string, start: number): number {
  const re = /<\/?table\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) return re.lastIndex;
  }
  return -1;
}

/** Inject or replace CTAs at the top and bottom so they are hard to miss. */
export function ensureEstimateActionCtas(html: string, actionUrl: string, locale?: string | null): string {
  if (!html || !actionUrl) return html;
  const top = buildEstimateActionCtasHtml(actionUrl, 'banner', locale);
  const bottom = buildEstimateActionCtasHtml(actionUrl, 'repeat', locale);
  let next = stripEstimateActionCtas(html);
  const firstDiv = next.indexOf('<div');
  if (firstDiv >= 0) {
    const close = next.indexOf('>', firstDiv);
    if (close >= 0) {
      next = next.slice(0, close + 1) + top + next.slice(close + 1);
    } else {
      next = top + next;
    }
  } else {
    next = top + next;
  }
  const marker = next.lastIndexOf('<!--tsp-thanks-->');
  const thankYou = marker >= 0 ? marker : next.lastIndexOf('Thank you for choosing');
  if (thankYou >= 0) {
    next = next.slice(0, thankYou) + bottom + next.slice(thankYou);
  } else {
    next += bottom;
  }
  return next;
}

/** Gold rule used everywhere a paid brand color is not applied. */
export function documentRuleColor(
  theme: CompanyTheme | null | undefined,
  scope: DocThemeScope | undefined
): string {
  return themeAccentForScope(theme, scope);
}

function payButtonStyle(theme: CompanyTheme | null | undefined): string {
  if (theme?.branded) {
    return (
      `display:inline-block;background:${theme.accent};color:${theme.onAccent};padding:14px 28px;border-radius:8px;` +
      `text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;`
    );
  }
  return (
    `display:inline-block;background:#635BFF;color:#fff;padding:14px 28px;border-radius:8px;` +
    `text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;`
  );
}

/** Top header: logo | company block | title/number/date — matches Android buildDocTopHeader */
export function buildDocTopHeader(
  company: DocCompany,
  docTitle: string,
  docNum: string,
  docDate: string,
  options?: { theme?: CompanyTheme | null; themeScope?: DocThemeScope; locale?: string | null }
): string {
  const cName = company.company_name || '';
  const cAddr = [company.address, company.city, company.state, company.zip].filter(Boolean).join(', ');
  const cPhone = company.phone || '';
  const cEmail = company.email || '';
  const cWebsite = company.website || '';
  const cSlogan = company.slogan || '';

  const theme = options?.theme?.branded ? options.theme : null;
  const ink = theme ? theme.onPrimary : '#111';
  const muted = theme ? theme.onPrimary : '#444';
  const meta = theme ? theme.onPrimary : '#555';
  const numberColor = theme ? readableOn(theme.accent, theme.primary, theme.onPrimary) : '#B45309';
  const linkColor = theme ? readableOn(theme.accent, theme.primary, theme.onPrimary) : '#0a66c2';
  const rule = theme ? theme.accent : '#FBBF24';
  const logoStyle = theme
    ? 'max-width:105px;max-height:55px;object-fit:contain;border-radius:4px;display:block;background:#ffffff;padding:4px;'
    : 'max-width:105px;max-height:55px;object-fit:contain;border-radius:4px;display:block;';

  let logoBlock = '';
  if (company.logo_url) {
    logoBlock =
      `<img src="${esc(company.logo_url)}" style="${logoStyle}" alt="${esc(docT(options?.locale, 'Company Logo'))}" />` +
      (cSlogan
        ? `<div style="font-size:9px;font-style:italic;color:${meta};margin-top:2px;line-height:1.1;max-width:105px;">${esc(cSlogan)}</div>`
        : '');
  }

  let companyBlock = '';
  if (cName || cAddr || cPhone || cEmail || cWebsite) {
    companyBlock =
      (cName
        ? `<div style="font-size:14px;font-weight:800;color:${ink};line-height:1.1;">${esc(cName)}</div>`
        : '') +
      (cAddr ? `<div style="font-size:10px;color:${muted};line-height:1.15;">${esc(cAddr)}</div>` : '') +
      (cPhone ? `<div style="font-size:10px;color:${muted};">${esc(cPhone)}</div>` : '') +
      (cEmail ? `<div style="font-size:10px;color:${muted};">${esc(cEmail)}</div>` : '') +
      (cWebsite ? `<div style="font-size:10px;color:${linkColor};">${esc(cWebsite)}</div>` : '');
  }

  const bar = theme
    ? `background:${theme.primary};color:${theme.onPrimary};border-bottom:3px solid ${rule};`
    : `border-bottom:3px solid ${rule};`;
  const brandAttr = theme ? ' data-tsp-brand-header="1"' : '';

  const logoPad = theme ? 'padding:8px 8px 8px 0;' : 'padding-right:8px;';
  const midPad = theme ? 'padding:8px 8px 8px 0;' : 'padding-right:8px;';
  const titlePad = theme ? 'padding:8px 0;' : '';

  if (logoBlock || companyBlock) {
    return (
      `<table${brandAttr} style="width:100%;${bar}padding-bottom:6px;margin-bottom:10px;border-collapse:collapse;"><tr>` +
      `<td style="width:120px;vertical-align:top;${logoPad}">${logoBlock}</td>` +
      `<td style="vertical-align:top;${midPad}font-size:10px;">${companyBlock}</td>` +
      `<td style="width:130px;vertical-align:top;text-align:right;white-space:nowrap;${titlePad}">` +
      `<div style="font-size:16px;font-weight:700;color:${ink};">${esc(docT(options?.locale, docTitle))}</div>` +
      (docNum
        ? `<div style="font-size:12px;color:${numberColor};font-weight:700;">${esc(docNum)}</div>`
        : '') +
      (docDate ? `<div style="font-size:10px;color:${meta};">${esc(docDate)}</div>` : '') +
      `</td></tr></table>`
    );
  }

  return (
    `<div${brandAttr} style="${bar}padding-bottom:4px;margin-bottom:8px;text-align:right;">` +
    `<div style="font-size:16px;font-weight:700;color:${ink};">${esc(docT(options?.locale, docTitle))}</div>` +
    (docDate ? `<div style="font-size:10px;color:${meta};">${esc(docDate)}</div>` : '') +
    `</div>`
  );
}

function fieldLabel(locale: string | null | undefined, text: string): string {
  return `<span style="color:#666;font-size:8px;text-transform:uppercase;">${esc(docT(locale, text))}</span>`;
}

function customerBillTo(
  customer: DocCustomer,
  heading = 'Customer / Bill To',
  locale?: string | null,
): string {
  const addr = [customer.address, customer.city, customer.state, customer.zip]
    .filter(Boolean)
    .join(', ');
  return (
    `<div style="margin-bottom:8px;padding:6px 8px;background:#f8f4e8;border:1px solid #e8d9a0;border-radius:4px;">` +
    `<div style="font-size:9px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">${esc(
      docT(locale, heading)
    )}</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;">` +
    `<div>${fieldLabel(locale, 'Name')} ${esc(customer.name || '—')}</div>` +
    `<div>${fieldLabel(locale, 'Address')} ${esc(addr || '—')}</div>` +
    `<div>${fieldLabel(locale, 'Contact')} ${esc(customer.contact || '—')}</div>` +
    `<div>${fieldLabel(locale, 'Phone')} ${esc(customer.phone || '—')}</div>` +
    `<div>${fieldLabel(locale, 'Email')} ${esc(customer.email || '—')}</div>` +
    (customer.website
      ? `<div>${fieldLabel(locale, 'Website')} ${esc(customer.website)}</div>`
      : '') +
    `</div></div>`
  );
}

export type InvoiceHtmlInput = {
  company: DocCompany;
  customer: DocCustomer;
  invNumber: string;
  invoiceDate: string;
  dueDate?: string;
  description?: string;
  preparedBy?: string;
  fromEstimateId?: string | number | null;
  lines: { part_number?: string; description?: string; qty?: number; unit_price?: number; ext?: number }[];
  subtotal: number;
  tax: number;
  total: number;
  deposit?: number;
  depositDate?: string;
  depositMethod?: string;
  balanceDue?: number;
  /** Parts/travel deposit due now (unpaid). Shown separately from amount received. */
  dueNow?: number;
  /** Remainder due on completion — not charged by Stripe until released. */
  deferred?: number;
  deferredReleased?: boolean;
  /** Amount Stripe should charge (due now only). */
  collectableAmount?: number;
  /** Stripe Checkout / Payment Link URL for the collectable amount */
  paymentUrl?: string | null;
  theme?: CompanyTheme | null;
  /** document = header + accent rules. email = header and logo only. */
  themeScope?: DocThemeScope;
  /** Organization display currency. Omitted values stay USD in the locale format. */
  moneyPrefs?: OrgMoneyPrefs | null;
  locale?: string | null;
  /** IANA zone for the fallback "today" date. Date-only invoice dates are not shifted. */
  timeZone?: string | null;
};

function docZone(timeZone: string | null | undefined): string {
  const zone = String(timeZone || '').trim();
  return zone || DEFAULT_ORG_TIMEZONE;
}

function docDateLabel(value: string | null | undefined, timeZone: string | null | undefined, locale?: string | null): string {
  const bcp = locale ? localeToBcp47(locale) : 'en-US';
  return formatDateInTimeZone(value || new Date(), docZone(timeZone), bcp === 'en' ? 'en-US' : bcp);
}

export function buildInvoiceHtml(input: InvoiceHtmlInput): string {
  const money = (n: number | undefined | null) => formatOrgMoney(n, input.moneyPrefs, input.locale);
  const tr = (text: string) => docT(input.locale, text);
  const zone = docZone(input.timeZone);
  const dateLabel = input.invoiceDate
    ? docDateLabel(input.invoiceDate, zone, input.locale)
    : docDateLabel(null, zone, input.locale);
  const dueLabel = input.dueDate ? docDateLabel(input.dueDate, zone, input.locale) : '—';

  const rule = documentRuleColor(input.theme, input.themeScope);

  let linesHtml =
    `<table style="width:100%;border-collapse:collapse;font-size:11px;margin:0 0 12px;">` +
    `<thead><tr style="background:#f5f5f5;border-bottom:2px solid ${rule};">` +
    `<th style="text-align:left;padding:6px 4px;">${tr('Part #')}</th>` +
    `<th style="text-align:left;padding:6px 4px;">${tr('Description')}</th>` +
    `<th style="text-align:right;padding:6px 4px;">${tr('Qty')}</th>` +
    `<th style="text-align:right;padding:6px 4px;">${tr('Price')}</th>` +
    `<th style="text-align:right;padding:6px 4px;">${tr('Ext')}</th>` +
    `</tr></thead><tbody>`;

  const items = (input.lines || []).filter(
    (it) => it.description || it.part_number || it.unit_price
  );
  if (!items.length) {
    linesHtml += `<tr><td colspan="5" style="padding:8px;color:#666;">${tr('No line items')}</td></tr>`;
  } else {
    items.forEach((it) => {
      const ext = it.ext ?? (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
      linesHtml +=
        `<tr style="border-bottom:1px solid #eee;">` +
        `<td style="padding:5px 4px;vertical-align:top;">${esc(it.part_number || '')}</td>` +
        `<td style="padding:5px 4px;vertical-align:top;">${esc(it.description || '')}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${Number(it.qty || 0)
          .toFixed(2)
          .replace(/\.00$/, '')}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${money(it.unit_price)}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${money(ext)}</td>` +
        `</tr>`;
    });
  }
  linesHtml += `</tbody></table>`;

  const deposit = Number(input.deposit) || 0;
  const total = Number(input.total) || 0;
  const dueNow = Number(input.dueNow) || 0;
  const deferred = Number(input.deferred) || 0;
  const hasSplit = deferred > 0.004 && dueNow > 0;
  const balance = input.balanceDue != null ? Number(input.balanceDue) : Math.max(0, total - deposit);
  const collectable =
    input.collectableAmount != null
      ? Number(input.collectableAmount)
      : input.deferredReleased
        ? balance
        : hasSplit
          ? Math.max(0, dueNow - deposit)
          : balance;

  return withDocDirection(
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.35;max-width:800px;margin:auto;">` +
    buildDocTopHeader(input.company, tr('Invoice'), input.invNumber, dateLabel, {
      theme: input.theme,
      themeScope: input.themeScope,
      locale: input.locale,
    }) +
    customerBillTo({
      ...input.customer,
    }, 'Customer / Bill To', input.locale) +
    `<div style="margin-bottom:10px;padding:6px 8px;background:#f9f9f9;border:1px solid #eee;border-radius:4px;">` +
    `<div style="font-size:9px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">${tr('Invoice')}</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;">` +
    `<div>${fieldLabel(input.locale, 'Invoice date')} ${esc(dateLabel)}</div>` +
    `<div>${fieldLabel(input.locale, 'Invoice #')} ${esc(input.invNumber)}</div>` +
    `<div>${fieldLabel(input.locale, 'Due date')} ${esc(dueLabel)}</div>` +
    (input.preparedBy || input.company.tech_name
      ? `<div>${fieldLabel(input.locale, 'Prepared by')} ${esc(
          input.preparedBy || input.company.tech_name
        )}</div>`
      : '') +
    (input.fromEstimateId
      ? `<div>${fieldLabel(input.locale, 'From estimate')} #${esc(
          String(input.fromEstimateId)
        )}</div>`
      : '') +
    `</div></div>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid ${rule};padding-bottom:4px;font-size:13px;">${tr('Line Items')}</h3>` +
    linesHtml +
    (input.description
      ? `<div style="margin:0 0 12px;font-size:11px;color:#444;"><strong>${tr('Notes')}:</strong> <bdi dir="auto">${esc(
          displayModelText(input.description)
        )}</bdi></div>`
      : '') +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid ${rule};padding-bottom:4px;font-size:13px;">${tr('Amounts')}</h3>` +
    `<div style="font-size:13px;font-weight:600;">` +
    `<div>${tr('Subtotal')}: ${money(input.subtotal)}</div>` +
    `<div>${tr('Tax')}: ${money(input.tax)}</div>` +
    `<div class="totals" style="margin-top:10px;padding-top:10px;border-top:2px solid #ccc;font-size:1.25rem;">${tr('Invoice Total')}: ${money(
      total
    )}</div>` +
    (hasSplit
      ? `<div style="margin-top:10px;padding:10px;background:#fffbeb;border:1px solid ${rule};border-radius:6px;font-size:12px;">` +
        `<div style="font-weight:800;font-size:12px;color:#92400e;margin-bottom:6px;">${tr('Payment split')}</div>` +
        `<div>${tr('Due now (parts/travel deposit)')}: <strong>${money(dueNow)}</strong></div>` +
        `<div>${tr('Remaining (due on completion)')}: <strong>${money(deferred)}</strong></div>` +
        (deposit > 0
          ? `<div style="margin-top:8px;">${tr('Deposit received')}: <strong>${money(deposit)}</strong>` +
            (input.depositDate
              ? ` ${docFill(input.locale, 'on {date}', { date: docDateLabel(input.depositDate, zone, input.locale) })}`
              : '') +
            (input.depositMethod ? ` ${docFill(input.locale, 'via {method}', { method: esc(tr(input.depositMethod)) })}` : '') +
            `</div>` +
            `<div style="font-size:1.1rem;margin-top:4px;">${tr('Still owed')}: <strong>${money(
              balance
            )}</strong></div>`
          : '') +
        `</div>`
      : deposit > 0
        ? `<div style="margin-top:10px;padding:10px;background:#fffbeb;border:1px solid ${rule};border-radius:6px;font-size:12px;">` +
          `<div>${tr('Deposit received')}: <strong>${money(deposit)}</strong>` +
          (input.depositDate
            ? ` ${docFill(input.locale, 'on {date}', { date: docDateLabel(input.depositDate, zone, input.locale) })}`
            : '') +
          (input.depositMethod ? ` ${docFill(input.locale, 'via {method}', { method: esc(tr(input.depositMethod)) })}` : '') +
          `</div>` +
          `<div style="font-size:1.1rem;margin-top:4px;">${tr('Balance remaining')}: <strong>${money(
            balance
          )}</strong></div></div>`
        : '') +
    `</div>` +
    `<div style="margin-top:28px;font-size:11px;color:#555;text-align:center;border-top:1px solid #eee;padding-top:12px;">` +
    (hasSplit && deposit <= 0
      ? `${docFill(input.locale, 'A parts/travel deposit of {due} is due now. The remaining {rest} is due upon completion of the service call.', {
          due: money(dueNow),
          rest: money(deferred),
        })}<br>`
      : '') +
    (hasSplit && deposit > 0 && !input.deferredReleased
      ? `${docFill(input.locale, 'Deposit has been applied. Remaining balance of {balance} is payable upon completion of the service call.', {
          balance: money(balance),
        })}<br>`
      : '') +
    (!hasSplit && deposit > 0
      ? `${tr('Deposit has been applied. Remaining balance is payable upon completion of the service call.')}<br>`
      : '') +
    (input.paymentUrl && collectable > 0
      ? `<div style="margin:18px 0 8px;text-align:center;">` +
        `<a href="${esc(input.paymentUrl)}" ` +
        `style="${payButtonStyle(input.theme)}">` +
        `${
          hasSplit && !input.deferredReleased && deposit <= 0
            ? docFill(input.locale, 'Pay deposit {amount} securely with Stripe', { amount: money(collectable) })
            : docFill(input.locale, 'Pay {amount} securely with Stripe', { amount: money(collectable) })
        }</a>` +
        `<div style="font-size:10px;color:#666;margin-top:8px;">${tr('Secure card payment · Powered by Stripe')}</div>` +
        `</div>`
      : '') +
    `<!--tsp-thanks-->${docFill(input.locale, 'Thank you for choosing {shop}!', {
      shop: esc(input.company.company_name || 'Total Service Pro'),
    })}` +
    `</div></div>`
  , input.locale);
}

export type PurchaseOrderHtmlInput = {
  company: DocCompany;
  supplier: DocCustomer;
  poNumber: string;
  poDate: string;
  neededBy?: string;
  shipTo?: string;
  description?: string;
  preparedBy?: string;
  lines: { part_number?: string; description?: string; qty?: number; unit_price?: number; ext?: number }[];
  subtotal: number;
  tax: number;
  total: number;
  moneyPrefs?: OrgMoneyPrefs | null;
  locale?: string | null;
};

export function buildPurchaseOrderHtml(input: PurchaseOrderHtmlInput): string {
  const money = (n: number | undefined | null) => formatOrgMoney(n, input.moneyPrefs, input.locale);
  const tr = (text: string) => docT(input.locale, text);
  const dateLabel = input.poDate
    ? docDateLabel(input.poDate, DEFAULT_ORG_TIMEZONE, input.locale)
    : docDateLabel(null, DEFAULT_ORG_TIMEZONE, input.locale);
  const neededLabel = input.neededBy
    ? docDateLabel(input.neededBy, DEFAULT_ORG_TIMEZONE, input.locale)
    : '—';

  let linesHtml =
    `<table style="width:100%;border-collapse:collapse;font-size:11px;margin:0 0 12px;">` +
    `<thead><tr style="background:#f5f5f5;border-bottom:2px solid #FBBF24;">` +
    `<th style="text-align:left;padding:6px 4px;">${tr('Part #')}</th>` +
    `<th style="text-align:left;padding:6px 4px;">${tr('Description')}</th>` +
    `<th style="text-align:right;padding:6px 4px;">${tr('Qty')}</th>` +
    `<th style="text-align:right;padding:6px 4px;">${tr('Price')}</th>` +
    `<th style="text-align:right;padding:6px 4px;">${tr('Ext')}</th>` +
    `</tr></thead><tbody>`;

  const items = (input.lines || []).filter(
    (it) => it.description || it.part_number || it.unit_price
  );
  if (!items.length) {
    linesHtml += `<tr><td colspan="5" style="padding:8px;color:#666;">${tr('No line items')}</td></tr>`;
  } else {
    items.forEach((it) => {
      const ext = it.ext ?? (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
      linesHtml +=
        `<tr style="border-bottom:1px solid #eee;">` +
        `<td style="padding:5px 4px;vertical-align:top;">${esc(it.part_number || '')}</td>` +
        `<td style="padding:5px 4px;vertical-align:top;">${esc(it.description || '')}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${Number(it.qty || 0)
          .toFixed(2)
          .replace(/\.00$/, '')}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${money(it.unit_price)}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${money(ext)}</td>` +
        `</tr>`;
    });
  }
  linesHtml += `</tbody></table>`;

  return withDocDirection(
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.35;max-width:800px;margin:auto;">` +
    buildDocTopHeader(input.company, tr('Purchase Order'), input.poNumber, dateLabel, { locale: input.locale }) +
    customerBillTo(
      {
        ...input.supplier,
        name: input.supplier.name || tr('Parts supplier'),
      },
      'Vendor / Parts Supplier',
      input.locale,
    ) +
    `<div style="margin-bottom:10px;padding:6px 8px;background:#f9f9f9;border:1px solid #eee;border-radius:4px;">` +
    `<div style="font-size:9px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">${tr('Purchase Order')}</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;">` +
    `<div>${fieldLabel(input.locale, 'PO date')} ${esc(dateLabel)}</div>` +
    `<div>${fieldLabel(input.locale, 'PO #')} ${esc(input.poNumber)}</div>` +
    `<div>${fieldLabel(input.locale, 'Needed by')} ${esc(neededLabel)}</div>` +
    (input.preparedBy || input.company.tech_name
      ? `<div>${fieldLabel(input.locale, 'Prepared by')} ${esc(
          input.preparedBy || input.company.tech_name
        )}</div>`
      : '') +
    (input.shipTo
      ? `<div style="grid-column:1 / -1;">${fieldLabel(input.locale, 'Ship to')} ${esc(
          input.shipTo
        )}</div>`
      : '') +
    `</div></div>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px;">${tr('Line Items')}</h3>` +
    linesHtml +
    (input.description
      ? `<div style="margin:0 0 12px;font-size:11px;color:#444;"><strong>${tr('Notes')}:</strong> ${esc(
          input.description
        )}</div>`
      : '') +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px;">${tr('Amounts')}</h3>` +
    `<div style="font-size:13px;font-weight:600;">` +
    `<div>${tr('Subtotal')}: ${money(input.subtotal)}</div>` +
    `<div>${tr('Tax')}: ${money(input.tax)}</div>` +
    `<div class="totals" style="margin-top:10px;padding-top:10px;border-top:2px solid #ccc;font-size:1.25rem;">${tr('PO Total')}: ${money(
      input.total
    )}</div>` +
    `</div>` +
    `<div style="margin-top:28px;font-size:11px;color:#555;text-align:center;border-top:1px solid #eee;padding-top:12px;">` +
    `${docFill(input.locale, 'Please confirm this purchase order with {shop}.', {
      shop: esc(input.company.company_name || 'Total Service Pro'),
    })}` +
    `</div></div>`
  , input.locale);
}

export type EstimateHtmlInput = {
  company: DocCompany;
  customer: DocCustomer;
  estNumber: string;
  dateStr: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  pulseCount?: string;
  miles?: number;
  urgency?: string;
  services: string[];
  issues?: string;
  laborHours?: number;
  laborRate?: number;
  labor?: number;
  travelRate?: number;
  travel?: number;
  diagFee?: number;
  reimbTravel?: number;
  reimbLodging?: number;
  reimbGround?: number;
  reimbOther?: number;
  perDiem?: number;
  perDiemRate?: number;
  perDiemDays?: number;
  partsLines?: string[];
  /** Structured parts so the part number, name, and each amount can be isolated separately. */
  partRows?: {
    partNumber?: string | null;
    description?: string | null;
    qty?: number | null;
    unitPrice?: number | null;
    ext?: number | null;
  }[];
  partsTotal?: number;
  subtotal: number;
  taxRate?: number;
  tax: number;
  total: number;
  deposit?: number;
  /**
   * When false, a stored deposit amount is not printed. Omit to keep the
   * historical "show a positive deposit" behavior for direct callers.
   */
  depositRequired?: boolean;
  balanceDue?: number;
  validDays?: number;
  /** Clinic estimate page (https://repairplanet.net/estimates/{id}). */
  actionUrl?: string | null;
  theme?: CompanyTheme | null;
  themeScope?: DocThemeScope;
  moneyPrefs?: OrgMoneyPrefs | null;
  locale?: string | null;
};

export function buildEstimateHtml(input: EstimateHtmlInput): string {
  const money = (n: number | undefined | null) =>
    isolateLtr(formatOrgMoney(n, input.moneyPrefs, input.locale));
  const tr = (text: string) => docT(input.locale, text);
  const services = (input.services?.length ? input.services : ['Not specified']).map((item) => tr(item));
  const rule = documentRuleColor(input.theme, input.themeScope);
  const deposit = input.depositRequired === false ? 0 : Number(input.deposit) || 0;
  const balance =
    input.balanceDue != null
      ? Number(input.balanceDue)
      : Math.max(0, Number(input.total) - deposit);
  const dateLabel = docDate(input.dateStr, input.locale, input.dateStr);
  const urgencyRaw = (input.urgency || 'standard').replace(/^\w/, (c) => c.toUpperCase());

  let cost = `<div style="font-size:12px;">`;
  if (input.diagFee) cost += `<div>${tr('Diagnostic Fee')}: ${money(input.diagFee)}</div>`;
  if (input.labor)
    cost += `<div>${docFill(input.locale, 'Labor: {hours} hrs @ {rate}/hr = {amount}', {
      hours: input.laborHours ?? 0,
      rate: money(input.laborRate),
      amount: money(input.labor),
    })}</div>`;
  if (input.travel)
    cost += `<div>${docFill(input.locale, 'Travel (mileage): {miles} mi @ {rate}/mi = {amount}', {
      miles: input.miles ?? 0,
      rate: money(input.travelRate),
      amount: money(input.travel),
    })}</div>`;
  if (
    input.reimbTravel ||
    input.reimbLodging ||
    input.reimbGround ||
    input.reimbOther ||
    input.perDiem
  ) {
    cost += `<div style="margin-top:8px;font-weight:700;font-size:11px;color:#555;">${tr('Reimbursable expenses')}</div>`;
  }
  if (input.reimbTravel)
    cost += `<div style="padding-left:8px;">${tr('Travel (airfare / tickets)')}: ${money(input.reimbTravel)}</div>`;
  if (input.reimbLodging)
    cost += `<div style="padding-left:8px;">${tr('Lodging')}: ${money(input.reimbLodging)}</div>`;
  if (input.reimbGround)
    cost += `<div style="padding-left:8px;">${tr('Car rental / ground transportation')}: ${money(
      input.reimbGround
    )}</div>`;
  if (input.perDiem)
    cost += `<div style="padding-left:8px;">${docFill(input.locale, 'Per diem: {days} day(s) @ {rate}/day = {amount}', {
      days: input.perDiemDays ?? 0,
      rate: money(input.perDiemRate),
      amount: money(input.perDiem),
    })}</div>`;
  if (input.reimbOther)
    cost += `<div style="padding-left:8px;">${tr('Other')}: ${money(input.reimbOther)}</div>`;
  if (input.partsTotal) {
    cost += `<div style="margin-top:6px;">${tr('Parts')}:<br>`;
    const rows = (input.partRows || []).filter(
      (row) => row.partNumber || row.description || row.unitPrice || row.ext,
    );
    if (rows.length) {
      rows.forEach((row) => {
        const qty = Number(row.qty) > 0 ? Number(row.qty) : 1;
        const label = [
          row.partNumber && String(row.partNumber).trim() ? isolateUserText(String(row.partNumber).trim()) : '',
          row.description && String(row.description).trim() ? isolateUserText(String(row.description).trim()) : '',
        ].filter(Boolean);
        const ext = row.ext != null ? Number(row.ext) : qty * (Number(row.unitPrice) || 0);
        cost += `<div>${label.join(' ') || isolateUserText('Part')} ×${qty} @ ${money(row.unitPrice)} = ${money(ext)}</div>`;
      });
    } else {
      (input.partsLines || []).forEach((ln) => {
        cost += `<div>${partLineHtml(ln)}</div>`;
      });
    }
    cost += `<strong>${tr('Parts Subtotal')}: ${money(input.partsTotal)}</strong></div>`;
  }
  cost +=
    `<div class="totals" style="font-weight:bold;font-size:1.1rem;margin-top:14px;border-top:2px solid #ccc;padding-top:12px;">` +
    `${tr('Subtotal')}: ${money(input.subtotal)}<br>` +
    `${docFill(input.locale, 'Tax ({rate}%): {amount}', {
      rate: input.taxRate ?? 0,
      amount: money(input.tax),
    })}<br>` +
    `<span style="font-size:1.25rem;">${tr('Grand Total')}: ${money(input.total)}</span></div>`;
  if (deposit > 0) {
    cost +=
      `<div style="margin-top:14px;padding:12px;background:#fffbeb;border:1px solid ${rule};border-radius:6px;">` +
      `<div style="font-weight:800;font-size:13px;color:#92400e;margin-bottom:6px;">${tr('Parts / Travel Deposit')}</div>` +
      `<div style="font-size:12px;color:#111;line-height:1.45;">` +
      `${docFill(
        input.locale,
        'A deposit of {deposit} (covering estimated parts and travel-related costs) must be paid before the service call is scheduled. The remaining balance of {balance} is due upon completion of the service call.',
        { deposit: money(deposit), balance: money(balance) },
      )}` +
      `</div></div>`;
  }
  cost += `</div>`;

  const valid = input.validDays ?? 30;

  return withDocDirection(
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.35;max-width:800px;margin:auto;">` +
    buildDocTopHeader(input.company, tr('Service Estimate'), input.estNumber, dateLabel, {
      theme: input.theme,
      themeScope: input.themeScope,
      locale: input.locale,
    }) +
    (input.actionUrl ? buildEstimateActionCtasHtml(input.actionUrl, 'banner', input.locale) : '') +
    customerBillTo(input.customer, 'Customer / Bill To', input.locale) +
    `<div style="margin-bottom:10px;padding:6px 8px;background:#f9f9f9;border:1px solid #eee;border-radius:4px;">` +
    `<div style="font-size:9px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">${tr('Estimate Details')}</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;">` +
    `<div>${fieldLabel(input.locale, 'Manufacturer')} ${esc(input.manufacturer || '—')}</div>` +
    `<div>${fieldLabel(input.locale, 'Model')} ${esc(input.model ? displayModelName(input.model) : '—')}</div>` +
    `<div>${fieldLabel(input.locale, 'Serial #')} ${esc(input.serial || '—')}</div>` +
    `<div>${fieldLabel(input.locale, 'Pulse count')} ${esc(input.pulseCount || '—')}</div>` +
    `<div>${fieldLabel(input.locale, 'Travel')} ${docFill(input.locale, '{miles} mi round-trip', { miles: input.miles ?? 0 })}</div>` +
    `<div>${fieldLabel(input.locale, 'Urgency')} ${esc(tr(urgencyRaw))}</div>` +
    (input.company.tech_name
      ? `<div>${fieldLabel(input.locale, 'Prepared by')} ${esc(input.company.tech_name)}</div>`
      : '') +
    `<div>${fieldLabel(input.locale, 'Date')} ${esc(dateLabel)}</div>` +
    `</div></div>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid ${rule};padding-bottom:4px;font-size:13px;">${tr('Services Included')}</h3>` +
    `<div style="font-size:12px;margin-bottom:12px;">${services
      .map((s) => `• ${esc(s)}`)
      .join('<br>')}</div>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid ${rule};padding-bottom:4px;font-size:13px;">${tr('Reported Issues')}</h3>` +
    `<pre style="white-space:pre-wrap;font-family:inherit;margin:0 0 12px;font-size:12px;background:#f9f9f9;padding:8px;border-radius:4px;"><bdi dir="auto">${esc(
      input.issues || tr('No issues noted')
    )}</bdi></pre>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid ${rule};padding-bottom:4px;font-size:13px;">${tr('Cost Breakdown')}</h3>` +
    cost +
    `<div style="margin-top:28px;font-size:11px;color:#555;text-align:center;border-top:1px solid #eee;padding-top:12px;">` +
    `<div style="margin-top:10px;padding:10px;background:#f8f4e8;border:1px solid #e8d9a0;border-radius:6px;font-size:11px;color:#111;">` +
    `${docFill(
      input.locale,
      'Validity: This estimate is good for {days} days from the date above. After {days} days it is considered expired and pricing may be revised. Prices are subject to on-site inspection.',
      { days: valid },
    )}` +
    `</div>` +
    (deposit > 0
      ? `<div style="margin-top:8px;font-size:11px;color:#555;">${tr('Scheduling is contingent on receipt of the parts/travel deposit described above.')}</div>`
      : '') +
    (input.actionUrl ? buildEstimateActionCtasHtml(input.actionUrl, 'repeat', input.locale) : '') +
    `<div style="margin-top:12px;"><!--tsp-thanks-->${docFill(input.locale, 'Thank you for choosing {shop}!', {
      shop: esc(input.company.company_name || 'Total Service Pro'),
    })}</div></div></div>`
  , input.locale);
}

/** Plain-text part of the estimate email. Links stay on their own lines so words do not run together. */
export function buildEstimatePlainText(input: EstimateHtmlInput): string {
  const locale = input.locale;
  const tr = (text: string) => docT(locale, text);
  const fill = (text: string, vars: Record<string, string | number>) => docFill(locale, text, vars);
  const amount = (n: number | undefined | null) => formatOrgMoney(n, input.moneyPrefs, input.locale);
  const company = input.company.company_name || 'Total Service Pro';
  const lines: string[] = [
    company,
    `${tr('Service estimate')} ${input.estNumber || ''}`.trim(),
  ];
  if (input.dateStr) lines.push(input.dateStr);
  lines.push('', `${tr('Customer')}: ${input.customer.name || tr('Customer')}`);
  if (input.customer.email) lines.push(`${tr('Email')}: ${input.customer.email}`);
  if (input.services?.length) lines.push('', `${tr('Services')}:`, ...input.services.map((s) => `- ${s}`));
  if (input.diagFee) lines.push(`${tr('Diagnostic Fee')}: ${amount(input.diagFee)}`);
  if (input.labor) {
    lines.push(
      fill('Labor: {hours} hrs @ {rate}/hr = {amount}', {
        hours: input.laborHours ?? 0,
        rate: amount(input.laborRate),
        amount: amount(input.labor),
      })
    );
  }
  if (input.partsLines?.length) {
    lines.push('', `${tr('Parts')}:`);
    for (const line of input.partsLines) lines.push(line);
  }
  if (input.partsTotal) lines.push(`${tr('Parts subtotal')}: ${amount(input.partsTotal)}`);
  lines.push(
    '',
    `${tr('Subtotal')}: ${amount(input.subtotal)}`,
    `${tr('Tax')}: ${amount(input.tax)}`,
    `${tr('Grand total')}: ${amount(input.total)}`
  );
  if (input.actionUrl) {
    lines.push(
      '',
      tr('Respond to this estimate. No login required.'),
      `${tr('Approve')}: ${estimateEmailActionHref(input.actionUrl, 'approve')}`,
      `${tr('Reject')}: ${estimateEmailActionHref(input.actionUrl, 'reject')}`,
      `${tr('Modify')}: ${estimateEmailActionHref(input.actionUrl, 'modify')}`,
      '',
      tr('These links are unique to this estimate.')
    );
  }
  lines.push('', fill('Thank you for choosing {shop}.', { shop: company }));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Open print dialog with full HTML document (app-quality PDF via browser Save as PDF). */
export function printDocumentHtml(bodyInner: string, title: string) {
  const full =
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title>` +
    `<style>html,body{margin:0;padding:12px;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.3;}` +
    `img{max-width:100%;} pre{white-space:pre-wrap;}` +
    `@media print{@page{size:letter;margin:0.4in}}</style></head><body>` +
    bodyInner +
    `</body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    throw new Error('Allow pop-ups to export PDF');
  }
  w.document.write(full);
  w.document.close();
  // Wait for images (logo) to load before print
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* ignore */
    }
  }, 500);
}
