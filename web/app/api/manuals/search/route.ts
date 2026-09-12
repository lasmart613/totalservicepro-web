import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { canAccessServiceManuals } from '@/lib/roles';
import { manualSearchTokens, sanitizeManualSearchQuery } from '@/lib/manual-library-filter';
import { findManualIdsByBodyText } from '@/lib/manual-search-index';

export const dynamic = 'force-dynamic';

async function loadCaller(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { error: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }) };
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) };
  }
  return { user, supabase };
}

/**
 * POST /api/manuals/search
 * Catalog-wide PDF-body matches (not limited to owned manuals).
 * Returns ids only — never search_text or signed PDF URLs.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await loadCaller(req);
    if (!('user' in caller) || !caller.user) return caller.error;
    const { user, supabase } = caller;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, organizations(type)')
      .eq('id', user.id)
      .maybeSingle();
    const orgJoin = profile?.organizations as { type?: string } | { type?: string }[] | null;
    const orgType = Array.isArray(orgJoin) ? orgJoin[0]?.type : orgJoin?.type;
    if (!canAccessServiceManuals(profile?.role, orgType)) {
      return NextResponse.json({ error: 'Service manuals are for service companies.' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { q?: unknown; query?: unknown };
    const q = sanitizeManualSearchQuery(body.q ?? body.query ?? '');
    const tokens = manualSearchTokens(q);
    if (!tokens.length) {
      return NextResponse.json({ ok: true, ids: [], bodySearch: true, q: '' });
    }

    if (hasServiceRole()) {
      const found = await findManualIdsByBodyText(getSupabaseAdmin(), tokens);
      return NextResponse.json({
        ok: true,
        ids: found.ids,
        bodySearch: found.available,
        q,
      });
    }

    const rpc = await supabase.rpc('search_manual_catalog', { q });
    if (!rpc.error) {
      const ids = (rpc.data || [])
        .map((row: { manual_id?: unknown }) => String(row.manual_id || '').trim())
        .filter(Boolean);
      return NextResponse.json({ ok: true, ids: [...new Set(ids)], bodySearch: true, q });
    }

    return NextResponse.json({
      ok: true,
      ids: [],
      bodySearch: false,
      q,
      hint: 'PDF body index is not available yet. Metadata search still runs in the library.',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Search failed';
    console.error('[manuals/search]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
