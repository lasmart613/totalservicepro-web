/**
 * Chunked manual_search_index writes (migration 000918) leave a marker row in
 * manual_search_index_pending until every chunk is in. While it exists the
 * manual's index rows are partial and readers must treat it as not indexed.
 *
 * Returns the ids (of those asked) with a write in progress. A missing marker
 * table (000918 not applied yet) means none. null means the marker could not
 * be read; callers then hide the index rather than serve partial text.
 */
export async function pendingIndexIds(
  db: { from: (table: string) => any },
  ids: number[],
): Promise<Set<number> | null> {
  const out = new Set<number>();
  if (!ids.length) return out;
  try {
    const base = db.from("manual_search_index_pending").select("manual_id");
    const res = await (ids.length === 1 ? base.eq("manual_id", ids[0]) : base.in("manual_id", ids));
    if (res?.error) {
      const text = `${res.error.code || ""} ${res.error.message || ""}`;
      return /PGRST205|42P01|schema cache|does not exist/i.test(text) ? out : null;
    }
    for (const row of Array.isArray(res?.data) ? res.data : []) {
      const id = Number(row?.manual_id);
      if (id > 0 && ids.includes(id)) out.add(id);
    }
    return out;
  } catch {
    return null;
  }
}

/** True while a write is in progress for this manual, or when unknown. */
export async function indexWriteInProgress(
  db: { from: (table: string) => any },
  id: number,
): Promise<boolean> {
  const pending = await pendingIndexIds(db, [id]);
  return !pending || pending.has(id);
}
