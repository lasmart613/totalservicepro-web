import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  CUSTOMER_ACTION_APPROVED,
  CUSTOMER_ACTION_CHANGES,
  buildOrgNotifyEmail,
  findEstimateByActionToken,
  isValidEstimateActionToken,
  persistCustomerAction,
  publicEstimatePayload,
  resolveOrgNotifyEmails,
  sendResendHtml,
} from '@/lib/billing/estimate-action';
import { parseJsonField } from '@/lib/billing/save-helpers';
import { estimateCustomerLoginPath } from '@/lib/share';

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
 * Body: { token, action: 'approve' | 'request_changes', note? }
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

    const rawAction = String(body.action || '').toLowerCase();
    const action =
      rawAction === 'approve' || rawAction === CUSTOMER_ACTION_APPROVED
        ? CUSTOMER_ACTION_APPROVED
        : rawAction === 'request_changes' || rawAction === CUSTOMER_ACTION_CHANGES
          ? CUSTOMER_ACTION_CHANGES
          : null;
    if (!action) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const note = String(body.note || '').trim();
    if (action === CUSTOMER_ACTION_CHANGES && !note) {
      return NextResponse.json({ error: 'Please enter a short note describing the changes you need.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const est = await findEstimateByActionToken(admin, token);
    if (!est) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    const { companyName, emails } = await resolveOrgNotifyEmails(admin, est);
    const payload = publicEstimatePayload(est, companyName);
    const loginUrl = estimateCustomerLoginPath(est.id);

    if (action === CUSTOMER_ACTION_APPROVED) {
      return NextResponse.json(
        {
          error: 'Sign in as the clinic this estimate was written for to approve it.',
          loginUrl,
          estimate: payload,
          requiresLogin: true,
        },
        { status: 401 }
      );
    }

    const { already } = await persistCustomerAction(
      admin,
      est,
      action,
      action === CUSTOMER_ACTION_CHANGES ? note : null
    );

    const updated = {
      ...payload,
      customerAction: action,
      customerActionAt: already ? payload.customerActionAt : new Date().toISOString(),
      customerActionNote:
        action === CUSTOMER_ACTION_CHANGES ? note : payload.customerActionNote,
    };

    if (!already) {
      const ed = parseJsonField(est.estimate_data);
      const customerEmail = ed.custEmail || ed.email || null;
      const mail = buildOrgNotifyEmail({
        action,
        companyName,
        customerName: payload.customerName,
        estimateNumber: payload.estimateNumber,
        total: payload.total,
        note: action === CUSTOMER_ACTION_CHANGES ? note : null,
        estimateId: est.id,
      });
      if (emails.length) {
        const sent = await sendResendHtml({
          to: emails,
          subject: mail.subject,
          html: mail.html,
          replyTo: customerEmail && String(customerEmail).includes('@') ? String(customerEmail) : undefined,
        });
        if (!sent.ok) console.warn('org notify email skipped', sent.error);
      } else {
        console.warn('org notify: no recipient emails for estimate', est.id);
      }
    }

    return NextResponse.json({
      ok: true,
      already,
      action,
      estimate: updated,
      companyName,
    });
  } catch (e: any) {
    console.error('estimate-action POST', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
