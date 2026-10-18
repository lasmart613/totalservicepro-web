import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { publicSiteOrigin } from '@/lib/customer-invite';
import { positiveId } from '@/lib/service-history-requests';
import { sendResendEmail } from '@/lib/history-request-email';
import { notifyOwnersOfRequest } from '@/lib/history-request-notify';
import { rpcErrorBody, userFromRequest } from '@/lib/history-request-route';

/**
 * POST /api/service-history/requests  { ownerOrgId, equipmentId, ref? }
 * A shop asks a clinic to share one laser's earlier service history (000922).
 * request_service_history_access runs with the caller's session and does all
 * the checks (Rule A, requester role, dedupe, cooldown, rate limits). Only a
 * newly created request notifies the clinic's owners/admins (in-app + email).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await userFromRequest(req.headers.get('authorization'));
    if (!auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => ({}));
    const owner = positiveId(body?.ownerOrgId);
    const equipment = positiveId(body?.equipmentId);
    const ref = typeof body?.ref === 'string' && /^[0-9a-f]{32}$/i.test(body.ref) ? body.ref.toLowerCase() : null;
    if (!owner || !equipment) {
      return NextResponse.json({ error: 'ownerOrgId and equipmentId are required', kind: 'invalid' }, { status: 400 });
    }

    const { data, error } = await auth.user.client.rpc('request_service_history_access', {
      p_owner_org: owner,
      p_equipment_id: equipment,
      p_ref: ref,
    });
    if (error) {
      const r = rpcErrorBody(error);
      return NextResponse.json(r.body, { status: r.status });
    }
    const row = Array.isArray(data) ? data[0] : data;
    const result = {
      ok: true,
      requestId: row?.request_id ?? null,
      status: row?.status ?? null,
      created: row?.created === true,
      expiresAt: row?.expires_at ?? null,
      notified: false,
      emailed: 0,
    };
    if (result.created && result.requestId && hasServiceRole()) {
      try {
        const outcome = await notifyOwnersOfRequest(
          { admin: getSupabaseAdmin() as any, send: (m) => sendResendEmail(m), origin: publicSiteOrigin(req) },
          Number(result.requestId),
          auth.user.userId
        );
        result.notified = outcome.notified > 0;
        result.emailed = outcome.emailed;
        if (outcome.error) console.warn('history request notify', outcome.error);
      } catch (e) {
        console.warn('history request notify', e);
      }
    }
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('service-history request', e);
    return NextResponse.json({ error: 'Request failed', kind: 'error' }, { status: 500 });
  }
}
