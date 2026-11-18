/**
 * Write a payment onto service_invoices and notify the shop.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkoutBelongsToInvoice,
  checkoutLooksLikeInvoicePay,
  invoiceSessionClaimFilter,
  money2,
  type InvoicePaymentRow,
} from './apply-invoice-payment.ts';
import type { StripeObject } from './stripe-subscription.ts';
import { formatOrgMoney } from '../money-format.ts';
import { loadOrgMoneyPrefs } from '../org-money.ts';
import { invoicePayoutRecord } from './stripe-connect.ts';

export type AppliedInvoicePayment = {
  invoiceId: string;
  status: string;
  amountPaid: number;
  alreadyApplied: boolean;
};

/**
 * Locked by draft #390's 000962 trigger: any invoice_data key whose name
 * starts with stripe_checkout_session. A signed-in client cannot change it.
 * The service-role claim function still can, because auth.uid() is null.
 */
export const STRIPE_PAYMENT_CONFLICT_KEY = 'stripe_checkout_session_conflict';

const INVOICE_PAY_ACK = new Set(['invoice_void', 'different_paid_session']);

/**
 * Webhook result for an invoice Checkout attempt. null means this session
 * is not an invoice payment and the subscription handler may run.
 * Every other failure is 500 so Stripe retries. Void and a different
 * session on an already-paid invoice are acknowledged.
 */
export function invoiceCheckoutWebhookResult(
  reason: string
): { status: 200 | 500; body: Record<string, unknown> } | null {
  if (reason === 'not_invoice_checkout') return null;
  if (INVOICE_PAY_ACK.has(reason)) {
    return {
      status: 200,
      body: {
        ok: true,
        ignored: reason,
        ...(reason === 'different_paid_session' ? { kind: 'invoice' } : {}),
      },
    };
  }
  return { status: 500, body: { error: reason } };
}

function meta(session: StripeObject): Record<string, string> {
  const m = session.metadata;
  if (!m || typeof m !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v != null) out[k] = String(v);
  }
  return out;
}

type PaymentClaim = {
  ok?: boolean;
  claimed?: boolean;
  reason?: string;
  status?: string;
  amount_paid?: number | string;
};

function readClaim(data: unknown): PaymentClaim | null {
  if (!data) return null;
  if (typeof data === 'string') {
    try {
      return readClaim(JSON.parse(data));
    } catch {
      return null;
    }
  }
  if (typeof data === 'object') return data as PaymentClaim;
  return null;
}

export async function applyInvoiceCheckoutSession(input: {
  writer: SupabaseClient;
  session: StripeObject;
}): Promise<{ ok: true; applied: AppliedInvoicePayment } | { ok: false; reason: string }> {
  const session = input.session;
  if (!checkoutLooksLikeInvoicePay(session)) return { ok: false, reason: 'not_invoice_checkout' };
  if (String(session.payment_status || '') !== 'paid') return { ok: false, reason: 'not_paid' };
  if (String(session.status || '') !== 'complete') return { ok: false, reason: 'not_complete' };

  const m = meta(session);
  const target = checkoutBelongsToInvoice({ metadata: m, client_reference_id: session.client_reference_id });
  if (!target.ok) return target;
  const invoiceId = target.invoiceId;

  const sessionId = String(session.id || '').trim();
  if (!invoiceSessionClaimFilter(sessionId)) return { ok: false, reason: 'bad_session_id' };

  const currency = String(session.currency || '').trim().toLowerCase();
  if (currency && currency !== 'usd') return { ok: false, reason: 'currency_mismatch' };

  const amountCents = Number(session.amount_total);
  if (!Number.isFinite(amountCents) || amountCents < 50) return { ok: false, reason: 'bad_amount' };
  const invoiceIdNum = Number(invoiceId);
  if (!Number.isSafeInteger(invoiceIdNum)) return { ok: false, reason: 'invoice_mismatch' };

  const loaded = await loadInvoice(input.writer, invoiceId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (String(row.id) !== invoiceId) return { ok: false, reason: 'invoice_mismatch' };

  const { data, error } = await input.writer.rpc('apply_service_invoice_stripe_payment', {
    p_invoice_id: invoiceIdNum,
    p_session_id: sessionId,
    p_amount: money2(amountCents / 100),
    p_currency: currency || null,
    p_extra: invoicePayoutRecord(m),
  });
  if (error) {
    const message = error.message || '';
    if (/could not find the function|schema cache|does not exist/i.test(message)) {
      return { ok: false, reason: 'payment_claim_unavailable' };
    }
    return { ok: false, reason: message || 'update_failed' };
  }
  const claim = readClaim(data);
  if (!claim || claim.ok !== true) {
    const reason = String(claim?.reason || 'update_failed');
    if (reason === 'different_paid_session') {
      console.warn('[billing] paid Checkout session was not applied; invoice already credited to a different session', {
        invoiceId,
        sessionId,
      });
    }
    return { ok: false, reason };
  }

  const status = String(claim.status || row.status || 'paid');
  const amountPaid = money2(Number(claim.amount_paid) || 0);
  if (claim.claimed) {
    await notifyShopOfPayment(input.writer, row, status, amountPaid);
  }
  return {
    ok: true,
    applied: {
      invoiceId,
      status,
      amountPaid,
      alreadyApplied: !claim.claimed,
    },
  };
}

async function loadInvoice(
  writer: SupabaseClient,
  invoiceId: string
): Promise<{ ok: true; row: InvoicePaymentRow } | { ok: false; reason: string }> {
  const { data, error } = await writer.from('service_invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (error) return { ok: false, reason: error.message || 'load_failed' };
  if (!data) return { ok: false, reason: 'invoice_not_found' };
  return { ok: true, row: data as InvoicePaymentRow };
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
  let shown = formatOrgMoney(money2(amountPaid));
  try {
    const prefs = await loadOrgMoneyPrefs(writer, inv.organization_id);
    shown = formatOrgMoney(money2(amountPaid), prefs);
  } catch {
    /* USD locale format */
  }
  const message = `${who} ${label} on invoice ${num} (${shown}).`;
  const link = `/invoices/new?id=${inv.id}`;
  for (const userId of ids) {
    try {
      const row: Record<string, unknown> = {
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
