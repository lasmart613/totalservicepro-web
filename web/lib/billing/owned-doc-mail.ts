/**
 * Send invoice / estimate / service-report mail only for a document the
 * caller's organization owns. The request body cannot choose the HTML or the
 * recipient. These helpers never sign a clinic account-claim token.
 */

import type { CompanyTheme } from '../company-theme.ts';
import { formatOrgMoney, type OrgMoneyPrefs } from '../money-format.ts';
import { DEFAULT_ORG_TIMEZONE, formatDateInTimeZone } from '../org-timezone.ts';
import {
  buildEstimateHtml,
  buildEstimatePlainText,
  buildInvoiceHtml,
  type DocCompany,
  type EstimateHtmlInput,
} from './doc-html.ts';
import { resolveInvoiceCollectable } from './invoice-collectable.ts';
import { parseJsonField, SERVICE_TYPE_LABELS } from './save-helpers.ts';
import { buildServiceReportPrintHTML } from '../service-report-print.ts';

const COLUMN_MISSING = /column|schema cache|does not exist/i;
const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type QueryClient = {
  from: (table: string) => any;
};

export type OwnedDocumentResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; status: 403 | 404; error: string };

export function isMailbox(value: unknown): boolean {
  return MAILBOX.test(String(value || '').trim());
}

/**
 * Organization on the row must match the caller's organization.
 * created_by is not ownership: a user can create a row for another shop.
 */
export function documentOwnedByOrganization(
  row: { organization_id?: unknown } | null | undefined,
  callerOrgId: unknown
): boolean {
  if (!row || callerOrgId == null || String(callerOrgId).trim() === '') return false;
  if (row.organization_id == null || String(row.organization_id).trim() === '') return false;
  return String(row.organization_id) === String(callerOrgId);
}

/** Only the document id (and the invoice pay-link flag) is read from the body. */
export function ownedSendRequest(
  body: unknown,
  idKey: 'invoice_id' | 'estimate_id' | 'report_id'
): { documentId: string | number | null; includePaymentLink: boolean } {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  return {
    documentId: parseDocumentId(record[idKey]),
    includePaymentLink: record.include_payment_link !== false,
  };
}

export function parseDocumentId(raw: unknown): string | number | null {
  if (raw == null || raw === '' || raw === 'new') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  if (!text || text === 'new') return null;
  if (/^\d+$/.test(text)) return Number(text);
  return text;
}

export function documentCustomerOrgId(
  row: Record<string, unknown>,
  dataKey?: 'invoice_data' | 'estimate_data'
): string | number | null {
  const direct = row.customer_organization_id;
  if (direct != null && String(direct).trim() !== '') return direct as string | number;
  if (!dataKey) return null;
  const nested = parseJsonField(row[dataKey]).customer_organization_id;
  if (nested != null && String(nested).trim() !== '') return nested as string | number;
  return null;
}

export function storedCustomerEmail(
  row: Record<string, unknown>,
  kind: 'invoice' | 'estimate' | 'report'
): string {
  if (kind === 'report') return String(row.customer_email || '').trim();
  const data = parseJsonField(row[kind === 'invoice' ? 'invoice_data' : 'estimate_data']);
  return String(data.custEmail || data.customer_email || '').trim();
}

/**
 * Recipient is the CRM address the caller can already read, then the address
 * stored on the owned document. A form/body address is not an input.
 */
export function resolveOwnedRecipient(input: {
  crm?: { email?: string | null; source?: string | null } | null;
  storedEmail?: string | null;
}): { email: string; source: 'crm_org' | 'crm_contact' | 'document' | 'none' } {
  const crmEmail = String(input.crm?.email || '').trim();
  if (isMailbox(crmEmail) && input.crm?.source === 'crm_contact') {
    return { email: crmEmail, source: 'crm_contact' };
  }
  if (isMailbox(crmEmail) && input.crm?.source === 'crm_org') {
    return { email: crmEmail, source: 'crm_org' };
  }
  const stored = String(input.storedEmail || '').trim();
  if (isMailbox(stored)) return { email: stored, source: 'document' };
  return { email: '', source: 'none' };
}

/** Signup and login links with no invite claim token and no customer email. */
export function documentAccountLinks(
  origin: string,
  nextPath?: string | null
): { signupUrl: string; loginUrl: string } {
  const base = String(origin || 'https://repairplanet.net').replace(/\/$/, '');
  const next = String(nextPath || '').trim();
  return {
    signupUrl: `${base}/signup/owner`,
    loginUrl: next ? `${base}/login?next=${encodeURIComponent(next)}` : `${base}/login`,
  };
}

