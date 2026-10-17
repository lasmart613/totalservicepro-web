import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { publicSiteOrigin } from '@/lib/customer-invite';
import { positiveId } from '@/lib/service-history-requests';
import { sendResendEmail } from '@/lib/history-request-email';
import { notifyShopOfResponse } from '@/lib/history-request-notify';
import { rpcErrorBody, userFromRequest } from '@/lib/history-request-route';

/**
 * POST /api/service-history/requests/:id/respond  { decision: 'approve'|'deny', scope?: 'equipment'|'all' }
 * A clinic owner/admin answers a history request (000922). The RPC takes the
 * clinic from the request row and re-checks the caller; approval creates the
 * grant through grant_service_history. The shop is told in-app; an approval
 * also emails the requester. A denial is in-app only.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await userFromRequest(req.headers.get('authorization'));
    if (!auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const raw = await ctx.params;
    const id = positiveId(raw?.id);
    const body = await req.json().catch(() => ({}));
    const decision = body?.decision === 'approve' || body?.decision === 'deny' ? body.decision : null;
    const scope = body?.scope === 'all' ? 'all' : 'equipment';
    if (!id || !decision) {
      return NextResponse.json({ error: 'request id and decision are required', kind: 'invalid' }, { status: 400 });
    }

    const { data, error } = await auth.user.client.rpc('respond_to_service_history_request', {
      p_request_id: id,
      p_decision: decision,
      p_scope: scope,
    });
    if (error) {
      const r = rpcErrorBody(error);
      return NextResponse.json(r.body, { status: r.status });
    }
    const row = Array.isArray(data) ? data[0] : data;
    const status = row?.status ?? null;
    let notified = false;
    if ((status === 'approved' || status === 'denied') && hasServiceRole()) {
      try {
        const outcome = await notifyShopOfResponse(
          { admin: getSupabaseAdmin() as any, send: (m) => sendResendEmail(m), origin: publicSiteOrigin(req) },
          id,
          auth.user.userId
        );
        notified = outcome.notified > 0;
        if (outcome.error) console.warn('history response notify', outcome.error);
      } catch (e) {
        console.warn('history response notify', e);
      }
    }
    return NextResponse.json({ ok: true, status, grantId: row?.grant_id ?? null, closeReason: row?.close_reason ?? null, notified });
  } catch (e: any) {
    console.error('service-history respond', e);
    return NextResponse.json({ error: 'Request failed', kind: 'error' }, { status: 500 });
  }
}
