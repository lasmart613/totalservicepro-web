import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { requireCatalogUploadCaller, sameOrg } from '@/lib/marketplace/catalog-upload-auth';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/marketplace/uploads/:id
 * Batch + rows for the caller's organization only.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const gate = await requireCatalogUploadCaller(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const batchId = String(id || '').trim();
  if (!batchId) {
    return NextResponse.json({ error: 'Batch id required' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: batch, error } = await admin
    .from('marketplace_upload_batches')
    .select('*')
    .eq('id', batchId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!batch || !sameOrg(batch.organization_id, gate.caller.organizationId)) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
  }

  const { data: rows, error: rowErr } = await admin
    .from('marketplace_upload_rows')
    .select(
      'id, row_number, status, catalog_kind, sku, title, brand, model, condition, price, qty, description, category, photo_urls, error_message, marketplace_listing_id, created_at'
    )
    .eq('batch_id', batchId)
    .order('row_number', { ascending: true });

  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, batch, rows: rows || [] });
}
