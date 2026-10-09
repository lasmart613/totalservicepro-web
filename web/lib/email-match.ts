/**
 * Email identity for invite, claim, and profile lookups.
 * Trim, then lowercase. Comparisons and queries use this key.
 */

/** Lookup key. Empty stays empty. */
export function normalizeLookupEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Pattern for PostgREST `.ilike(column, pattern)` that matches the whole value
 * for `%`, `_`, and `\`. PostgreSQL ILIKE treats those as wildcards or the escape.
 *
 * Do not use this for exact email identity. PostgREST rewrites every `*` in an
 * ilike/like value to `%` (`T.map` in pgFmtFilter) and has no escape: `\*`
 * becomes a literal percent, not a literal asterisk. Exact email filters use
 * `exactEmailImatch`.
 */
export function ilikeExact(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Normalized email, escaped for `%`, `_`, and `\`. Still not safe for `*`. */
export function exactEmailIlike(value: unknown): string {
  return ilikeExact(normalizeLookupEmail(value));
}

/**
 * Anchored POSIX pattern for PostgREST `.filter(column, 'imatch', pattern)`.
 * `imatch` is `~*` and does not rewrite `*`. The pattern is case-insensitive
 * and matches the whole value only.
 *
 * Simple filters are `column=operator.value` (the value is the rest after the
 * first dot), so `,`, `(`, `)`, and `.` do not need PostgREST quoting there.
 * Exact-email callers do not use `.or()` or `in.()`, where those characters
 * split the grammar. `.` is still escaped because it is a regex wildcard.
 */
const REGEX_META = /[\\.^$|*+?()[\]{}]/g;

export function exactEmailImatch(value: unknown): string {
  const email = normalizeLookupEmail(value);
  return `^${email.replace(REGEX_META, '\\$&')}$`;
}

/** True when both sides are non-empty and equal after trim + lowercase. */
export function emailsMatch(a: unknown, b: unknown): boolean {
  const left = normalizeLookupEmail(a);
  const right = normalizeLookupEmail(b);
  return left.length > 0 && left === right;
}
