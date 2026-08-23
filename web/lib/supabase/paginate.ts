/**
 * Range-page through a Supabase query until a short page is returned.
 * Page size is only a fetch chunk — never a silent max result cap.
 */

export const SUPABASE_PAGE_SIZE = 200;

export type PageError = { message?: string } | null;

export type PageResult<T> = {
  data: T[] | null;
  error: PageError;
};

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>,
  pageSize: number = SUPABASE_PAGE_SIZE
): Promise<{ data: T[]; error: PageError }> {
  if (!Number.isFinite(pageSize) || pageSize < 1) {
    throw new Error('pageSize must be a positive number');
  }

  const all: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
    from += pageSize;
  }
}

export function chunkIds<T>(ids: T[], chunkSize: number = SUPABASE_PAGE_SIZE): T[][] {
  if (!Number.isFinite(chunkSize) || chunkSize < 1) {
    throw new Error('chunkSize must be a positive number');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}

export function uniqueLinkedIds(
  rows: Array<{ customer_organization_id?: string | number | null } | null> | null | undefined
): Array<string | number> {
  return Array.from(
    new Set(
      (rows || [])
        .map((r) => r?.customer_organization_id)
        .filter((id): id is string | number => id != null)
    )
  );
}
