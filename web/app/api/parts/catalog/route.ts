import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { CATALOG_SAVE_ERROR, PART_ARCHIVE_ERROR, STOCK_SAVE_ERROR } from '@/lib/part-catalog-manage';
import { catalogWritePatch } from '@/lib/part-catalog-write';
import { bearerUserId, catalogManagerStatus, updateAllowingMissing } from '@/lib/part-catalog-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function messageFor(action: string): string {
  if (action === 'archive') return PART_ARCHIVE_ERROR;
  if (action === 'stock') return STOCK_SAVE_ERROR;
  return CATALOG_SAVE_ERROR;
}

export async function POST(req: NextRequest) {
  const userId = await bearerUserId(req);
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action || '');
  const message = messageFor(action);
  if (!hasServiceRole()) {
    console.error('[parts-catalog] service role unavailable');
    return NextResponse.json({ error: message }, { status: 503 });
  }
  const patch = body ? catalogWritePatch(action, body) : null;
  if (!body || !patch) return NextResponse.json({ error: message }, { status: 400 });

  const admin = getSupabaseAdmin();
  const access = await catalogManagerStatus(admin, userId, body.id);
  if (!access.ok) {
    const status = access.status === 404 ? 404 : access.status === 400 ? 400 : 403;
    return NextResponse.json({ error: status === 404 ? 'Part not found' : message }, { status });
  }
  const result = await updateAllowingMissing(admin, 'parts_catalog', body.id, patch);
  if (result.error || result.count === 0) {
    console.error('[parts-catalog]', action, result.error?.message || '0 rows');
    return NextResponse.json({ error: message }, { status: result.error ? 502 : 403 });
  }
  return NextResponse.json({ ok: true });
}
