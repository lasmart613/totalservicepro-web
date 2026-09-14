import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBillingCaller } from '@/lib/billing/billing-caller';
import {
  approvedTicketRefFromEstimate,
  callerRoleOnEstimate,
  customerOrgIdFromEstimate,
} from '@/lib/billing/approve-estimate';
import {
  applyEstimateCustomerAction,
  publicEstimatePayload,
  resolveOrgNotifyEmails,
} from '@/lib/billing/estimate-action';
import { isEstimateExpired, parseCustomerActionKind } from '@/lib/billing/save-helpers';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function parseEstimateId(raw: string): string | number | null {
  const id = String(raw || '').trim();
  if (!id || id === 'new') return null;
  return /^\d+$/.test(id) ? Number(id) : id;
}

const EST_SELECTS = [
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, customer_action, customer_action_at, customer_action_note, customer_action_token, approved_ticket_id, approved_ticket_number, device_model, services, issues, created_at',
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, customer_action, customer_action_at, customer_action_note, customer_action_token, device_model, created_at',
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, created_at',
];

async function loadEstimate(
  client: SupabaseClient,
  estimateId: string | number
): Promise<any | null> {
  for (const cols of EST_SELECTS) {
    const { data, error } = await client.from('service_estimates').select(cols).eq('id', estimateId).maybeSingle();
    if (!error && data) return data;
    if (error && !/column|schema cache|does not exist/i.test(error.message || '')) break;
  }
  return null;
}

async function callerContext(req: NextRequest) {
  const auth = await loadBillingCaller(req);
  if ('error' in auth) return auth;
  const { user, supabase } = auth;
  let orgId: string | number | null = null;
  try {
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    orgId = prof?.organization_id ?? null;
  } catch {
    /* ignore */
  }
  return { user, supabase, orgId };
}

function viewerPayload(estimate: any, companyName: string, role: 'shop' | 'customer') {
  const ticket = approvedTicketRefFromEstimate(estimate);
  return {
    role,
    estimate: {
      ...publicEstimatePayload(estimate, companyName),
      estimateId: estimate.id,
      customerOrgLinked: customerOrgIdFromEstimate(estimate) != null,
    },
    request: ticket.id || ticket.number
      ? { id: ticket.id, number: ticket.number }
      : null,
  };
}

/**
 * GET /api/billing/estimates/:id
 * Signed-in shop or clinic customer can read the estimate.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const raw = await Promise.resolve(ctx.params);
    const estimateId = parseEstimateId(raw?.id);
    if (estimateId == null) {
      return NextResponse.json({ error: 'Invalid estimate' }, { status: 400 });
    }

    const ctxAuth = await callerContext(req);
    if ('error' in ctxAuth) return ctxAuth.error;

    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'This page is temporarily unavailable.' }, { status: 503 });
    }

    const admin = getSupabaseAdmin();
    const est = await loadEstimate(admin, estimateId);
    if (!est) return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });

    const role = callerRoleOnEstimate(est, {
      orgId: ctxAuth.orgId,
      userId: ctxAuth.user.id,
      email: ctxAuth.user.email,
    });
    if (!role) {
      return NextResponse.json(
        { error: 'Sign in as the clinic this estimate was written for.' },
        { status: 403 }
      );
    }

    const { companyName } = await resolveOrgNotifyEmails(admin, est);
    return NextResponse.json(viewerPayload(est, companyName, role));
  } catch (e: any) {
    console.error('estimate GET', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

/**
 * POST /api/billing/estimates/:id
 * Body: { action: 'approve' | 'reject' | 'modify', note? }
 * Approve is clinic-only and creates one unscheduled shop-owned ticket.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const raw = await Promise.resolve(ctx.params);
    const estimateId = parseEstimateId(raw?.id);
    if (estimateId == null) {
      return NextResponse.json({ error: 'Invalid estimate' }, { status: 400 });
    }

    const ctxAuth = await callerContext(req);
    if ('error' in ctxAuth) return ctxAuth.error;

    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'This page is temporarily unavailable.' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const action = parseCustomerActionKind(body.action);
    if (!action) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const est = await loadEstimate(admin, estimateId);
    if (!est) return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });

    const role = callerRoleOnEstimate(est, {
      orgId: ctxAuth.orgId,
      userId: ctxAuth.user.id,
      email: ctxAuth.user.email,
    });
    if (action === 'approved' && role !== 'customer') {
      return NextResponse.json(
        { error: 'Sign in as the clinic this estimate was written for to approve it.' },
        { status: 403 }
      );
    }
    if (!role) {
      return NextResponse.json(
        { error: 'Sign in as the clinic this estimate was written for.' },
        { status: 403 }
      );
    }

    const { companyName } = await resolveOrgNotifyEmails(admin, est);
    const payload = publicEstimatePayload(est, companyName);

    if (payload.expired || isEstimateExpired(est)) {
      return NextResponse.json(
        {
          error: 'This estimate has expired. Please contact the company to request an updated quote.',
          estimate: { ...payload, estimateId: est.id },
          expired: true,
        },
        { status: 409 }
      );
    }

    const note = String(body.note || '').trim() || null;
    const result = await applyEstimateCustomerAction(admin, est, action, note);
    const created = result.ticket;
    const existing = approvedTicketRefFromEstimate(est);
    const request = created
      ? { id: created.id, number: created.ticket_number }
      : existing.id || existing.number
        ? { id: existing.id, number: existing.number }
        : null;
    return NextResponse.json({
      ok: true,
      already: result.already,
      conflict: result.conflict,
      action: result.action,
      estimate: {
        ...payload,
        estimateId: est.id,
        customerAction: result.action,
        customerActionAt: result.already ? payload.customerActionAt : new Date().toISOString(),
        customerActionNote:
          result.action === 'changes_requested' ? note || payload.customerActionNote : payload.customerActionNote,
      },
      request,
      companyName,
    });
  } catch (e: any) {
    console.error('estimate POST', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
