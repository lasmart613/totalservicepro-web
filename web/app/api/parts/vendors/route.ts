import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { VENDOR_ADD_ERROR, VENDOR_PREFER_ERROR } from '@/lib/part-catalog-manage';
import { vendorInsertPatch } from '@/lib/part-catalog-write';
import { bearerUserId, catalogManagerStatus, insertAllowingMissing, updateAllowingMissing } from '@/lib/part-catalog-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = await bearerUserId(req);
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action || '');
  const message = action === 'prefer' ? VENDOR_PREFER_ERROR : VENDOR_ADD_ERROR;
  if (!hasServiceRole()) {
    console.error('[part-vendors] service role unavailable');
    return NextResponse.json({ error: message }, { status: 503 });
  }
  if (!body || (action !== 'insert' && action !== 'prefer')) {
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const access = await catalogManagerStatus(admin, userId, body.partId);
  if (!access.ok) {
    const status = access.status === 404 ? 404 : access.status === 400 ? 400 : 403;
    return NextResponse.json({ error: status === 404 ? 'Part not found' : message }, { status });
  }

  if (action === 'insert') {
    const row = vendorInsertPatch(body, userId);
    if (!row) return NextResponse.json({ error: 'Vendor name is required.' }, { status: 400 });
    row.part_id = body.partId;
    const result = await insertAllowingMissing(admin, 'part_vendors', row);
    if (result.error) {
      console.error('[part-vendors] insert', result.error.message);
      return NextResponse.json({ error: message }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  const vendorId = body.vendorId;
  if (vendorId == null || vendorId === '') {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { data: vendor } = await admin.from('part_vendors').select('id, part_id').eq('id', vendorId).maybeSingle();
  if (!vendor || String(vendor.part_id) !== String(body.partId)) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  const cleared = await admin.from('part_vendors').update({ is_preferred: false }).eq('part_id', body.partId);
  if (cleared.error) {
    console.error('[part-vendors] prefer clear', cleared.error.message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const result = await updateAllowingMissing(admin, 'part_vendors', vendorId, { is_preferred: true });
  if (result.error || result.count === 0) {
    console.error('[part-vendors] prefer', result.error?.message || '0 rows');
    return NextResponse.json({ error: message }, { status: result.error ? 502 : 403 });
  }
  return NextResponse.json({ ok: true });
}
