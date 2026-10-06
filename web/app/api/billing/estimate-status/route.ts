import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBillingCaller } from '@/lib/billing/billing-caller';
import { rejectedEstimateChangeRefusal } from '@/lib/billing/estimate-display';

export const dynamic = 'force-dynamic';

const STATUS_OK = new Set(['draft', 'pending', 'sent']);

const SELECTS = [
  'id, status, customer_action, customer_action_at, customer_action_note, customer_action_token, estimate_data',
  'id, status, estimate_data',
  'id, status',
];

function parseEstimateId(raw: unknown): string | number | null {
  const id = String(raw ?? '').trim();
  if (!id || id === 'new') return null;
  return /^\d+$/.test(id) ? Number(id) : id;
}

async function loadEstimate(client: SupabaseClient, id: string | number) {
  for (const cols of SELECTS) {
    const { data, error } = await client.from('service_estimates').select(cols).eq('id', id).maybeSingle();
    if (!error && data) return data;
    if (error && !/column|schema cache|does not exist/i.test(error.message || '')) break;
  }
  return null;
}

/**
 * POST /api/billing/estimate-status
 * Body: { estimate_id, status: 'draft' | 'pending' | 'sent' }
 * Refuses to reopen or re-send a rejected estimate. Does not write the row;
 * the caller saves only after this returns 200.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await loadBillingCaller(req);
    if ('error' in auth) return auth.error;

    const body = await req.json().catch(() => ({}));
    const estimateId = parseEstimateId(body.estimate_id);
    const nextStatus = String(body.status || '')
      .trim()
      .toLowerCase();
    if (estimateId == null) {
      return NextResponse.json({ error: 'Estimate id is required.' }, { status: 400 });
    }
    if (!STATUS_OK.has(nextStatus)) {
      return NextResponse.json({ error: 'Unsupported estimate status.' }, { status: 400 });
    }

    const est = await loadEstimate(auth.supabase, estimateId);
    if (!est) return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 });

    const refused = rejectedEstimateChangeRefusal(est);
    if (refused) {
      return NextResponse.json({ ok: false, error: refused.error }, { status: refused.status });
    }

    return NextResponse.json({ ok: true, status: nextStatus, estimateId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('estimate-status', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
