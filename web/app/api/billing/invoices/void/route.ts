import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { loadInvoiceRow } from '@/lib/billing/invoice-row-load';
import { expireCheckoutSession } from '@/lib/billing/stripe-pay';
import {
  documentOwnedByOrganization,
  loadOwnedDocument,
} from '@/lib/billing/owned-doc-mail';
import {
  buildVoidInvoicePatch,
  canVoidInvoice,
  checkoutSessionIds,
} from '@/lib/billing/void-invoice';

export const dynamic = 'force-dynamic';

/** Same body for a missing invoice and an invoice owned by another shop. */
const INVOICE_NOT_FOUND = 'Invoice not found.';

type VoidInvoiceDeps = {
  userClient?: SupabaseClient;
  adminClient?: SupabaseClient | null;
};

/**
 * POST /api/billing/invoices/void
 * Body: { invoice_id, reason? }
 * Admin or owner. Draft or sent, amount paid must be 0.
 * Expires an open Stripe Checkout Session. Does not charge or refund.
 */
export async function POST(req: NextRequest) {
  return runVoidInvoice(req);
}

export async function runVoidInvoice(req: NextRequest, deps: VoidInvoiceDeps = {}) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

    let supabase: SupabaseClient;
    if (deps.userClient) {
      supabase = deps.userClient;
    } else {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
      if (!url || !anon) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

      supabase = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();
    const callerOrgId = prof?.organization_id ?? null;

    const body = (await req.json().catch(() => ({}))) as { invoice_id?: unknown; reason?: unknown };
    const invoiceId = body.invoice_id;
    if (invoiceId == null || String(invoiceId).trim() === '') {
      return NextResponse.json({ error: 'Invoice id is required.' }, { status: 400 });
    }

    const admin =
      deps.adminClient !== undefined ? deps.adminClient : hasServiceRole() ? getSupabaseAdmin() : null;

    const loaded = await loadOwnedDocument({
      userClient: supabase,
      adminClient: admin,
      table: 'service_invoices',
      id: invoiceId as string | number,
      callerOrgId,
      readNarrow: async (client) => (await loadInvoiceRow(client, invoiceId as string | number)).row,
      notFoundError: INVOICE_NOT_FOUND,
    });
    if (!loaded.ok || !documentOwnedByOrganization(loaded.row, callerOrgId)) {
      return NextResponse.json({ error: INVOICE_NOT_FOUND }, { status: 404 });
    }
    const inv = loaded.row;

    const decision = canVoidInvoice({
      status: inv.status == null ? null : String(inv.status),
      amount_paid: inv.amount_paid as number | string | null,
      invoice_data: inv.invoice_data,
      role: prof?.role,
    });
    if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 });

    const sessions = checkoutSessionIds(inv.invoice_data);
    const expired: string[] = [];
    for (const sessionId of sessions) {
      const expiredSession = await expireCheckoutSession(sessionId);
      if (expiredSession.classification === 'completed') {
        return NextResponse.json(
          { error: 'This invoice has a completed checkout and cannot be voided.' },
          { status: 409 }
        );
      }
      if (expiredSession.classification === 'failed') {
        return NextResponse.json(
          { error: 'The open payment link could not be expired, so the invoice was not voided.' },
          { status: 502 }
        );
      }
      expired.push(sessionId);
    }

    const patch = buildVoidInvoicePatch({
      invoice: { invoice_data: inv.invoice_data },
      reason: body.reason,
      expiredSessionIds: expired,
    });

    const writer = admin ?? supabase;
    let payload: Record<string, unknown> = { ...patch };
    let lastError: { message?: string } | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const { error } = await writer.from('service_invoices').update(payload).eq('id', invoiceId);
      if (!error) {
        lastError = null;
        break;
      }
      lastError = error;
      const col = error.message?.match(/Could not find the '([^']+)' column/i)?.[1];
      if (col && col in payload) {
        delete payload[col];
        continue;
      }
      break;
    }
    if (lastError) {
      return NextResponse.json({ error: lastError.message || 'Could not void invoice.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      status: 'void',
      void_reason: patch.void_reason,
      voided_at: patch.voided_at,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not void invoice.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
