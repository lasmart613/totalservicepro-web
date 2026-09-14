import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  applyEstimateCustomerAction,
  findEstimateByActionToken,
  isValidEstimateActionToken,
  notifyShopOfCustomerAction,
  publicEstimatePayload,
  resolveOrgNotifyEmails,
} from '@/lib/billing/estimate-action';
import {
  customerActionConfirmationTitle,
  isEstimateExpired,
  parseCustomerActionKind,
} from '@/lib/billing/save-helpers';

export const dynamic = 'force-dynamic';

function parseToken(req: NextRequest, body?: any): string {
  const fromQuery = req.nextUrl.searchParams.get('token') || '';
  const fromBody = body?.token ? String(body.token) : '';
  return (fromBody || fromQuery).trim();
}

/**
 * GET /api/billing/estimate-action?token=
 * Public, no-login estimate summary for the emailed CTA page.
 */
export async function GET(req: NextRequest) {
  try {
    const token = parseToken(req);
    if (!isValidEstimateActionToken(token)) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
    }
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'This page is temporarily unavailable. Please contact the company that sent the estimate.' },
        { status: 503 }
      );
    }

    const admin = getSupabaseAdmin();
    const est = await findEstimateByActionToken(admin, token);
    if (!est) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    const { companyName } = await resolveOrgNotifyEmails(admin, est);
    return NextResponse.json({ estimate: publicEstimatePayload(est, companyName) });
  } catch (e: any) {
    console.error('estimate-action GET', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

/**
 * POST /api/billing/estimate-action
 * Body: { token, action: 'approve' | 'reject' | 'modify', note? }
 * Token is the credential — no clinic login required.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = parseToken(req, body);
    if (!isValidEstimateActionToken(token)) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
    }
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'This page is temporarily unavailable. Please contact the company that sent the estimate.' },
        { status: 503 }
      );
    }

    const action = parseCustomerActionKind(body.action);
    if (!action) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const note = String(body.note || '').trim() || null;

    const admin = getSupabaseAdmin();
    const est = await findEstimateByActionToken(admin, token);
    if (!est) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    const { companyName } = await resolveOrgNotifyEmails(admin, est);
    const payload = publicEstimatePayload(est, companyName);

    if (payload.expired || isEstimateExpired(est)) {
      return NextResponse.json(
        {
          error: 'This estimate has expired and can no longer be updated online.',
          estimate: payload,
          expired: true,
        },
        { status: 409 }
      );
    }

    const result = await applyEstimateCustomerAction(admin, est, action, note);
    const applied = result.action;
    const updated = {
      ...payload,
      customerAction: applied,
      customerActionAt: result.already ? payload.customerActionAt : new Date().toISOString(),
      customerActionNote:
        applied === 'changes_requested' ? note || payload.customerActionNote : payload.customerActionNote,
    };

    if (!result.already) {
      await notifyShopOfCustomerAction(admin, est, applied, note);
    }

    return NextResponse.json({
      ok: true,
      already: result.already,
      conflict: result.conflict,
      action: applied,
      title: customerActionConfirmationTitle(applied),
      estimate: updated,
      request: result.ticket
        ? { id: result.ticket.id, number: result.ticket.ticket_number }
        : null,
      companyName,
    });
  } catch (e: any) {
    console.error('estimate-action POST', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
