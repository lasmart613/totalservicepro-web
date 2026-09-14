/**
 * 3-character organization ticket_prefix allocator.
 *
 * Mirrors live Supabase `public.set_org_ticket_prefix` (see
 * `web/supabase/migrations/20260914_000001_fix_org_ticket_prefix_char3.sql`).
 * The DB trigger is the source of truth on insert; this module exists so tests
 * can prove the scheme never emits more than 3 characters.
 *
 * Live column is `organizations.ticket_prefix character(3)` — do not widen.
 *
 * Scheme after the mnemonic (e.g. SHO) is taken:
 *   1. stem (first 2 letters) + 0-9 then A-Z  → SH0…SH9, SHA…SHZ
 *   2. MD5-derived 3-char codes from [0-9A-Z] until unique
 */
import { createHash } from 'node:crypto';

export const TICKET_PREFIX_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const TICKET_PREFIX_FALLBACK = 'TSP';
export const TICKET_PREFIX_LEN = 3;
export const TICKET_PREFIX_HASH_ATTEMPTS = 64;

export function normalizeTicketPrefix(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** First 3 letters of the org name, padded to CHAR(3). Letters only (live trigger). */
export function mnemonicTicketPrefix(name?: string | null): string {
  const letters = String(name || '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
  if (letters.length >= TICKET_PREFIX_LEN) return letters.slice(0, TICKET_PREFIX_LEN);
  if (letters.length === 2) return `${letters}X`;
  if (letters.length === 1) return `${letters}XX`;
  return TICKET_PREFIX_FALLBACK;
}

export function hashedTicketPrefix(
  name: string | null | undefined,
  id: string | number | null | undefined,
  attempt: number
): string {
  const key = `${name || ''}|${id == null ? '' : String(id)}|${attempt}`;
  const bytes = createHash('md5').update(key, 'utf8').digest();
  let out = '';
  for (let j = 0; j < TICKET_PREFIX_LEN; j++) {
    out += TICKET_PREFIX_ALPHABET[bytes[j] % TICKET_PREFIX_ALPHABET.length];
  }
  return out;
}

function takenSet(taken: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const raw of taken) {
    const p = normalizeTicketPrefix(raw);
    if (p) set.add(p);
  }
  return set;
}

/**
 * Next unused 3-char prefix for `name` given already-taken prefixes.
 * Never returns a string longer than 3 characters.
 */
export function allocateTicketPrefix(
  name: string | null | undefined,
  taken: Iterable<string>,
  opts?: { id?: string | number | null }
): string {
  const used = takenSet(taken);
  const mnemonic = mnemonicTicketPrefix(name);
  if (!used.has(mnemonic)) return mnemonic;

  const stem = mnemonic.slice(0, 2);
  for (const ch of TICKET_PREFIX_ALPHABET) {
    const candidate = `${stem}${ch}`;
    if (!used.has(candidate)) return candidate;
  }

  for (let i = 1; i <= TICKET_PREFIX_HASH_ATTEMPTS; i++) {
    const candidate = hashedTicketPrefix(name, opts?.id ?? null, i);
    if (!used.has(candidate)) return candidate;
  }

  throw new Error('Could not allocate a unique 3-character ticket_prefix');
}

/**
 * Pre-fix live trigger: first 3 letters, then stem + 1, 2, 3… (SH10 is 4 chars).
 * Kept only to document the production failure mode.
 */
export function allocateTicketPrefixBrokenChar3(
  name: string | null | undefined,
  taken: Iterable<string>
): string {
  const used = takenSet(taken);
  const base = String(name || '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 3);
  let finalPrefix = base;
  let counter = 0;
  while (used.has(finalPrefix)) {
    counter += 1;
    finalPrefix = `${base.slice(0, 2)}${counter}`;
  }
  return finalPrefix;
}
