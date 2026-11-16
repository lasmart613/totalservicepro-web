import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { loadGuestDirectoryPage } from '@/lib/directory/guest-api';
import { attachRatingSummaries, ORG_RATING_SUMMARY_RPC, UNSHARED_CACHE_HEADERS } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

/**
 * Public directory preview for logged-out visitors.
 * Anon key only (no service role): reads public.public_directory_page (000931),
 * which returns listed orgs only (list_in_directory = true, active, not an
 * import, not a prospect_pool / lead_source org) and a listed-only total.
 * Cards carry placeholders and uniform contact flags; no names or contacts.
 */
export async function GET(req: NextRequest) {
  try {
    const anon = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const url = req.nextUrl;
    const result = await loadGuestDirectoryPage((fn, args) => anon.rpc(fn, args), {
      page: url.searchParams.get('page'),
      limit: url.searchParams.get('limit'),
      filter: url.searchParams.get('filter'),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Directory preview unavailable', listings: [], hasMore: false },
        { status: result.status }
      );
    }
    const ids = result.listings
      .map((row) => Number(row.id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 200);
    let summaries: unknown = null;
    if (ids.length) {
      // Same summary a future matched-shop list should call. Counts only; no review text.
      const rated = await anon.rpc(ORG_RATING_SUMMARY_RPC, { p_org_ids: ids });
      if (!rated.error) summaries = rated.data;
    }
    const { ok: _ok, listings, ...rest } = result;
    return NextResponse.json(
      { ...rest, listings: attachRatingSummaries(listings, summaries) },
      { headers: UNSHARED_CACHE_HEADERS }
    );
  } catch (e: unknown) {
    console.error('[directory list]', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Directory preview unavailable', listings: [], hasMore: false },
      { status: 500 }
    );
  }
}
