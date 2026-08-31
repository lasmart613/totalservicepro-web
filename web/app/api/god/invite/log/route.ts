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

  const colsWithUnsub =
    'id, created_at, organization_id, organization_name, recipient_email, subject, template_key, sent_by_email, unsubscribed_at';
  const colsLegacy =
    'id, created_at, organization_id, organization_name, recipient_email, subject, template_key, sent_by_email';

  let query = await getSupabaseAdmin()
    .from('god_email_sends')
    .select(colsWithUnsub)
    .order('created_at', { ascending: false })
    .limit(200);

  if (query.error && /column|schema cache|does not exist/i.test(query.error.message || '')) {
    query = await getSupabaseAdmin()
      .from('god_email_sends')
      .select(colsLegacy)
      .order('created_at', { ascending: false })
      .limit(200);
  }

  const { data, error } = query;

  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message || '')) {
      return NextResponse.json({
        ok: true,
        sends: [],
        needsMigration: true,
        hint: 'Apply supabase/migrations/20260831_000002_god_email_sends.sql and 20260831_000003_god_email_sends_unsubscribe.sql on live Supabase.',
      });
    }
    return NextResponse.json({ error: error.message, sends: [] }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    sends: (data || []).map((row) => ({
      ...row,
      unsubscribe_token: undefined,
    })),
  });
}