/**
 * Subject keeps the existing wording. The only brand is the owning shop's name.
 * A blank name is left off — nothing is substituted.
 */
export function ownedDocumentSubject(
  kind: 'invoice' | 'estimate' | 'report',
  docNumber: unknown,
  shopName: unknown
): string {
  const num = String(docNumber || '').trim();
  const shop = String(shopName ?? '').trim();
  const fromShop = shop ? ` from ${shop}` : '';
  if (kind === 'invoice') {
    return num ? `Invoice ${num}${fromShop}` : `Invoice${fromShop}`;
  }
  if (kind === 'estimate') {
    return num ? `Estimate ${num}${fromShop}` : `Service estimate${fromShop}`;
  }
  return num ? `Service Report ${num}${fromShop}` : `Service report${fromShop}`;
}

export function senderCompanyFromOrg(
  org: Record<string, unknown> | null | undefined,
  techName?: string | null
): DocCompany {
  const row = org || {};
  return {
    company_name: String(row.name || row.company_name || ''),
    address: String(row.address || ''),
    city: String(row.city || ''),
    state: String(row.state || ''),
    zip: String(row.zip || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    website: String(row.website || ''),
    logo_url: String(row.logo_url || ''),
    slogan: String(row.slogan || ''),
    tech_name: String(techName || ''),
  };
}

const SENDER_ORG_SELECTS = [
  'name, address, city, state, zip, phone, email, website, logo_url, slogan',
  'name, address, city, state, zip, phone, email, website, logo_url',
  'name, phone, email',
  'name',
] as const;

export async function loadSenderCompany(
  client: QueryClient,
  orgId: string | number,
  techName?: string | null
): Promise<DocCompany> {
  for (const cols of SENDER_ORG_SELECTS) {
    try {
      const { data, error } = await client
        .from('organizations')
        .select(cols)
        .eq('id', orgId)
        .maybeSingle();
      if (!error && data) return senderCompanyFromOrg(data as Record<string, unknown>, techName);
      if (error && !COLUMN_MISSING.test(String(error.message || ''))) break;
    } catch {
      break;
    }
  }
  return senderCompanyFromOrg(null, techName);
}

export function buildOwnedInvoiceMessage(input: {
  row: Record<string, unknown>;
  company: DocCompany;
  theme: CompanyTheme | null;
  paymentUrl?: string | null;
  moneyPrefs?: OrgMoneyPrefs | null;
  locale?: string | null;
  timeZone?: string | null;
}): string {
  const data = parseJsonField(input.row.invoice_data);
  const lines = Array.isArray(data.line_items) ? data.line_items : [];
  const collectable = resolveInvoiceCollectable({
    total: input.row.total,
    amountPaid: input.row.amount_paid,
    invoice_data: input.row.invoice_data,
  });
  const lineSum = lines.reduce(
    (sum: number, line: { ext?: unknown; qty?: unknown; unit_price?: unknown }) =>
      sum + num(line.ext ?? num(line.qty) * num(line.unit_price)),
    0
  );
  const subtotal = num(input.row.subtotal ?? data.subtotal) || lineSum;
  const tax = num(input.row.tax ?? data.tax);
  const total = num(input.row.total ?? data.total) || subtotal + tax;
  return buildInvoiceHtml({
    company: input.company,
    customer: {
      name: String(input.row.customer_name || ''),
      address: String(data.custAddress || ''),
      city: String(data.custCity || ''),
      state: String(data.custState || ''),
      zip: String(data.custZip || ''),
      contact: String(data.custContact || ''),
      phone: String(data.custPhone || ''),
      email: String(data.custEmail || ''),
    },
    invNumber: String(input.row.invoice_number || data.invoice_number || data.invNumber || ''),
    invoiceDate: String(input.row.invoice_date || data.invoice_date || ''),
    dueDate: input.row.due_date ? String(input.row.due_date) : undefined,
    description: input.row.description ? String(input.row.description) : data.description ? String(data.description) : undefined,
    preparedBy: input.company.tech_name,
    lines,
    subtotal,
    tax,
    total,
    deposit: num(data.deposit ?? input.row.amount_paid),
    depositDate: data.depositDate ? String(data.depositDate) : undefined,
    depositMethod: data.depositMethod ? String(data.depositMethod) : undefined,
    balanceDue: collectable.remainingOwed,
    dueNow: collectable.hasDeferredSplit ? collectable.dueNowOriginal : undefined,
    deferred: collectable.hasDeferredSplit ? collectable.deferredOriginal : undefined,
    deferredReleased: collectable.deferredReleased,
    collectableAmount: collectable.stripeAmount,
    paymentUrl: input.paymentUrl || null,
    theme: input.theme,
    themeScope: 'email',
    moneyPrefs: input.moneyPrefs,
    locale: input.locale,
    timeZone: input.timeZone,
  });
}

export function buildOwnedEstimateMessage(input: {
  row: Record<string, unknown>;
  company: DocCompany;
  theme: CompanyTheme | null;
  actionUrl?: string | null;
  moneyPrefs?: OrgMoneyPrefs | null;
  locale?: string | null;
  timeZone?: string | null;
}): string {
  return buildEstimateHtml(ownedEstimateHtmlInput(input));
}

export function buildOwnedEstimatePlainText(input: {
  row: Record<string, unknown>;
  company: DocCompany;
  theme: CompanyTheme | null;
  actionUrl?: string | null;
  moneyPrefs?: OrgMoneyPrefs | null;
  locale?: string | null;
  timeZone?: string | null;
}): string {
  return buildEstimatePlainText(ownedEstimateHtmlInput(input));
}

function ownedEstimateHtmlInput(input: {
  row: Record<string, unknown>;
  company: DocCompany;
  theme: CompanyTheme | null;
  actionUrl?: string | null;
  moneyPrefs?: OrgMoneyPrefs | null;
  locale?: string | null;
  timeZone?: string | null;
}): EstimateHtmlInput {
  const data = parseJsonField(input.row.estimate_data);
  const servicesRaw = Array.isArray(input.row.services)
    ? input.row.services
    : Array.isArray(data.services)
      ? data.services
      : [];
  const services = servicesRaw.map((item: unknown) => SERVICE_TYPE_LABELS[String(item)] || String(item));
  const pricing =
    data.pricing && typeof data.pricing === 'object' ? (data.pricing as Record<string, unknown>) : {};
  return {
    company: input.company,
    customer: {
      name: String(input.row.customer_name || ''),
      address: String(data.custAddress || ''),
      city: String(data.custCity || ''),
      state: String(data.custState || ''),
      zip: String(data.custZip || ''),
      contact: String(data.custContact || ''),
      phone: String(data.custPhone || ''),
      email: String(data.custEmail || ''),
    },
    estNumber: String(input.row.estimate_number || data.estimate_number || data.estNumber || ''),
    dateStr: formatDocDate(input.row.created_at, input.timeZone),
    manufacturer: String(data.manufacturer || ''),
    model: String(data.model || ''),
    serial: String(data.serial || ''),
    pulseCount: String(data.pulse_count || ''),
    miles: num(data.miles),
    urgency: String(data.urgency || ''),
    services: services.length ? services : ['Not specified'],
    issues: String(input.row.issues || data.description || ''),
    laborHours: num(data.laborHours),
    laborRate: num(pricing.laborRate),
    labor: num(data.labor),
    travelRate: num(pricing.travelRate),
    travel: num(data.travel),
    diagFee: num(pricing.diagFee),
    reimbTravel: num(data.reimbTravel),
    reimbLodging: num(data.reimbLodging),
    reimbGround: num(data.reimbGround),
    reimbOther: num(data.reimbOther),
    perDiem: num(data.perDiem),
    perDiemRate: num(data.perDiemRate),
    perDiemDays: num(data.perDiemDays),
    partsLines: formatEstimatePartLines(data, input.moneyPrefs, input.locale),
    partsTotal: num(data.partsTotal),
    subtotal: num(data.subtotal),
    taxRate: num(pricing.taxRate),
    tax: num(data.tax),
    total: num(input.row.total ?? data.total),
    deposit: num(data.deposit),
    balanceDue: num(data.balanceDue),
    validDays: 30,
    actionUrl: input.actionUrl || null,
    theme: input.theme,
    themeScope: 'email',
    moneyPrefs: input.moneyPrefs,
    locale: input.locale,
  };
}

function formatEstimatePartLines(
  data: Record<string, unknown>,
  moneyPrefs?: OrgMoneyPrefs | null,
  locale?: string | null
): string[] {
  const structured = Array.isArray(data.part_lines) ? data.part_lines : [];
  const rows = structured.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)
  );
  const usable = rows.filter(
    (row) => row.description || row.part_number || num(row.ext) || num(row.unit_price)
  );
  if (usable.length) {
    return usable.map((row) => {
      const label = [row.part_number, row.description].filter(Boolean).join(' ').trim() || 'Part';
      const qty = num(row.qty) > 0 ? num(row.qty) : 1;
      const unit = formatOrgMoney(row.unit_price, moneyPrefs, locale);
      const ext = formatOrgMoney(
        row.ext != null && row.ext !== '' ? row.ext : qty * num(row.unit_price),
        moneyPrefs,
        locale
      );
      return `${label} ×${qty} @ ${unit} = ${ext}`;
    });
  }
  return String(data.partsText || '')
    .split('\n')
    .map((line) => formatBarePartAmount(line, moneyPrefs, locale))
    .filter(Boolean);
}

