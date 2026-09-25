import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { asManualCatalogId, reindexManualPageRange } from '@/lib/manual-search-index';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/god/manuals/reindex-one
 * God-only. Rebuild manual_search_index for one manuals.id from physical PDF
 * pages. Reads the private `manuals` bucket with the service role and upserts
 * only that manual's row. Idempotent: the same pageFrom/pageCount writes the
 * same stamps. Chunked so a 161-page book cannot sit in one long extraction.
 *
 * Does not upload or stamp a collection attachment. Only manual_search_index changes.
 *
 * Manual 17 (Candela CO2RE, 161 pages) — do not use Index this manual; that
 * route times out on a large PDF and can keep the old unstamped text.
 *
 * Repeat until done is true (pageCount max 40):
 *   curl -X POST "$ORIGIN/api/god/manuals/reindex-one" \
 *     -H "Authorization: Bearer $GOD_ACCESS_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"manualId":17,"pageFrom":1,"pageCount":40}'
 * Then send pageFrom = nextPage (41, 81, 121, 161) until {"done":true}.
 *
 * God UI: /admin/god/manuals → catalog id 17 → Reindex pages (no Grok).
 */
export async function POST(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    manualId?: unknown;
    manual_id?: unknown;
    pageFrom?: unknown;
    pageCount?: unknown;
  };
  const manualId = asManualCatalogId(body.manualId ?? body.manual_id);
  if (manualId == null) {
    return NextResponse.json({ error: 'manualId is required' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: manual, error } = await admin
    .from('manuals')
    .select('id, storage_path, is_folder, chapter_metadata, entry_file_path')
    .eq('id', manualId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message || 'Could not load manual' }, { status: 400 });
  }
  if (!manual) {
    return NextResponse.json({ error: `Manual ${manualId} not found` }, { status: 404 });
  }

  const result = await reindexManualPageRange(admin, manual, {
    pageFrom: Number(body.pageFrom) || 1,
    pageCount: Number(body.pageCount) || 40,
  });
  if (!result.ok) {
    const status = result.error === 'no_pdf_path' || result.error === 'no_pdf' ? 404 : 400;
    return NextResponse.json({ ...result, error: result.error || 'Reindex failed' }, { status });
  }
  return NextResponse.json(result);
}
