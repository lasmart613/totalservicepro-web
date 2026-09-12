import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { parseManualCatalogInsert } from '@/lib/manual-catalog-admin';
import { EQUIPMENT_CATALOG } from '@/lib/equipment-catalog';
import { indexManualSearchText } from '@/lib/manual-search-index';

export const dynamic = 'force-dynamic';

/**
 * POST /api/god/manuals
 * Larry-only catalog row. PDFs stay in the `manuals` Storage bucket —
 * this writes brand / model / equipment_type / storage_path only.
 */
export async function POST(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseManualCatalogInsert(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const payload = {
    brand: parsed.row.brand,
    model: parsed.row.model,
    title: parsed.row.title,
    storage_path: parsed.row.storage_path,
    doc_kind: parsed.row.doc_kind,
    equipment_type: parsed.row.equipment_type,
    is_incomplete: parsed.row.is_incomplete,
  };

  let { data, error } = await admin.from('manuals').insert(payload).select('id, title').maybeSingle();
  if (error && /equipment_type|is_incomplete|schema cache|column/i.test(error.message || '')) {
    const { equipment_type: _type, is_incomplete: _inc, ...legacy } = payload;
    const retry = await admin.from('manuals').insert(legacy).select('id, title').maybeSingle();
    data = retry.data;
    error = retry.error;
  }
  if (error) {
    return NextResponse.json({ error: error.message || 'Could not add catalog row' }, { status: 400 });
  }

  let indexed: { ok: boolean; chars?: number; skipped?: string } | null = null;
  if (data?.id != null) {
    try {
      const result = await indexManualSearchText(admin, {
        id: data.id,
        storage_path: parsed.row.storage_path,
      });
      indexed = { ok: result.ok, chars: result.chars, skipped: result.skipped };
    } catch {
      indexed = { ok: false, skipped: 'index_failed' };
    }
  }

  return NextResponse.json({ ok: true, manual: data, catalog: payload, indexed });
}

export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  return NextResponse.json({
    ok: true,
    catalog: EQUIPMENT_CATALOG,
  });
}
