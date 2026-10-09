/**
 * Email identity for invite, claim, and profile lookups.
 * Trim, then lowercase. Comparisons and queries use this key.
 */

/** Lookup key. Empty stays empty. Trim, then lowercase. */
export function normalizeLookupText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Email lookup key. Same trim and lowercase as other exact text. */
export function normalizeLookupEmail(value: unknown): string {
  return normalizeLookupText(value);
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
function escapeRegexLiteral(value: string): string {
  return value.replace(/[\\.^$|*+?()[\]{}]/g, '\\$&');
}

/**
 * Anchored POSIX pattern for an exact, case-insensitive text match.
 * Trim, then lowercase, then escape regex metacharacters including `*`.
 * `%` and `_` are not wildcards in `~*`.
 */
export function exactTextImatch(value: unknown): string {
  return `^${escapeRegexLiteral(normalizeLookupText(value))}$`;
}

/**
 * Unanchored POSIX pattern for a literal substring (`imatch` / `~*`).
 * Does not trim or lowercase; `~*` is already case-insensitive.
 * Use this for contains-search instead of ILIKE when the text is user input,
 * because PostgREST rewrites `*` to `%` inside `ilike` and has no escape.
 */
export function containsTextImatch(value: unknown): string {
  return escapeRegexLiteral(String(value ?? ''));
}

/** True when both sides are non-empty and equal after trim + lowercase. */
export function textsMatchCaseInsensitive(a: unknown, b: unknown): boolean {
  const left = normalizeLookupText(a);
  const right = normalizeLookupText(b);
  return left.length > 0 && left === right;
}

export function exactEmailImatch(value: unknown): string {
  return exactTextImatch(value);
}

/** True when both sides are non-empty and equal after trim + lowercase. */
export function emailsMatch(a: unknown, b: unknown): boolean {
  return textsMatchCaseInsensitive(a, b);
}
