/**
 * public.manuals.published. Default true. Readers skip false.
 * A missing column means every existing row is published, so callers retry
 * without the filter instead of failing the library.
 */

export {
  isUnpublishedManual,
  unpublishedManualDenial,
} from '../../supabase/functions/get-manual-url/published.ts';

export function isPublishedColumnMissing(message?: string | null): boolean {
  const msg = String(message || '');
  return /published/i.test(msg) && /schema cache|column|does not exist|PGRST204/i.test(msg);
}

export function filterPublishedManuals<T extends { published?: unknown }>(
  rows: readonly T[] | null | undefined,
): T[] {
  return (rows || []).filter((row) => row?.published !== false);
}

export function wherePublished<Q extends { eq: (column: string, value: boolean) => Q }>(
  query: Q,
  enabled = true,
): Q {
  return enabled ? query.eq('published', true) : query;
}

export function parseManualPublishedToggle(
  body: unknown,
): { ok: true; id: number; published: boolean } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Missing manual id' };
  const raw = body as { id?: unknown; manual_id?: unknown; manualId?: unknown; published?: unknown };
  const id = Number(raw.id ?? raw.manual_id ?? raw.manualId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Missing manual id' };
  if (typeof raw.published !== 'boolean') return { ok: false, error: 'published must be true or false' };
  return { ok: true, id, published: raw.published };
}
