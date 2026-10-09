/**
 * Email identity for invite, claim, and profile lookups.
 * Trim, then lowercase. Comparisons and queries use this key.
 */

/** Lookup key. Empty stays empty. */
export function normalizeLookupEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Pattern for PostgREST `.ilike(column, pattern)` that matches the whole value.
 * PostgreSQL ILIKE treats `%` and `_` as wildcards and `\` as the default escape.
 * Escaping those three keeps the match exact: no prefix, suffix, or substring.
 */
export function ilikeExact(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Normalized email, escaped so ILIKE cannot treat it as a pattern. */
export function exactEmailIlike(value: unknown): string {
  return ilikeExact(normalizeLookupEmail(value));
}

/** True when both sides are non-empty and equal after trim + lowercase. */
export function emailsMatch(a: unknown, b: unknown): boolean {
  const left = normalizeLookupEmail(a);
  const right = normalizeLookupEmail(b);
  return left.length > 0 && left === right;
}
