// Incomplete manuals are free (Larry, 2026-10-22).
//
// A manual with manuals.is_incomplete = true (a truncated or partial PDF, the
// only copy we have) is free to view and never counts against a company's
// manual-library slots. Pure helpers shared by get-manual-url and the web app
// (web/lib/manual-incomplete.ts re-exports them) so both sides agree.

/** Same truthy set the web catalog and the Android asset accept. */
export function isIncompleteFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "t";
}

export function manualIsIncomplete(row: { is_incomplete?: unknown; isIncomplete?: unknown } | null | undefined): boolean {
  if (!row) return false;
  return isIncompleteFlag(row.is_incomplete ?? row.isIncomplete);
}

/**
 * Slots used by owned manuals: incomplete manuals are not counted.
 * `owned` is any iterable of rows that carry an is_incomplete flag.
 */
export function slotCountedManuals(
  owned: Iterable<{ is_incomplete?: unknown; isIncomplete?: unknown; incomplete?: unknown }>,
): number {
  let n = 0;
  for (const row of owned) {
    const inc = row && (row.incomplete === true || manualIsIncomplete(row));
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

const OPERATOR_KINDS = new Set(["operator", "user"]);

/**
 * May this caller open an incomplete manual they do not own, for free?
 * Fails closed:
 *  - the manual must be flagged is_incomplete (published is checked earlier);
 *  - the caller must be an active member of a company (orgId set);
 *  - service manuals need a service company (Repair AI access); owner-side
 *    orgs get the free view only for rows explicitly stored as operator/user
 *    manuals (doc_kind). Anything else still goes through Add to library,
 *    which is also free for incomplete manuals;
 *  - the requested storage path must be this manual's path or under it, so
 *    an incomplete manual id cannot unlock some other file.
 */
export function mayViewIncompleteFree(opts: {
  manual: { is_incomplete?: unknown; doc_kind?: unknown; storage_path?: unknown } | null | undefined;
  orgId: unknown;
  serviceCompany: boolean;
  requestedPath?: unknown;
}): boolean {
  const m = opts.manual;
  if (!m || !manualIsIncomplete(m)) return false;
  if (opts.orgId == null || String(opts.orgId).trim() === "") return false;
  if (!pathWithinManual(m.storage_path, opts.requestedPath)) return false;
  if (opts.serviceCompany) return true;
  return OPERATOR_KINDS.has(String(m.doc_kind ?? "").trim().toLowerCase());
}
