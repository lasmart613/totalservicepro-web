import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { parseInvoiceData } from '@/lib/billing/apply-invoice-payment';
import { isVoidInvoiceStatus, sessionMatchesInvoice, VOIDED_INVOICE_MESSAGE } from '@/lib/billing/void-invoice';
import {
  INVOICE_PAYMENT_LINK_UNAVAILABLE,
  allowedInvoicePaymentUrl,
} from '@/lib/billing/invoice-payment-url';

export const dynamic = 'force-dynamic';

const INVOICE_NOT_FOUND = 'Invoice not found.';

type InvoicePayRow = {
  id?: string | number;
  status?: string | null;
  invoice_data?: unknown;
};

export type InvoicePayStatusDeps = {
  hasServiceRole?: () => boolean;
  loadInvoice?: (id: string) => Promise<{
    data: InvoicePayRow | null;
    error: { message?: string } | null;
  }>;
};

/**
 * Public payment-page status. The email links here instead of Stripe.
 * A matching checkout session is required before a live pay URL or a voided
 * state is returned. The pay URL must be an allowed Stripe Checkout URL.
 */
export async function GET(req: NextRequest) {
  return runInvoicePayStatus(req);
}

export async function runInvoicePayStatus(req: NextRequest, deps: InvoicePayStatusDeps = {}) {
  const id = String(req.nextUrl.searchParams.get('id') || '').trim();
  const session = String(req.nextUrl.searchParams.get('session') || '').trim();
  if (!id) return NextResponse.json({ error: 'Invoice id is required.' }, { status: 400 });
  const serviceReady = deps.hasServiceRole ?? hasServiceRole;
  if (!serviceReady()) {
    return NextResponse.json({ error: 'Payment status is unavailable.' }, { status: 503 });
  }

  const load = deps.loadInvoice ?? loadInvoicePayRow;
  const { data, error } = await load(id);
  if (error || !data) return invoiceNotFound();

  if (!session || !sessionMatchesInvoice(data.invoice_data, session)) {
    return invoiceNotFound();
  }

  const dataRecord = parseInvoiceData(data.invoice_data);
  if (isVoidInvoiceStatus(data.status) || dataRecord.voided === true) {
    return NextResponse.json({ voided: true, message: VOIDED_INVOICE_MESSAGE });
  }
  const paymentUrl = allowedInvoicePaymentUrl(dataRecord.payment_url);
  if (!paymentUrl) {
    return NextResponse.json({
      voided: false,
      payable: false,
      message: INVOICE_PAYMENT_LINK_UNAVAILABLE,
    });
  }
  return NextResponse.json({ voided: false, payable: true, paymentUrl });
}

function invoiceNotFound() {
  return NextResponse.json({ error: INVOICE_NOT_FOUND }, { status: 404 });
}

async function loadInvoicePayRow(id: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('service_invoices')
    .select('id, status, invoice_data')
    .eq('id', id)
    .maybeSingle();
  return { data, error };
}
