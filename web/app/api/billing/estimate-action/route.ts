import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  applyEstimateCustomerAction,
  decideEstimateActionHttp,
  estimateActionConfirmSecret,
  estimateActionRedirectLang,
  estimateActionRedirectLocation,
  findEstimateByActionToken,
  isValidEstimateActionToken,
  notifyShopOfCustomerAction,
  publicEstimatePayload,
  resolveOrgNotifyEmails,
} from '@/lib/billing/estimate-action';
import {
  customerActionConfirmationTitle,
  isEstimateExpired,
} from '@/lib/billing/save-helpers';
import { loadOrgMoneyPrefs } from '@/lib/org-money';

export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/estimate-action
 * Opening a link must not approve, reject, or create a ticket.
 * The confirm page reads the estimate on the server. This route is POST-only.
 */
export async function GET() {
  const decision = decideEstimateActionHttp({ method: 'GET', secret: '' });
  if (decision.effect !== 'none') {
    return NextResponse.json(
      { error: 'Method not allowed' },
      { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(
    { error: decision.error },
    { status: decision.status, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } }
  );
}

/**
 * POST /api/billing/estimate-action
 * Body: { token, action: 'approve' | 'reject' | 'modify', note?, confirm, lang? }
 * `confirm` is the nonce rendered on the confirm page. A POST without it does not write.
 * `lang` is the hidden field on the no-JS confirm form.
 */
export async function POST(req: NextRequest) {
  return runEstimateActionPost(req);
}

export async function runEstimateActionPost(
  req: NextRequest,
  deps: {
    hasServiceRole?: () => boolean;
    getAdmin?: () => ReturnType<typeof getSupabaseAdmin>;
  } = {}
) {
  const serviceRole = deps.hasServiceRole ?? hasServiceRole;
  const adminClient = deps.getAdmin ?? getSupabaseAdmin;
  const formPost = isConfirmFormPost(req);
  let lang: string | null = null;
  let postedToken = '';
  let postedAction = '';
  const end = (status: number, payload: Record<string, unknown>) =>
    finish(req, formPost, status, { ...payload, lang });
  try {
    const body = await readActionBody(req);
    lang = estimateActionRedirectLang(body.lang);
    postedToken = String(body.token || '');
    postedAction = String(body.action || '');
    const decision = decideEstimateActionHttp({
      method: 'POST',
      body,
      secret: estimateActionConfirmSecret(),
    });
    if (decision.effect !== 'mutate') {
      return end(decision.status, {
        error: decision.error,
        token: postedToken,
        action: postedAction,
        notice: decision.status === 400 ? 'confirm' : 'failed',
      });
    }

    if (!serviceRole()) {
      return end(503, {
        error: 'This page is temporarily unavailable. Please contact the company that sent the estimate.',
        token: decision.token,
        action: postedAction,
        notice: 'failed',
      });
    }

    const admin = adminClient();
    const est = await findEstimateByActionToken(admin, decision.token);
    if (!est) {
      return end(404, {
        error: 'Estimate not found',
        token: decision.token,
        action: postedAction,
        notice: 'failed',
      });
    }

    const { companyName } = await resolveOrgNotifyEmails(admin, est);
    const moneyPrefs = await loadOrgMoneyPrefs(admin, est.organization_id);
    const payload = publicEstimatePayload(est, companyName, moneyPrefs);

    if (payload.expired || isEstimateExpired(est)) {
      return end(409, {
        error: 'This estimate has expired and can no longer be updated online.',
        estimate: payload,
        expired: true,
        token: decision.token,
        action: postedAction,
        notice: 'expired',
      });
    }

    const result = await applyEstimateCustomerAction(admin, est, decision.action, decision.note);
    const applied = result.action;
    const updated = {
      ...payload,
      customerAction: applied,
      customerActionAt: result.already ? payload.customerActionAt : new Date().toISOString(),
      customerActionNote:
        applied === 'approved'
          ? payload.customerActionNote
          : decision.note || payload.customerActionNote,
    };

    if (!result.already) {
      await notifyShopOfCustomerAction(admin, est, applied, decision.note);
    }

    const terminalConflict = result.already && result.conflict;
    return end(terminalConflict ? 409 : 200, {
      ok: !terminalConflict,
      already: result.already,
      conflict: result.conflict,
      action: applied,
      title: customerActionConfirmationTitle(applied),
      estimate: updated,
      request: result.ticket
        ? { id: result.ticket.id, number: result.ticket.ticket_number }
        : null,
      companyName,
      token: decision.token,
      notice: '',
    });
  } catch (e: any) {
    console.error('estimate-action POST', e);
    return end(500, {
      error: e?.message || 'Server error',
      token: postedToken,
      action: postedAction,
      notice: 'failed',
    });
  }
}

function isConfirmFormPost(req: NextRequest): boolean {
  const contentType = req.headers.get('content-type') || '';
  return (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  );
}

async function readActionBody(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await req.json().catch(() => null);
    return json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  }
  if (isConfirmFormPost(req)) {
    const form = await req.formData().catch(() => null);
    if (!form) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }
  return {};
}

function finish(
  req: NextRequest,
  formPost: boolean,
  status: number,
  body: Record<string, unknown>
) {
  const token = String(body.token || '').trim();
  if (formPost && isValidEstimateActionToken(token)) {
    const location = estimateActionRedirectLocation({
      token,
      status,
      action: body.action,
      already: body.already === true,
      notice: body.notice,
      lang: body.lang,
      forwardedHost: req.headers.get('x-forwarded-host'),
      host: req.headers.get('host'),
      forwardedProto: req.headers.get('x-forwarded-proto'),
    });
    if (location) {
      return new NextResponse(null, {
        status: 303,
        headers: { Location: location, 'Cache-Control': 'no-store' },
      });
    }
  }
  const json = { ...body };
  delete json.token;
  delete json.notice;
  delete json.lang;
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (status === 405) headers.Allow = 'POST';
  return NextResponse.json(json, { status, headers });
}
