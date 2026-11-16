import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { publicProfileFromRpc, publicReviewsFromRpc } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

/**
 * GET /api/directory/profile?id=
 * Public company profile and visible reviews. Anon key only.
 * The RPC returns name, place, and rating fields. Phone, email, notes,
 * and invoice amounts are not selected.
 */
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'This company is not in the public directory.' }, { status: 404 });
  }
  try {
    const anon = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const [profileRes, reviewRes] = await Promise.all([
      anon.rpc('public_service_org_profile', { p_org: id }),
      anon.rpc('service_org_reviews_public', { p_org: id, p_limit: 20, p_offset: 0 }),
    ]);
    if (profileRes.error || reviewRes.error) {
      return NextResponse.json({ error: 'Directory unavailable' }, { status: 503 });
    }
    const profile = publicProfileFromRpc(profileRes.data);
    if (!profile) {
      return NextResponse.json({ error: 'This company is not in the public directory.' }, { status: 404 });
    }
    return NextResponse.json(
      { profile, reviews: publicReviewsFromRpc(reviewRes.data) },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch (e: unknown) {
    console.error('[directory profile]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Directory unavailable' }, { status: 500 });
  }
}
