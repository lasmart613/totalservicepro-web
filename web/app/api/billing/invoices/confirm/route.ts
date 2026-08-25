import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { retrieveCheckoutSession, StripeSubscriptionError } from '@/lib/billing/stripe-subscription';
import { applyInvoiceCheckoutSession } from '@/lib/billing/persist-invoice-payment';

export const dynamic = 'force-dynamic';

/** Apply a paid Stripe Checkout session onto the TSP invoice. Public: Stripe is the source of truth. */
export async function GET(req: NextRequest) {
  const sessionId = String(new URL(req.url).searchParams.get('session_id') || '').trim();
  return confirm(sessionId);
}

export async function POST(req: NextRequest) {
  let sessionId = '';
  try {
    const body = await req.json();
    sessionId = String(body?.session_id || '').trim();
  } catch {
    sessionId = String(new URL(req.url).searchParams.get('session_id') || '').trim();
  }
  return confirm(sessionId);
}

async function confirm(sessionId: string) {
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'session_id required' }, { status: 400 });
  }
  if (!hasServiceRole()) {
    return NextResponse.json({ ok: false, error: 'Server cannot write invoice status.' }, { status: 503 });
  }
  try {
    const session = await retrieveCheckoutSession(sessionId);
    const result = await applyInvoiceCheckoutSession({
      writer: getSupabaseAdmin(),
      session,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.applied });
  } catch (e: unknown) {
    const status = e instanceof StripeSubscriptionError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Confirm failed';
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
