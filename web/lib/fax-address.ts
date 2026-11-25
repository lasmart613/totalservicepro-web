/**
 * Optional fax and street line 2.
 *
 * Fax uses the same shape as a directory phone (register-directory-org
 * phoneOk): digits, spaces, and phone punctuation, optional extension,
 * 7–20 digits, at most 50 characters (the shop-customer phone cap).
 * Address line 2 is a suite / unit / floor, capped at 200 characters
 * (the directory street cap). Both are optional and stored null when blank.
 *
 * Display: line 2 is its own line under the street and is omitted when
 * empty. Fax is "Fax: …" only when present.
 */

export const FAX_MAX = 50;
export const ADDRESS_LINE2_MAX = 200;

const PHONE_SHAPE = /^[0-9+().\-\s]+(\s*(x|ext\.?)\s*\d{1,6})?$/i;

export type PostalParts = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Blank → null. Otherwise the trimmed fax, or null when it is not a phone. */
export function normalizeFax(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (!faxLooksValid(raw)) return null;
  return raw.slice(0, FAX_MAX);
}

export function faxLooksValid(value: unknown): boolean {
  const raw = text(value);
  if (!raw || raw.length > FAX_MAX) return false;
  const digits = raw.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 20 && PHONE_SHAPE.test(raw);
}

/** Empty when blank. A message when the user typed something that is not a phone. */
export function faxFieldError(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (faxLooksValid(raw)) return null;
  return 'Fax must look like a phone number (7–20 digits).';
}

/** Blank → null. Longer than the cap → null so the caller can show addressLine2FieldError. */
export function normalizeAddressLine2(value: unknown): string | null {
  const raw = text(value);
  if (!raw || raw.length > ADDRESS_LINE2_MAX) return null;
  return raw;
}

export function addressLine2FieldError(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (raw.length <= ADDRESS_LINE2_MAX) return null;
  return `Address line 2 is too long (max ${ADDRESS_LINE2_MAX} characters).`;
}

/** First friendly error for an optional fax and address line 2, or null when both are blank or valid. */
export function optionalContactError(fields: { fax?: unknown; address_line2?: unknown }): string | null {
  return faxFieldError(fields.fax) || addressLine2FieldError(fields.address_line2);
}

/** Normalized values. Invalid input becomes null; call optionalContactError first to refuse it. */
export function optionalContactValues(fields: { fax?: unknown; address_line2?: unknown }): {
  fax: string | null;
  address_line2: string | null;
} {
  return {
    fax: normalizeFax(fields.fax),
    address_line2: normalizeAddressLine2(fields.address_line2),
  };
}

/**
 * Validate fax and address line 2 already copied onto an org-profile payload.
 * Writes the normalized value back. Keys the client did not send are left alone.
 */
export function orgProfileContactPatch(
  payload: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if ('fax' in payload) {
    const err = faxFieldError(payload.fax);
    if (err) return { ok: false, error: err };
    payload.fax = normalizeFax(payload.fax);
  }
  if ('address_line2' in payload) {
    const err = addressLine2FieldError(payload.address_line2);
    if (err) return { ok: false, error: err };
    payload.address_line2 = normalizeAddressLine2(payload.address_line2);
  }
  return { ok: true };
}

function namedSchemaColumn(message: string): string | null {
  const postgrest = message.match(/Could not find the '([^']+)' column/i);
  if (postgrest) return postgrest[1];
  const postgres = message.match(/column "([^"]+)"/i);
  return postgres ? postgres[1] : null;
}

/** True when PostgREST or Postgres says fax or address_line2 is not on this database yet. */
export function missingFaxOrAddressLine2(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  if (!error) return false;
  const message = String(error.message || '');
  const named = namedSchemaColumn(message);
  if (named === 'fax' || named === 'address_line2') return true;
  const code = String(error.code || '');
  if ((code === '42703' || code === 'PGRST204') && /\b(fax|address_line2)\b/i.test(message)) return true;
  return /\b(fax|address_line2)\b/i.test(message) && /column|schema cache|does not exist/i.test(message);
}

/** Drop fax / address_line2 from a write when the error says that column is missing. */
export function stripMissingFaxAddress(
  payload: Record<string, unknown>,
  error: { message?: string; code?: string } | null | undefined
): boolean {
  if (!missingFaxOrAddressLine2(error)) return false;
  const message = String(error?.message || '');
  const named = namedSchemaColumn(message);
  if (named === 'fax' || named === 'address_line2') {
    if (!(named in payload)) return false;
    delete payload[named];
    return true;
  }
  let stripped = false;
  if (/\bfax\b/i.test(message) && 'fax' in payload) {
    delete payload.fax;
    stripped = true;
  }
  if (/\baddress_line2\b/i.test(message) && 'address_line2' in payload) {
    delete payload.address_line2;
    stripped = true;
  }
  return stripped;
}

/** "Fax: 555-0100", or "" when there is no fax. */
export function formatFaxLine(value: unknown): string {
  const fax = text(value);
  return fax ? `Fax: ${fax}` : '';
}

function locality(parts: PostalParts): string {
  const city = text(parts.city);
  const stateZip = [text(parts.state), text(parts.zip)].filter(Boolean).join(' ');
  return [city, stateZip].filter(Boolean).join(', ');
}

/**
 * Lines of a postal block. Line 2 is included only when it has text, and
 * it always sits directly under the street. With no line 2 the result is
 * the historical single line "Street, City, ST ZIP" so existing documents
 * stay on one line.
 */
export function formatPostalLines(parts: PostalParts | null | undefined): string[] {
  if (!parts) return [];
  const line1 = text(parts.line1);
  const line2 = text(parts.line2);
  const place = locality(parts);
  if (!line2) {
    const one = [line1, place].filter(Boolean).join(', ');
    return one ? [one] : [];
  }
  return [line1, line2, place].filter(Boolean);
}

export function formatPostalText(parts: PostalParts | null | undefined): string {
  return formatPostalLines(parts).join('\n');
}

/** One string for a maps query. Line breaks become commas. */
export function formatPostalQuery(parts: PostalParts | null | undefined): string {
  return formatPostalLines(parts).join(', ');
}
