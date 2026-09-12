/**
 * Shared string helpers for manuals library search.
 * No Node APIs — safe to import from client components.
 */

export const MANUAL_SEARCH_TEXT_MAX = 200_000;

export function normalizeManualSearchText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clipManualSearchText(value: unknown, max = MANUAL_SEARCH_TEXT_MAX): string {
  return String(value ?? '')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, max);
}
