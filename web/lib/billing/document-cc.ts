/**
 * CC addresses typed on a document send. The primary To recipient is chosen
 * by the existing owned-document rules. This only reads the cc field.
 */

export const MAX_DOCUMENT_CC = 10;

const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_CC = 'Enter valid CC email addresses, separated by commas.';
const TOO_MANY_CC = 'CC is limited to 10 addresses.';

export type ParsedDocumentCc =
  | { ok: true; emails: string[] }
  | { ok: false; error: string };

function ccTokens(value: unknown): string[] | null {
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const text = item.trim();
    if (!text) continue;
    if (/[,;\n]/.test(text)) {
      out.push(
        ...text
          .split(/[,;\n]+/)
          .map((part) => part.trim())
          .filter(Boolean)
      );
    } else {
      out.push(text);
    }
  }
  return out;
}

function parseCcValue(value: unknown): ParsedDocumentCc {
  const parts = ccTokens(value);
  if (!parts) return { ok: false, error: INVALID_CC };
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.length > 254 || !MAILBOX.test(part)) return { ok: false, error: INVALID_CC };
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(part);
    if (emails.length > MAX_DOCUMENT_CC) return { ok: false, error: TOO_MANY_CC };
  }
  return { ok: true, emails };
}

/**
 * Accepts a send-request body (reads only `cc`) or a raw string / array.
 * A missing cc is zero addresses. Invalid addresses fail the whole list.
 */
export function parseDocumentCc(body: unknown): ParsedDocumentCc {
  if (typeof body === 'string' || Array.isArray(body) || body == null) return parseCcValue(body);
  if (typeof body !== 'object') return { ok: false, error: INVALID_CC };
  const record = body as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'cc') || record.cc == null || record.cc === '') {
    return { ok: true, emails: [] };
  }
  return parseCcValue(record.cc);
}

/** Field-level message. Names the first bad address for the person typing it. */
export function documentCcInputError(raw: string): string | null {
  const parts = raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (part.length > 254 || !MAILBOX.test(part)) {
      return `Invalid CC email: ${part.slice(0, 80)}`;
    }
  }
  const parsed = parseCcValue(raw);
  return parsed.ok ? null : parsed.error;
}

/** Addresses to show again in the CC field. */
export function formatCcInput(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'string') return value;
  return '';
}

/**
 * Value stored on the document JSON. A validated override wins. An invalid
 * draft string is kept so Save Draft does not throw away what was typed.
 */
export function ccValueForDocumentSave(text: string, override?: string[]): string[] | string {
  if (override) return override;
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = parseCcValue(trimmed);
  return parsed.ok ? parsed.emails : trimmed;
}

/** Drop the primary To mailbox. CC must not replace or repeat it. */
export function ccBesidesRecipient(emails: string[], recipient: string): string[] {
  const to = recipient.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of emails) {
    const trimmed = email.trim();
    const key = trimmed.toLowerCase();
    if (!key || key === to || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function asDocumentData(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function mergeCcIntoDocumentData(existing: unknown, cc: string[]): Record<string, unknown> {
  return { ...asDocumentData(existing), cc_emails: cc };
}

type CcWriter = { from: (table: string) => any };

/**
 * Store the CC list actually used on this send inside the document JSON.
 * Updates only that JSON column. Does not change status, totals, or sent_at.
 */
export async function rememberDocumentCc(opts: {
  client: CcWriter;
  table: string;
  id: string | number;
  dataKey: 'invoice_data' | 'estimate_data' | 'po_data';
  cc: string[];
  organizationId?: string | number | null;
}): Promise<void> {
  if (!opts.cc.length) return;
  try {
    const read = await opts.client.from(opts.table).select(opts.dataKey).eq('id', opts.id).maybeSingle();
    if (read?.error || !read?.data) return;
    const next = mergeCcIntoDocumentData(read.data[opts.dataKey], opts.cc);
    let query = opts.client.from(opts.table).update({ [opts.dataKey]: next }).eq('id', opts.id);
    if (opts.organizationId != null && String(opts.organizationId).trim() !== '') {
      query = query.eq('organization_id', opts.organizationId);
    }
    const wrote = await query;
    if (wrote?.error) console.warn('could not store document cc', wrote.error.message || 'update failed');
  } catch (e) {
    const message = e instanceof Error ? e.message : 'could not store document cc';
    console.warn('could not store document cc', message);
  }
}
