/**
 * Unpublished catalog rows are not found.
 * A missing column (published undefined) stays visible so this function can
 * deploy before the manuals.published migration.
 */
export function isUnpublishedManual(row: { published?: unknown } | null | undefined): boolean {
  return !!row && row.published === false;
}

export function unpublishedManualDenial(
  row: { published?: unknown } | null | undefined,
): { status: 404; error: "not_found" } | null {
  if (!isUnpublishedManual(row)) return null;
  return { status: 404, error: "not_found" };
}
