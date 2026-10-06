import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBillingCaller } from '@/lib/billing/billing-caller';
import { rejectedEstimateConvertRefusal } from '@/lib/billing/estimate-display';

export const dynamic = 'force-dynamic';

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
 * POST /api/billing/estimate-convert
 * Body: { estimate_id }
 * Refuses to convert a rejected estimate. Does not write the invoice or the
 * estimate; the caller saves only after this returns 200.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await loadBillingCaller(req);
    if ('error' in auth) return auth.error;

    const body = await req.json().catch(() => ({}));
    const estimateId = parseEstimateId(body.estimate_id);
    if (estimateId == null) {
      return NextResponse.json({ error: 'Estimate id is required.' }, { status: 400 });
    }

    const est = await loadEstimate(auth.supabase, estimateId);
    if (!est) return NextResponse.json({ error: 'Estimate not found.' }, { status: 404 });

    const refused = rejectedEstimateConvertRefusal(est);
    if (refused) {
      return NextResponse.json({ ok: false, error: refused.error }, { status: refused.status });
    }

    return NextResponse.json({ ok: true, estimateId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('estimate-convert', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
