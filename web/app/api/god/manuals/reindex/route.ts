import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { asManualCatalogId, indexManualSearchText, MANUAL_REINDEX_BATCH } from '@/lib/manual-search-index';
import { grokAssistantUrl } from '@/lib/ai/xai-collection';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/god/manuals/reindex
 * Larry-only: extract PDF text from the manuals bucket into manual_search_index.
 * Incomplete PDFs (is_incomplete) are still indexed when storage_path is valid.
 * Pass { manualId: 721 } to target one catalog row. Call repeatedly until remaining is 0.
 * Pass { attachCollection: true, manualId } to upload that PDF into the shared Grok
 * collection and stamp manuals.xai_collection_id (Larry-only; proxies grok-assistant).
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
    manualId?: unknown;
    manual_id?: unknown;
    attachCollection?: unknown;
  };
  const targetId = asManualCatalogId(body.manualId ?? body.manual_id);
  const attachCollection = body.attachCollection === true || body.attachCollection === '1';
  const limit = Math.min(12, Math.max(1, Number(body.limit) || (targetId != null ? 1 : MANUAL_REINDEX_BATCH)));
  const force = body.force === true || body.force === '1' || targetId != null;

  const admin = getSupabaseAdmin();
  const { data: manuals, error: manErr } = await fetchAllPages<Record<string, unknown>>(
    async (from, to) =>
      admin
        .from('manuals')
        .select('id, storage_path, is_folder, chapter_metadata, is_incomplete')
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

  const catalog = manuals || [];
  if (targetId != null && !catalog.some((m) => asManualCatalogId(m.id) === targetId)) {
    return NextResponse.json({ error: `Manual ${targetId} not found` }, { status: 404 });
  }

  const pending = catalog.filter((m) => {
    const id = asManualCatalogId(m.id);
    if (targetId != null) return id === targetId;
    return force || !indexed.has(String(m.id));
  });
  const batch = pending.slice(0, limit);
  const results = [];
  for (const manual of batch) {
    results.push(await indexManualSearchText(admin, manual));
  }

  const indexedOk = results.filter((r) => r.ok).length;
  const remaining = Math.max(0, pending.length - batch.length);

  let collection: Record<string, unknown> | null = null;
  if (attachCollection && targetId != null) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const fnUrl = grokAssistantUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
    );
    if (!fnUrl || !token) {
      collection = { ok: false, skipped: 'grok_assistant_proxy_unavailable' };
    } else {
      const attachRes = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'attach-collection', manualId: targetId }),
      });
      collection = (await attachRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!attachRes.ok) {
        collection = {
          ok: false,
          skipped: 'grok_assistant_attach_failed',
          status: attachRes.status,
          ...collection,
        };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    indexed: indexedOk,
    skipped: results.filter((r) => !r.ok).length,
    remaining,
    catalogCount: catalog.length,
    alreadyIndexed: indexed.size,
    manualId: targetId,
    results,
    collection,
  });
}
