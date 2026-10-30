// Incomplete manuals are free to add (Larry, 2026-10-22; view rule tightened later).
//
// A manual with manuals.is_incomplete = true (a truncated or partial PDF, the
// only copy we have) never counts against a company's manual-library slots.
// It still has to be in the library before it can be opened. Pure helpers
// shared by get-manual-url and the web app (web/lib/manual-incomplete.ts
// re-exports them) so both sides agree.

/** Same truthy set the web catalog and the Android asset accept. */
export function isIncompleteFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "t";
}

export function manualIsIncomplete(row: { is_incomplete?: unknown; isIncomplete?: unknown } | null | undefined): boolean {
  if (!row) return false;
  return isIncompleteFlag(row.is_incomplete ?? row.isIncomplete);
}

/**
 * Free-at-add is sticky (000942 free_at_add, set by a DB trigger from
 * manuals.is_incomplete at insert time and immutable after). A library row is
 * free when it was added free OR its manual is incomplete now. So an admin
 * flipping a manual incomplete -> complete never pushes an org over its cap;
 * complete -> incomplete frees the slot. Missing column (pre-000942) = false.
 */
export function libraryRowIsFree(
  row: { free_at_add?: unknown } | null | undefined,
  manual: { is_incomplete?: unknown; isIncomplete?: unknown } | null | undefined,
): boolean {
  return (row != null && isIncompleteFlag(row.free_at_add)) || manualIsIncomplete(manual);
}

/**
 * Slots used by owned manuals: incomplete (or added-free) manuals are not counted.
 * `owned` is any iterable of rows that carry an is_incomplete flag.
 */
export function slotCountedManuals(
  owned: Iterable<{ is_incomplete?: unknown; isIncomplete?: unknown; incomplete?: unknown; free_at_add?: unknown }>,
): number {
  let n = 0;
  for (const row of owned) {
    const inc = row && (row.incomplete === true || isIncompleteFlag(row.free_at_add) || manualIsIncomplete(row));
    if (!inc) n += 1;
  }
  return n;
}

function clean(path: unknown): string {
  return String(path ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
}

/** requested is the manual's own path or a file/chapter under it. */
export function pathWithinManual(manualPath: unknown, requested: unknown): boolean {
  const m = clean(manualPath);
  const r = clean(requested);
  if (!m) return false;
  if (!r) return true;
  return r === m || r.startsWith(m + "/");
}

/**
 * Opening requires a library row for every manual, including incomplete ones.
 * Incomplete manuals are free to add and do not use a slot; they are not free
 * to open. Always false so a caller cannot treat the old free-view rule as a grant.
 */
export function mayViewIncompleteFree(_opts?: {
  manual?: { is_incomplete?: unknown; doc_kind?: unknown; storage_path?: unknown } | null;
  orgId?: unknown;
  serviceCompany?: boolean;
  requestedPath?: unknown;
}): boolean {
  void _opts;
  return false;
}
