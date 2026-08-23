/**
 * Page through PostgREST results until a short/empty page.
 *
 * Supabase/PostgREST silently truncates a single request (project max-rows,
 * often 500 or 1000). Callers must keep requesting the next range instead of
 * raising .limit() to another silent cap.
 */

export const SUPABASE_PAGE_SIZE = 500;

/** Chunk size for `.in('id', …)` so URL length and max-rows cannot hide rows. */
export const SUPABASE_IN_CHUNK_SIZE = 200;

export type PageError = { message?: string } | null;

export type PageResult<T> = {
  data: T[] | null;
  error: PageError;
};

export type FetchPage<T> = (from: number, to: number) => Promise<PageResult<T>> | PageResult<T>;

/**
 * Fetch every row by walking `.range(from, to)` until a page is shorter than
 * `pageSize`. `pageSize` is only the request window — not a result cap.
 */
export async function fetchAllPages<T>(
  fetchPage: FetchPage<T>,
  pageSize: number = SUPABASE_PAGE_SIZE
): Promise<{ data: T[]; error: PageError }> {
  if (pageSize < 1) {
    throw new Error('pageSize must be >= 1');
  }
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      return { data: all, error };
    }
    const page = data ?? [];
    all.push(...page);
    if (page.length < pageSize) {
      return { data: all, error: null };
    }
    from += pageSize;
  }
}

export function chunkIds<T>(ids: T[], chunkSize: number = SUPABASE_IN_CHUNK_SIZE): T[][] {
  if (chunkSize < 1) {
    throw new Error('chunkSize must be >= 1');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function fetchAllByIdChunks<T, Id>(
  ids: Id[],
  fetchChunk: (chunk: Id[]) => Promise<PageResult<T>> | PageResult<T>,
  chunkSize: number = SUPABASE_IN_CHUNK_SIZE
): Promise<{ data: T[]; error: PageError }> {
  const all: T[] = [];
  for (const chunk of chunkIds(ids, chunkSize)) {
    if (chunk.length === 0) continue;
    const { data, error } = await fetchChunk(chunk);
    if (error) {
      return { data: all, error };
    }
    all.push(...(data ?? []));
  }
  return { data: all, error: null };
}

export function uniqueIds<T>(ids: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of ids) {
    if (id == null) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}
