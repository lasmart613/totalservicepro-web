import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { loadSignedInDirectory } from '@/lib/directory/listed';
import { attachRatingSummaries, ORG_RATING_SUMMARY_RPC } from '@/lib/reviews';
import { noStoreJson } from '@/lib/reviews-server';

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
  if (!token) return noStoreJson({ error: 'Sign in required' }, 401);
  try {
    const anon = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await anon.auth.getUser(token);
    if (userErr || !user) return noStoreJson({ error: 'Invalid session' }, 401);
    if (!hasServiceRole()) return noStoreJson({ error: 'Directory unavailable' }, 503);

    const admin = getSupabaseAdmin();
    const result = await loadSignedInDirectory(admin);
    if (!result.ok) return noStoreJson({ error: 'Directory unavailable' }, 503);
    const ids = result.listings
      .map((row) => Number(row.id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 200);
    let summaries: unknown = null;
    if (ids.length) {
      const rated = await admin.rpc(ORG_RATING_SUMMARY_RPC, { p_org_ids: ids });
      if (!rated.error) summaries = rated.data;
    }
    return noStoreJson({ listings: attachRatingSummaries(result.listings, summaries), total: result.total });
  } catch (e: unknown) {
    console.error('[directory listed]', e instanceof Error ? e.message : e);
    return noStoreJson({ error: 'Directory unavailable' }, 500);
  }
}
