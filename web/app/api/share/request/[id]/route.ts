import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { publicShareRequestRow, SHARE_REQUEST_SELECT } from '@/lib/share-request-public';

export const dynamic = 'force-dynamic';

/**
 * Public share endpoint for RFQs.
 * Returns the open_service_requests column set (minus budget) for open/bidding requests so
 * logged-out invitees can preview and get a signup CTA. Serial numbers, error
 * codes, budget, bids and private contacts are never included.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const raw = await Promise.resolve(ctx.params);
    const id = raw?.id;
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    if (!hasServiceRole()) {
      return NextResponse.json(
        {
          error: 'Share preview unavailable',
          hint: 'Add SUPABASE_SERVICE_ROLE_KEY to Netlify, or run public SELECT policies on service_requests.',
        },
        { status: 503 }
      );
    }

    const admin = getSupabaseAdmin();
    const { data: found, error } = await admin
      .from('service_requests')
      // open_service_requests column set minus budget (no serial, error codes, preferred date, budget).
      .select(SHARE_REQUEST_SELECT)
      .eq('id', id)
      .maybeSingle();
    const data = (found as Record<string, any> | null) ?? null;

    if (error) {
      console.error('[share/request]', error);
      return NextResponse.json({ error: 'Share preview unavailable' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const st = String(data.status || 'open').toLowerCase();
    if (!['open', 'bidding'].includes(st)) {
      // Don't leak closed/awarded private jobs via share
      return NextResponse.json(
        {
          error: 'This request is no longer open for bidding',
          status: data.status,
          closed: true,
        },
        { status: 403 }
      );
    }

    let org: { name?: string | null; city?: string | null; state?: string | null } | null = null;
    if (data.organization_id != null) {
      try {
        const { data: found } = await admin
          .from('organizations')
          .select('name, city, state')
          .eq('id', data.organization_id)
          .maybeSingle();
        org = found || null;
      } catch {
        /* ignore */
      }
    }

    const publicRow = publicShareRequestRow(data, org);

    return NextResponse.json({ request: publicRow });
  } catch (e: any) {
    console.error('[share/request]', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
