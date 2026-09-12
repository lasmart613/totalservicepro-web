import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { indexManualSearchText, MANUAL_REINDEX_BATCH } from '@/lib/manual-search-index';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/god/manuals/reindex
 * Larry-only: extract PDF text from the manuals bucket into manual_search_index.
 * Call repeatedly until remaining is 0. Does not change ownership or viewer auth.
 */
export async function POST(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    limit?: unknown;
    force?: unknown;
  };
  const limit = Math.min(12, Math.max(1, Number(body.limit) || MANUAL_REINDEX_BATCH));
  const force = body.force === true || body.force === '1';

  const admin = getSupabaseAdmin();
  const { data: manuals, error: manErr } = await fetchAllPages<Record<string, unknown>>(
    async (from, to) =>
      admin
        .from('manuals')
        .select('id, storage_path, is_folder, chapter_metadata')
        .order('brand')
        .order('title')
        .range(from, to)
  );
  if (manErr) {
    return NextResponse.json({ error: manErr.message || 'Could not list manuals' }, { status: 400 });
  }

  const { data: indexedRows } = await admin.from('manual_search_index').select('manual_id');
  const indexed = new Set(
    (indexedRows || []).map((row: { manual_id?: unknown }) => String(row.manual_id || '').trim())
  );

  const pending = (manuals || []).filter((m) => force || !indexed.has(String(m.id)));
  const batch = pending.slice(0, limit);
  const results = [];
  for (const manual of batch) {
    results.push(await indexManualSearchText(admin, manual));
  }

  const indexedOk = results.filter((r) => r.ok).length;
  const remaining = Math.max(0, pending.length - batch.length);

  return NextResponse.json({
    ok: true,
    processed: results.length,
    indexed: indexedOk,
    skipped: results.filter((r) => !r.ok).length,
    remaining,
    catalogCount: (manuals || []).length,
    alreadyIndexed: indexed.size,
    results,
  });
}
