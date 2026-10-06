import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { parseInvoiceData } from '@/lib/billing/apply-invoice-payment';
import { isVoidInvoiceStatus, sessionMatchesInvoice, VOIDED_INVOICE_MESSAGE } from '@/lib/billing/void-invoice';

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

  const dataRecord = parseInvoiceData(data.invoice_data);
  if (isVoidInvoiceStatus(data.status) || dataRecord.voided === true) {
    return NextResponse.json({ voided: true, message: VOIDED_INVOICE_MESSAGE });
  }
  if (!session || !sessionMatchesInvoice(data.invoice_data, session)) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  const paymentUrl = String(dataRecord.payment_url || '').trim();
  if (!paymentUrl) {
    return NextResponse.json({ voided: false, payable: false, message: 'This invoice has no payment link.' });
  }
  return NextResponse.json({ voided: false, payable: true, paymentUrl });
}
