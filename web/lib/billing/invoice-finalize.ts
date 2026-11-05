/**
 * Finalize of a new invoice saves twice before React re-renders:
 * a draft insert, then the send, then a status update to sent.
 *
 * The URL id is applied with history.replaceState, so the form still looks
 * unsaved on the second save. Allocating again consumes the next number and
 * leaves the first one unused. The send body was also reading the empty
 * docNumber state from the render that started Finalize.
 *
 * The send route does not write sent_at. Finalize & Email and Mark sent
 * both finish in the form save, which stamps the service_invoices.sent_at
 * column (migration 000955). That file is repo-only until Larry and the CEO
 * approve applying it. Do not store the stamp under invoice_data.sent_at.
 */

export function heldInvoiceNumber(preferred: unknown, fallback: unknown): string {
  for (const value of [preferred, fallback]) {
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (!trimmed || /^draft$/i.test(trimmed)) continue;
    return trimmed;
  }
  return '';
}

type InvoiceNumberClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string | number
      ) => {
        maybeSingle: () => Promise<{ data?: { invoice_number?: unknown } | null; error?: unknown }>;
      };
    };
  };
};

/** Number stored on the row after insert. Blank when the read fails. */
export async function readStoredInvoiceNumber(
  client: InvoiceNumberClient,
  id: string | number
): Promise<string> {
  try {
    const { data, error } = await client
      .from('service_invoices')
      .select('invoice_number')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return '';
    return heldInvoiceNumber(data.invoice_number, '');
  } catch {
    return '';
  }
}

/**
 * Stamp the service_invoices.sent_at column when this save marks the invoice sent.
 * Other saves omit the column so a draft write cannot clear it.
 * 000955 adds the nullable column. Until it is applied, PostgREST rejects
 * sent_at and the schema retry omits that one missing column.
 */
export function invoiceSentStamp(opts: {
  requestedStatus: unknown;
  stampSent?: boolean;
  now: string;
}): { sent_at: string } | Record<string, never> {
  if (!opts.stampSent) return {};
  if (String(opts.requestedStatus ?? '').trim().toLowerCase() !== 'sent') return {};
  const now = String(opts.now || '').trim();
  if (!now) return {};
  return { sent_at: now };
}

/**
 * The provider error used to replace the notice, so a failed send showed
 * only the Resend message. The notice stays in front of that detail.
 */
export function invoiceEmailFailureNotice(notice: string, error?: string | null): string {
  const base = String(notice || '').trim() || 'Email was not sent.';
  const detail = String(error || '').trim();
  if (!detail || detail === base || base.includes(detail)) return base;
  if (/email was not sent/i.test(detail)) return detail;
  return `${base} ${detail}`;
}
