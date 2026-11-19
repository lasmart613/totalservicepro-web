import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { invoicePayStatusDecision } from '@/lib/billing/invoice-pay-status';

export const dynamic = 'force-dynamic';

/**
 * Public payment-page status. The email links here instead of Stripe.
 * A matching checkout session is required before a live pay URL is returned.
 */
export async function GET(req: NextRequest) {
  const id = String(req.nextUrl.searchParams.get('id') || '').trim();
  const session = String(req.nextUrl.searchParams.get('session') || '').trim();
  if (!id) return NextResponse.json({ error: 'Invoice id is required.' }, { status: 400 });
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Payment status is unavailable.' }, { status: 503 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from('service_invoices')
    .select('id, status, invoice_data')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const decision = invoicePayStatusDecision(data, session);
  return NextResponse.json(decision.body, { status: decision.httpStatus });
}
