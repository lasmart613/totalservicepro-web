import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { normalizeCatalogStatus } from '@/lib/marketplace/catalog-upload';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/marketplace-uploads
 * God-only list of catalog upload batches. Optional ?status=pending
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;

  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY', batches: [] }, { status: 500 });
  }

  const status = normalizeCatalogStatus(req.nextUrl.searchParams.get('status'));
  const admin = getSupabaseAdmin();
  let q = admin
    .from('marketplace_upload_batches')
    .select(
      'id, organization_id, uploaded_by, original_filename, catalog_kind, status, row_count, listed_count, error_count, email_sent, email_error, created_at, notes'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message, batches: [] }, { status: 500 });
  }

  return NextResponse.json({ ok: true, god: true, batches: data || [] });
}