/** Stored partsText is "Description: 10.00" with no currency. */
function formatBarePartAmount(
  line: string,
  moneyPrefs?: OrgMoneyPrefs | null,
  locale?: string | null
): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^(.*?):\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return trimmed;
  const label = match[1].trim();
  const amount = formatOrgMoney(match[2], moneyPrefs, locale);
  return label ? `${label}: ${amount}` : amount;
}

export function buildOwnedReportMessage(
  row: Record<string, unknown>,
  theme: CompanyTheme | null
): string {
  const printable = { ...row };
  delete printable.html;
  return buildServiceReportPrintHTML({
    ...printable,
    theme,
    themeScope: 'email',
  });
}

export function resendMessage(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string | null;
  replyTo?: string | null;
}): { from: string; to: string[]; subject: string; html: string; text?: string; reply_to?: string } {
  const message: { from: string; to: string[]; subject: string; html: string; text?: string; reply_to?: string } = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
  };
  const text = String(input.text || '').trim();
  if (text) message.text = text;
  const reply = String(input.replyTo || '').trim();
  if (isMailbox(reply)) message.reply_to = reply;
  return message;
}

/** Drop every mailbox that is not on the allow-list. An empty list drops them all. */
export function sanitizeMailResponse<T>(body: T, allowedEmails: string[]): T {
  const allowed = new Set(
    allowedEmails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)
  );
  return scrub(body) as T;

  function scrub(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replace(EMAIL_IN_TEXT, (match) => (allowed.has(match.toLowerCase()) ? match : ''));
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        out[key] = scrub(nested);
      }
      return out;
    }
    return value;
  }
}

