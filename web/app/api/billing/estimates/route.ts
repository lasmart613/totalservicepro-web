import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBillingCaller } from '@/lib/billing/billing-caller';
import { callerRoleOnEstimate, isEstimateCustomer } from '@/lib/billing/approve-estimate';
import { publicEstimatePayload, resolveOrgNotifyEmails } from '@/lib/billing/estimate-action';
import { isEstimateAwaitingCustomerAction } from '@/lib/billing/save-helpers';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const EST_SELECTS = [
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, customer_action, customer_action_at, customer_action_note, customer_action_token, approved_ticket_id, approved_ticket_number, device_model, created_at',
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, customer_action, customer_action_at, customer_action_note, created_at',
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, created_at',
];

function mergeRows(batches: any[][]): any[] {
  const seen: Record<string, boolean> = {};
  const out: any[] = [];
  for (const batch of batches) {
    for (const row of batch || []) {
      if (!row || row.id == null) continue;
      const k = String(row.id);
      if (seen[k]) continue;
      seen[k] = true;
      out.push(row);
    }
  }
  out.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
  return out;
}

async function selectEstimates(
  client: SupabaseClient,
  build: (q: any) => any
): Promise<any[]> {
  for (const cols of EST_SELECTS) {
    const { data, error } = await build(client.from('service_estimates').select(cols));
    if (!error) return data || [];
    if (!/column|schema cache|does not exist/i.test(error.message || '')) break;
  }
  return [];
}

/**
 * GET /api/billing/estimates
 * Clinic inbox: estimates addressed to the signed-in customer org or email.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await loadBillingCaller(req);
    if ('error' in auth) return auth.error;

    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'This page is temporarily unavailable.' }, { status: 503 });
    }

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

    const email = String(user.email || '').trim().toLowerCase();
    const admin = getSupabaseAdmin();
    const batches: any[][] = [];

    if (orgId != null && orgId !== '') {
      batches.push(
        await selectEstimates(admin, (q) =>
          q.eq('customer_organization_id', orgId).order('created_at', { ascending: false }).limit(80)
        )
      );
    }
    if (email) {
      batches.push(
        await selectEstimates(admin, (q) =>
          q.filter('estimate_data->>custEmail', 'eq', email).limit(40)
        )
      );
      batches.push(
        await selectEstimates(admin, (q) =>
          q.filter('estimate_data->>email', 'eq', email).limit(40)
        )
      );
    }

    const viewer = { orgId, userId: user.id, email };
    const rows = mergeRows(batches).filter(
      (est) =>
        callerRoleOnEstimate(est, viewer) === 'customer' || isEstimateCustomer(est, viewer)
    );

    const estimates = await Promise.all(
      rows.map(async (est) => {
        const { companyName } = await resolveOrgNotifyEmails(admin, est);
        return {
          ...publicEstimatePayload(est, companyName),
          estimateId: est.id,
          status: est.status || null,
          deviceModel: est.device_model || null,
          awaitingAction: isEstimateAwaitingCustomerAction(est),
        };
      })
    );

    return NextResponse.json({
      ok: true,
      estimates,
      awaiting: estimates.filter((e) => e.awaitingAction).length,
    });
  } catch (e: any) {
    console.error('estimates list GET', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
