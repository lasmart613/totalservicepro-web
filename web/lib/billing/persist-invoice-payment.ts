/**
 * Write a payment onto service_invoices and notify the shop.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  alreadyAppliedSession,
  buildInvoicePaymentPatch,
  checkoutLooksLikeInvoicePay,
  money2,
  type InvoicePaymentRow,
} from './apply-invoice-payment.ts';
import type { StripeObject } from './stripe-subscription.ts';

export type AppliedInvoicePayment = {
  invoiceId: string;
  status: string;
  amountPaid: number;
  alreadyApplied: boolean;
};

function meta(session: StripeObject): Record<string, string> {
  const m = session.metadata;
  if (!m || typeof m !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v != null) out[k] = String(v);
  }
  return out;
}

export async function applyInvoiceCheckoutSession(input: {
  writer: SupabaseClient;
  session: StripeObject;
}): Promise<{ ok: true; applied: AppliedInvoicePayment } | { ok: false; reason: string }> {
  const session = input.session;
  if (!checkoutLooksLikeInvoicePay(session)) return { ok: false, reason: 'not_invoice_checkout' };
  if (String(session.status || '') !== 'complete') return { ok: false, reason: 'not_complete' };
  const pay = String(session.payment_status || '');
  if (pay && pay !== 'paid' && pay !== 'no_payment_required') return { ok: false, reason: 'not_paid' };

  const m = meta(session);
  const invoiceId = String(m.invoice_id || '').trim();
  if (!invoiceId) return { ok: false, reason: 'missing_invoice_id' };

  const sessionId = String(session.id || '').trim();
  const amountCents = Number(session.amount_total);
  if (!Number.isFinite(amountCents) || amountCents < 50) return { ok: false, reason: 'bad_amount' };

  const { data: inv, error } = await input.writer
    .from('service_invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message || 'load_failed' };
  if (!inv) return { ok: false, reason: 'invoice_not_found' };

  const row = inv as InvoicePaymentRow;
  if (sessionId && alreadyAppliedSession(row, sessionId)) {
    return {
      ok: true,
      applied: {
        invoiceId,
        status: String(row.status || 'paid'),
        amountPaid: money2(Number(row.amount_paid) || 0),
        alreadyApplied: true,
      },
    };
  }

  const patch = buildInvoicePaymentPatch({
    invoice: row,
    addAmount: amountCents / 100,
    method: 'Stripe',
    sessionId,
  });

  let payload: Record<string, unknown> = { ...patch };
  let lastErr: { message?: string } | null = null;
  for (let i = 0; i < 8; i++) {
    const { error: upErr } = await input.writer.from('service_invoices').update(payload).eq('id', invoiceId);
    if (!upErr) {
      lastErr = null;
      break;
    }
    lastErr = upErr;
    const col = upErr.message?.match(/Could not find the '([^']+)' column/i)?.[1];
    if (col && col in payload) {
      delete payload[col];
      continue;
    }
    break;
  }
  if (lastErr) return { ok: false, reason: lastErr.message || 'update_failed' };

  await notifyShopOfPayment(input.writer, row, patch.status, patch.amount_paid);

  return {
    ok: true,
    applied: {
      invoiceId,
      status: patch.status,
      amountPaid: patch.amount_paid,
      alreadyApplied: false,
    },
  };
}

export async function notifyShopOfPayment(
  writer: SupabaseClient,
  inv: InvoicePaymentRow,
  status: string,
  amountPaid: number
): Promise<void> {
  const ids = new Set<string>();
  if (inv.created_by) ids.add(String(inv.created_by));
  if (inv.organization_id != null) {
    try {
      const { data: profiles } = await writer
        .from('user_profiles')
        .select('id, role, organization_id, active_organization_id')
        .or(`organization_id.eq.${inv.organization_id},active_organization_id.eq.${inv.organization_id}`)
        .limit(30);
      for (const p of profiles || []) {
        const role = String(p.role || '').toLowerCase();
        if (['admin', 'company_admin', 'billing_manager', 'service_manager'].includes(role)) {
          ids.add(String(p.id));
        }
      }
    } catch (e) {
      console.warn('invoice pay notify roster', e);
    }
  }
  const num = inv.invoice_number || `#${inv.id}`;
  const who = inv.customer_name || 'A customer';
  const label = status === 'paid' ? 'paid in full' : 'sent a partial payment';
  const message = `${who} ${label} on invoice ${num} ($${money2(amountPaid).toFixed(2)}).`;
  const link = `/invoices/new?id=${inv.id}`;
  for (const userId of ids) {
    try {
      let row: Record<string, unknown> = {
        user_id: userId,
        type: 'invoice_paid',
        message,
        is_read: false,
        link,
      };
      let { error } = await writer.from('notifications').insert(row);
      if (error && /column|schema/i.test(error.message || '')) {
        delete row.link;
        ({ error } = await writer.from('notifications').insert(row));
      }
      if (error) console.warn('invoice pay notify', error.message);
    } catch (e) {
      console.warn('invoice pay notify', e);
    }
  }
}
