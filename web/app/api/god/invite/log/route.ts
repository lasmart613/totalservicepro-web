import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/invite/log
 * Who already received the shop invite. God only. No send.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;

  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY', sends: [] }, { status: 500 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from('god_email_sends')
    .select(
      'id, created_at, organization_id, organization_name, recipient_email, subject, template_key, sent_by_email'
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message || '')) {
      return NextResponse.json({
        ok: true,
        sends: [],
        needsMigration: true,
        hint: 'Apply supabase/migrations/20260831_000002_god_email_sends.sql on live Supabase.',
      });
    }
    return NextResponse.json({ error: error.message, sends: [] }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sends: data || [] });
}