export async function loadOwnedDocument(opts: {
  userClient: QueryClient;
  adminClient?: QueryClient | null;
  table: string;
  id: string | number;
  callerOrgId: unknown;
  narrowSelects?: readonly string[];
  /** When set, used instead of narrowSelects (invoice rows go through loadInvoiceRow). */
  readNarrow?: (client: QueryClient) => Promise<Record<string, unknown> | null>;
  notFoundError: string;
  forbiddenError: string;
}): Promise<OwnedDocumentResult> {
  const read = opts.readNarrow
    ? opts.readNarrow
    : (client: QueryClient) => loadNarrow(client, opts.table, opts.id, opts.narrowSelects || []);
  let row = await read(opts.userClient);
  if (!row && opts.adminClient) {
    row = await read(opts.adminClient);
  }
  if (!row) return { ok: false, status: 404, error: opts.notFoundError };
  if (!documentOwnedByOrganization(row, opts.callerOrgId)) {
    return { ok: false, status: 403, error: opts.forbiddenError };
  }
  const full =
    (await loadStar(opts.userClient, opts.table, opts.id)) ||
    (opts.adminClient ? await loadStar(opts.adminClient, opts.table, opts.id) : null);
  const merged = mergeOwned(row, full, opts.callerOrgId);
  if (!merged) return { ok: false, status: 403, error: opts.forbiddenError };
  return { ok: true, row: merged };
}

async function loadNarrow(
  client: QueryClient,
  table: string,
  id: string | number,
  selects: readonly string[]
): Promise<Record<string, unknown> | null> {
  for (const cols of selects) {
    try {
      const { data, error } = await client.from(table).select(cols).eq('id', id).maybeSingle();
      if (!error && data) return data as Record<string, unknown>;
      if (error && !COLUMN_MISSING.test(String(error.message || ''))) return null;
    } catch {
      return null;
    }
  }
  return null;
}

async function loadStar(
  client: QueryClient,
  table: string,
  id: string | number
): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeOwned(
  narrow: Record<string, unknown>,
  full: Record<string, unknown> | null,
  callerOrgId: unknown
): Record<string, unknown> | null {
  if (!full) return narrow;
  if (full.id != null && String(full.id) !== String(narrow.id)) return narrow;
  if (full.organization_id != null && !documentOwnedByOrganization(full, callerOrgId)) return null;
  const merged: Record<string, unknown> = { ...narrow };
  for (const [key, value] of Object.entries(full)) {
    if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDocDate(value: unknown, timeZone?: string | null): string {
  const zone = String(timeZone || '').trim() || DEFAULT_ORG_TIMEZONE;
  return formatDateInTimeZone(value == null || value === '' ? new Date() : String(value), zone);
}
