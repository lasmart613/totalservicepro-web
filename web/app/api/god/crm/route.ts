import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { loadGodCrm } from '@/lib/god-crm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/crm
 * Composed CRM snapshot for the God panel. Larry only.
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

  const payload = await loadGodCrm(getSupabaseAdmin());
  return NextResponse.json({ ...payload, god: true });
}
