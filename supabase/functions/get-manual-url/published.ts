/**
 * Unpublished catalog rows are not found.
 * A missing column (published undefined) stays visible so this function can
 * deploy before the manuals.published migration.
 *
 * Retry without the column only for Postgres undefined_column (42703) whose
 * message names that column as a word. 42702 (ambiguous) and 42501
 * (permission denied for column published) must not look like a missing column.
 */
export type ColumnError = {
  code?: string | null;
  message?: string | null;
} | null | undefined;

export function isMissingColumn(error: ColumnError, column: string): boolean {
  if (!error || error.code !== "42703") return false;
  const name = String(column || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  return new RegExp(`\\b${name}\\b`).test(String(error.message || ""));
}

export function isPublishedColumnMissing(error: ColumnError): boolean {
  return isMissingColumn(error, "published");
}

export function isUnpublishedManual(row: { published?: unknown } | null | undefined): boolean {
  return !!row && row.published === false;
}

export function unpublishedManualDenial(
  row: { published?: unknown } | null | undefined,
): { status: 404; error: "not_found" } | null {
  if (!isUnpublishedManual(row)) return null;
  return { status: 404, error: "not_found" };
}
