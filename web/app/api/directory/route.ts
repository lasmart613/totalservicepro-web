import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { loadGuestDirectoryPage } from '@/lib/directory/guest-api';

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
    const { ok: _ok, ...body } = result;
    return NextResponse.json(body);
  } catch (e: unknown) {
    console.error('[directory list]', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Directory preview unavailable', listings: [], hasMore: false },
      { status: 500 }
    );
  }
}
