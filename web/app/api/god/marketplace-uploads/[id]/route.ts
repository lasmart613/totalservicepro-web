import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import {
  countRowOutcomes,
  normalizeCatalogStatus,
  normalizeRowStatus,
  rollupBatchStatus,
} from '@/lib/marketplace/catalog-upload';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

type RowPatch = {
  id?: unknown;
  row_number?: unknown;
  status?: unknown;
  marketplace_listing_id?: unknown;
  marketplace_item_id?: unknown;
  error_message?: unknown;
  error?: unknown;
};

/**
 * GET /api/god/marketplace-uploads/:id
 * Batch + all staged rows. God only.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  const { id } = await ctx.params;
  const batchId = String(id || '').trim();
  const admin = getSupabaseAdmin();
  const { data: batch, error } = await admin
    .from('marketplace_upload_batches')
    .select('*')
    .eq('id', batchId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });

  const { data: rows, error: rowErr } = await admin
    .from('marketplace_upload_rows')
    .select('*')
    .eq('batch_id', batchId)
    .order('row_number', { ascending: true });
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, god: true, batch, rows: rows || [] });
}

/**
 * PATCH /api/god/marketplace-uploads/:id
 * Agent marks rows listed / error (aliases imported / failed) and attaches
 * marketplace_listing_id. Batch status rolls up unless explicitly set.
 *
 * Body: {
 *   status?: 'pending'|'processing'|'listed'|'error'|'partial',
 *   notes?: string,
 *   rows?: [{ id?|row_number?, status, marketplace_listing_id?, error_message? }]
 * }
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  const { id } = await ctx.params;
  const batchId = String(id || '').trim();
  const body = (await req.json().catch(() => ({}))) as {
    status?: unknown;
    notes?: unknown;
    rows?: RowPatch[];
  };

  const admin = getSupabaseAdmin();
  const { data: batch, error } = await admin
    .from('marketplace_upload_batches')
    .select('*')
    .eq('id', batchId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });

  const { data: existingRows, error: loadErr } = await admin
    .from('marketplace_upload_rows')
    .select('id, row_number, status, marketplace_listing_id')
    .eq('batch_id', batchId);
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });

  const byId = new Map((existingRows || []).map((r) => [String(r.id), r]));
  const byNum = new Map((existingRows || []).map((r) => [Number(r.row_number), r]));
  const now = new Date().toISOString();
  let updatedRows = 0;

  for (const patch of Array.isArray(body.rows) ? body.rows : []) {
    const current =
      (patch.id != null && byId.get(String(patch.id))) ||
      (patch.row_number != null && byNum.get(Number(patch.row_number))) ||
      null;
    if (!current) {
      return NextResponse.json(
        { error: `Row not found in this batch (${patch.id ?? patch.row_number ?? 'missing id'})` },
        { status: 400 }
      );
    }
    const status = normalizeRowStatus(patch.status);
    if (patch.status != null && !status) {
      return NextResponse.json(
        { error: `Unknown row status "${patch.status}". Use pending, processing, listed (imported), or error (failed).` },
        { status: 400 }
      );
    }
    const listingId = patch.marketplace_listing_id ?? patch.marketplace_item_id;
    const payload: Record<string, unknown> = {
      processed_at: now,
      processed_by: gate.caller.userId,
    };
    if (status) payload.status = status;
    if (listingId !== undefined) {
      payload.marketplace_listing_id = listingId ? String(listingId) : null;
    }
    const errMsg = patch.error_message ?? patch.error;
    if (errMsg !== undefined) payload.error_message = errMsg ? String(errMsg).slice(0, 1000) : null;

    const { error: updErr } = await admin
      .from('marketplace_upload_rows')
      .update(payload)
      .eq('id', current.id)
      .eq('batch_id', batchId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    updatedRows += 1;
    if (status) current.status = status;
  }

  const { data: afterRows } = await admin
    .from('marketplace_upload_rows')
    .select('status')
    .eq('batch_id', batchId);
  const statuses = (afterRows || []).map((r) => String(r.status || 'pending'));
  const counts = countRowOutcomes(statuses);
  const explicit = body.status != null ? normalizeCatalogStatus(body.status) : null;
  if (body.status != null && !explicit) {
    return NextResponse.json(
      { error: `Unknown batch status "${body.status}". Use pending, processing, listed, error, or partial.` },
      { status: 400 }
    );
  }

  const batchUpdate: Record<string, unknown> = {
    listed_count: counts.listed,
    error_count: counts.error,
    status: explicit || rollupBatchStatus(statuses),
  };
  if (body.notes !== undefined) batchUpdate.notes = body.notes == null ? null : String(body.notes).slice(0, 2000);

  const { data: nextBatch, error: batchErr } = await admin
    .from('marketplace_upload_batches')
    .update(batchUpdate)
    .eq('id', batchId)
    .select('*')
    .maybeSingle();
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    god: true,
    batch: nextBatch,
    updatedRows,
    counts,
  });
}
