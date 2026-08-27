/**
 * Postgres 22001: value too long for type character(n).
 * Shared omit/shorten/retry for every insert/update on Add Service Ticket → new customer.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type PgErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
} | string | null | undefined;

export function errorText(err: PgErrorLike): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return [err.message, err.details, err.hint, err.code].filter(Boolean).join(' ');
}

export function charLimitFromError(err?: PgErrorLike): number | null {
  const text = errorText(err);
  const m = text.match(/value too long for type character(?: varying)?\((\d+)\)/i)
    || text.match(/character(?: varying)?\s*\((\d+)\)/i);
  if (m) return Number(m[1]);
  // Live PostgREST sometimes puts 22001 on `code` with a generic message.
  if (/\b22001\b|value too long/i.test(text)) return 3;
  return null;
}

export function missingColumn(message?: PgErrorLike): string | null {
  return errorText(message).match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

export function valueExceedsCharLimit(val: unknown, limit: number): boolean {
  if (val == null) return false;
  if (typeof val === 'string') return val.length > limit;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).length > limit;
  if (Array.isArray(val)) {
    if (!val.length) return false;
    return val.some((item) => String(item).length > limit);
  }
  return false;
}

/** Fields we never drop — required identity on org / ticket rows. */
export const CHAR_OVERFLOW_KEEP = new Set([
  'name',
  'title',
  'id',
  'ticket_number',
  'customer_name',
  'organization_id',
  'service_organization_id',
  'customer_organization_id',
]);

const STRIP_FIRST = [
  'created_by',
  'assigned_to',
  'specialties',
  'zip',
  'postal_code',
  'country',
  'country_code',
  'currency',
  'phone',
  'customer_phone',
  'email',
  'customer_email',
  'website',
  'notes',
  'description',
  'contact_name',
  'logo_url',
  'address',
  'customer_address',
  'city',
  'customer_city',
  'biz_type',
  'facility_type',
  'state',
  'customer_state',
  'equipment_make',
  'equipment_model',
  'serial_number',
  'scheduled_time',
  'end_time',
  'service_date',
  'is_active',
  'updated_at',
  'priority',
  'status',
  'service_type',
  'ticket_prefix',
  'type',
] as const;

const SHORT_CODES: Record<string, Record<string, string>> = {
  priority: { low: 'Low', medium: 'Med', high: 'Hi', emergency: 'Emg' },
  status: {
    scheduled: 'Sch',
    'awaiting scheduling': 'Awa',
    'in progress': 'Inp',
    completed: 'Cpl',
    cancelled: 'Can',
    canceled: 'Can',
  },
  service_type: {
    repair: 'Rpr',
    pm: 'PM',
    install: 'Ins',
    calibration: 'Cal',
    training: 'Trn',
    other: 'Oth',
  },
};

/** 3-letter doc prefix from a business name — fits CHAR(3) ticket_prefix. */
export function shortTicketPrefix(name?: string | null): string {
  const p = String(name || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return p || 'CUS';
}

function shortenCodedField(col: string, val: unknown, limit: number): string | null {
  if (typeof val !== 'string') return null;
  const map = SHORT_CODES[col];
  if (map) {
    const hit = map[val.trim().toLowerCase()];
    if (hit && hit.length <= limit && hit !== val) return hit;
  }
  if (col === 'ticket_prefix') {
    const p = shortTicketPrefix(val);
    if (p.length <= limit && p !== val) return p;
  }
  return null;
}

/**
 * Shorten a coded field or omit the next overflowing value.
 * Never drops name / title / ticket_number / customer_name / org ids.
 */
export function stripOverflowingAddressFields(
  payload: Record<string, unknown>,
  limit: number
): string | null {
  for (const col of STRIP_FIRST) {
    if (!(col in payload)) continue;
    if (!valueExceedsCharLimit(payload[col], limit)) continue;
    const shorter = shortenCodedField(col, payload[col], limit);
    if (shorter) {
      payload[col] = shorter;
      return col;
    }
    delete payload[col];
    return col;
  }
  for (const [col, val] of Object.entries(payload)) {
    if (CHAR_OVERFLOW_KEEP.has(col)) continue;
    if (!valueExceedsCharLimit(val, limit)) continue;
    const shorter = shortenCodedField(col, val, limit);
    if (shorter) {
      payload[col] = shorter;
      return col;
    }
    delete payload[col];
    return col;
  }
  return null;
}

/**
 * When every sent value already fits character(n), the overflow is a DEFAULT or
 * BEFORE INSERT trigger (live country / ticket_prefix). Inject short codes.
 */
export function injectShortDefaults(payload: Record<string, unknown>): string | null {
  if (!('ticket_prefix' in payload)) {
    payload.ticket_prefix = shortTicketPrefix(
      typeof payload.name === 'string' ? payload.name : typeof payload.customer_name === 'string' ? payload.customer_name : ''
    );
    return 'ticket_prefix';
  }
  if (!('country' in payload)) {
    payload.country = 'USA';
    return 'country';
  }
  if (!('country_code' in payload)) {
    payload.country_code = 'US';
    return 'country_code';
  }
  if (!('currency' in payload)) {
    payload.currency = 'USD';
    return 'currency';
  }
  return null;
}

function replaceRecord(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

async function writeOmittingCharOverflow(
  run: (row: Record<string, unknown>) => Promise<{ data: any; error: any }>,
  table: string,
  payload: Record<string, unknown>,
  maxAttempts: number
): Promise<{ data: any; error: { message?: string; details?: string; code?: string } | null }> {
  const row = { ...payload };
  let lastError: { message?: string; details?: string; code?: string } | null = null;
  let data: any = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await run(row);
    if (!res.error) {
      replaceRecord(payload, row);
      return { data: res.data ?? null, error: null };
    }
    lastError = res.error;
    const col = missingColumn(res.error);
    if (col && col in row && !CHAR_OVERFLOW_KEEP.has(col)) {
      delete row[col];
      continue;
    }
    const limit = charLimitFromError(res.error);
    if (limit != null) {
      const changed = stripOverflowingAddressFields(row, limit);
      if (changed) {
        console.warn(`${table}.${changed} adjusted — value too long for character(${limit})`);
        continue;
      }
      const injected = injectShortDefaults(row);
      if (injected) {
        console.warn(`${table}.${injected} set to a CHAR(3)-safe default after 22001`);
        continue;
      }
    }
    break;
  }
  replaceRecord(payload, row);
  return { data, error: lastError };
}

export async function insertOmittingCharOverflow(
  supabase: SupabaseClient,
  table: string,
  payload: Record<string, unknown>,
  opts?: { select?: string; maxAttempts?: number }
): Promise<{ data: any; error: { message?: string; details?: string; code?: string } | null }> {
  return writeOmittingCharOverflow(
    async (row) => {
      let q = supabase.from(table).insert(row);
      if (opts?.select) q = q.select(opts.select).single();
      return q;
    },
    table,
    payload,
    opts?.maxAttempts ?? 16
  );
}

export async function updateOmittingCharOverflow(
  supabase: SupabaseClient,
  table: string,
  payload: Record<string, unknown>,
  match: { column: string; value: unknown },
  opts?: { maxAttempts?: number }
): Promise<{ data: any; error: { message?: string; details?: string; code?: string } | null }> {
  return writeOmittingCharOverflow(
    async (row) => supabase.from(table).update(row).eq(match.column, match.value),
    table,
    payload,
    opts?.maxAttempts ?? 16
  );
}
