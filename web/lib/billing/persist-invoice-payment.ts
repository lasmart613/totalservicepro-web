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

/**
 * HTTP status Stripe should see for an invoice-checkout failure.
 *
 * 500 is only for a failure a later delivery might clear:
 * load_failed, update_failed, payment_claim_unavailable, claim_conflict,
 * and invoice_not_found. invoice_not_found stays 500 because the id comes
 * from the Checkout session and the row can be missing briefly (the send
 * has not committed, or a read replica has not caught up). A session that
 * will never match an invoice retries until Stripe stops; that is preferred
 * to dropping a payment that arrives early.
 *
 * Anything that cannot succeed on retry is 200, including a void, a
 * different session on a paid invoice, and an overpayment that was recorded
 * and not credited. not_invoice_checkout is null so the subscription
 * handler can still run.
 */
export const INVOICE_PAY_WEBHOOK_STATUS = {
  load_failed: 500,
  update_failed: 500,
  payment_claim_unavailable: 500,
  claim_conflict: 500,
  invoice_not_found: 500,
  invoice_void: 200,
  different_paid_session: 200,
  overpaid_not_credited: 200,
  possibly_already_credited: 200,
  amount_exceeds_balance: 200,
  not_paid: 200,
  not_complete: 200,
  no_payment_required: 200,
  currency_mismatch: 200,
  missing_invoice_id: 200,
  invoice_mismatch: 200,
  bad_amount: 200,
  bad_session_id: 200,
} as const;

/** Prod notifications_type_check. Invoice notices must use one of these. */
export const NOTIFICATION_TYPE_ALLOWLIST = [
  'thread_reply',
  'post_reply',
  'answer_accepted',
  'mention',
  'reaction',
  'ticket_assigned',
  'ticket_updated',
  'ticket_scheduled',
  'listing_offer',
  'offer_accepted',
  'offer_declined',
  'bid_accepted',
  'bid_declined',
  'general',
  'system',
] as const;

export const INVOICE_NOTIFICATION_TYPE = 'general' as const;

/**
 * Turn a Postgres/PostgREST failure into a retryable reason. A recognized
 * invoice reason is left unchanged. Raw driver text must not reach Stripe as
 * its own reason, or a lock timeout would be treated as permanent.
 */
export function classifyInvoicePayFailure(reason: string): string {
  const text = String(reason || '').trim();
  if (!text) return 'update_failed';
  if (text in INVOICE_PAY_WEBHOOK_STATUS) return text;
  if (/could not find the function|schema cache|PGRST202|does not exist/i.test(text)) {
    return 'payment_claim_unavailable';
  }
  if (/could not connect|connection terminated|connection reset|ECONN|too many clients|timeout|57014|55P03/i.test(text) && /select|load invoice/i.test(text)) {
    return 'load_failed';
  }
  if (
    /lock timeout|deadlock detected|canceling statement|could not obtain lock|40P01|55P03|57014|connection terminated|connection reset|could not connect|ECONN|too many clients/i.test(
      text
    )
  ) {
    return 'update_failed';
  }
  return text;
}

export function invoiceCheckoutWebhookResult(
  reason: string
): { status: 200 | 500; body: Record<string, unknown> } | null {
  if (reason === 'not_invoice_checkout') return null;
  const classified = classifyInvoicePayFailure(reason);
  const known = (INVOICE_PAY_WEBHOOK_STATUS as Record<string, 200 | 500>)[classified];
  // Unknown reasons stay on 500 so Stripe retries. Only the explicit list is 200.
  const status = known ?? 500;
  if (status === 500) return { status, body: { error: classified } };
  return { status: 200, body: { ok: true, ignored: classified, kind: 'invoice' } };
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
  overpaid?: boolean;
  notify?: boolean;
  reason?: string;
  status?: string;
  amount_paid?: number | string;
  session_amount?: number | string;
  balance_due?: number | string;
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
    console.warn('[billing] invoice payment claim failed', error.message);
    return { ok: false, reason: classifyInvoicePayFailure(error.message || 'update_failed') };
  }
  const claim = readClaim(data);
  if (claim?.ok === true && claim.reason === 'possibly_already_credited') {
    console.warn('[billing] Checkout session may already have been credited; not applied again', {
      invoiceId,
      sessionId,
    });
    return { ok: false, reason: 'possibly_already_credited' };
  }
  if (claim?.ok === true && claim.overpaid) {
    if (claim.notify) {
      await notifyShopOfPayment(
        input.writer,
        row,
        String(claim.status || row.status || 'sent'),
        money2(Number(claim.session_amount) || amountCents / 100),
        'overpaid',
        money2(Number(claim.balance_due) || 0)
      );
    }
    return { ok: false, reason: 'overpaid_not_credited' };
  }
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
  if (error) {
    console.warn('[billing] invoice payment load failed', error.message);
    return { ok: false, reason: 'load_failed' };
  }
  if (!data) return { ok: false, reason: 'invoice_not_found' };
  return { ok: true, row: data as InvoicePaymentRow };
}

export async function notifyShopOfPayment(
  writer: SupabaseClient,
  inv: InvoicePaymentRow,
  status: string,
  amountPaid: number,
  notice: 'payment' | 'overpaid' = 'payment',
  balanceDue = 0
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
  let balanceShown = formatOrgMoney(money2(balanceDue));
  try {
    const prefs = await loadOrgMoneyPrefs(writer, inv.organization_id);
    shown = formatOrgMoney(money2(amountPaid), prefs);
    balanceShown = formatOrgMoney(money2(balanceDue), prefs);
  } catch {
    /* USD locale format */
  }
  const message =
    notice === 'overpaid'
      ? `Overpayment on invoice ${num} needs a manual refund. ${who} sent ${shown}, which is more than the balance due (${balanceShown}). It was not applied.`
      : `Invoice ${num} paid ${shown}. ${who} ${label}.`;
  const link = `/invoices/new?id=${inv.id}`;
  for (const userId of ids) {
    try {
      const row: Record<string, unknown> = {
        user_id: userId,
        type: INVOICE_NOTIFICATION_TYPE,
        message,
        is_read: false,
        link,
      };
      let { error } = await writer.from('notifications').insert(row);
      if (error && /column|schema/i.test(error.message || '')) {
        delete row.link;
        ({ error } = await writer.from('notifications').insert(row));
      }
      if (error) console.warn('invoice pay notify', error.message || error);
    } catch (e) {
      console.warn('invoice pay notify', e);
    }
  }
}
