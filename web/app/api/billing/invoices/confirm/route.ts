import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { retrieveCheckoutSession, StripeSubscriptionError, type StripeObject } from '@/lib/billing/stripe-subscription';
import { applyInvoiceCheckoutSession } from '@/lib/billing/persist-invoice-payment';
import { VOIDED_INVOICE_MESSAGE } from '@/lib/billing/void-invoice';

export const dynamic = 'force-dynamic';

/** Apply a paid Stripe Checkout session onto the TSP invoice. Public: Stripe is the source of truth. */
type ConfirmDeps = {
  retrieve?: (sessionId: string) => Promise<StripeObject>;
  writer?: SupabaseClient;
  serviceRole?: boolean;
};

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

/** Public confirm. Tests pass a mocked Stripe retrieve and the service-role writer. */
export async function runConfirmInvoice(sessionId: string, deps: ConfirmDeps = {}) {
  return confirm(sessionId, deps);
}

async function confirm(sessionId: string, deps: ConfirmDeps = {}) {
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'session_id required' }, { status: 400 });
  }
  const serviceRole = deps.serviceRole ?? hasServiceRole();
  if (!serviceRole) {
    return NextResponse.json({ ok: false, error: 'Server cannot write invoice status.' }, { status: 503 });
  }
  try {
    const retrieve = deps.retrieve ?? retrieveCheckoutSession;
    const writer = deps.writer ?? getSupabaseAdmin();
    const session = await retrieve(sessionId);
    const result = await applyInvoiceCheckoutSession({
      writer,
      session,
    });
    if (!result.ok) {
      if (result.reason === 'invoice_void') {
        return NextResponse.json(
          { ok: false, voided: true, error: VOIDED_INVOICE_MESSAGE },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: false, error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.applied });
  } catch (e: unknown) {
    const status = e instanceof StripeSubscriptionError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Confirm failed';
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
