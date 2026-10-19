import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { loadSignedInDirectory } from '@/lib/directory/listed';

export const dynamic = 'force-dynamic';

/**
 * GET /api/directory/listed — signed-in directory "All listed".
 * Requires a signed-in user (Bearer access token). Reads with the service
 * role because the exclusion markers (notes, prospect_pool, lead_source) are
 * private since 000932; returns only the columns the page renders.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  try {
    const anon = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await anon.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    if (!hasServiceRole()) return NextResponse.json({ error: 'Directory unavailable' }, { status: 503 });

    const result = await loadSignedInDirectory(getSupabaseAdmin());
    if (!result.ok) return NextResponse.json({ error: 'Directory unavailable' }, { status: 503 });
    return NextResponse.json(
      { listings: result.listings, total: result.total },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (e: unknown) {
    console.error('[directory listed]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Directory unavailable' }, { status: 500 });
  }
}
