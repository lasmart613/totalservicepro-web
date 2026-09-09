import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { loadGodKpis, parseKpiDays } from '@/lib/god-kpis';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/kpis?days=7|14|30|90
 * Site + product KPIs for the God home. Larry only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;

  if (!hasServiceRole()) {
    return NextResponse.json(
      { error: 'Server missing SUPABASE_SERVICE_ROLE_KEY', god: true },
      { status: 500 }
    );
  }

  const days = parseKpiDays(req.nextUrl.searchParams.get('days'));
  const payload = await loadGodKpis(getSupabaseAdmin(), days);
  return NextResponse.json({ ...payload, god: true });
}
