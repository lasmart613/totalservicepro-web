/**
 * Write a payment onto service_invoices and notify the shop.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkoutBelongsToInvoice,
  checkoutLooksLikeInvoicePay,
  invoiceSessionClaimFilter,
  money2,
  parseInvoiceData,
  type InvoicePaymentRow,
} from './apply-invoice-payment.ts';
import { checkoutCurrencyCode, currencyMajorScale, fromStripeMinorUnits, loadChargeCurrency } from './stripe-currency.ts';
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
  amount_mismatch: 200,
  charge_mismatch: 200,
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
  if (classified === 'currency_mismatch' || classified === 'amount_mismatch' || classified === 'charge_mismatch') {
    return { status: 200, body: { ok: true, review: classified, kind: 'invoice' } };
  }
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

type StoredCharge =
  | { kind: 'absent' }
  | { kind: 'ready'; currency: string; minor: number }
  | { kind: 'unusable' };

function metadataHasCharge(metadata: Record<string, string>): boolean {
  return String(metadata.charge_currency || '').trim() !== '' || String(metadata.charge_amount_minor || '').trim() !== '';
}

function positiveInteger(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Charge saved when the Checkout session was created.
 * Session metadata is the trusted copy. invoice_data is only for an older
 * session that has no charge metadata. A member edit of payment_amount_minor
 * does not override metadata, including after a link is re-issued.
 */
export function readStoredCheckoutCharge(
  metadata: Record<string, string>,
  invoiceData: unknown
): StoredCharge {
  if (metadataHasCharge(metadata)) {
    const metaCurrency = checkoutCurrencyCode(metadata.charge_currency);
    const metaMinor = positiveInteger(metadata.charge_amount_minor);
    if (metaCurrency && metaMinor) return { kind: 'ready', currency: metaCurrency, minor: metaMinor };
    return { kind: 'unusable' };
  }
  const data = parseInvoiceData(invoiceData);
  const dataCurrency = checkoutCurrencyCode(data.payment_currency);
  const dataMinor = positiveInteger(data.payment_amount_minor);
  if (dataCurrency && dataMinor) return { kind: 'ready', currency: dataCurrency, minor: dataMinor };
  return { kind: 'absent' };
}

async function recordedCheckoutSession(
  writer: SupabaseClient,
  sessionId: string
): Promise<{ invoiceId: string; outcome: string } | null> {
  const { data, error } = await writer
    .from('service_invoice_stripe_payments')
    .select('invoice_id, outcome')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error || !data) return null;
  const invoiceId = data.invoice_id == null ? '' : String(data.invoice_id);
  if (!invoiceId) return null;
  return { invoiceId, outcome: String(data.outcome || 'credited') };
}

async function recordChargeMismatch(
  writer: SupabaseClient,
  row: InvoicePaymentRow,
  sessionId: string,
  reason: 'currency_mismatch' | 'amount_mismatch',
  detail: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // A conflict marker can be saved before the payments insert. The payments
  // row is what means this session was already handled. A retry after a
  // failed insert must still insert and notify.
  const recorded = await recordedCheckoutSession(writer, sessionId);
  if (recorded) {
    if (recorded.invoiceId !== String(row.id)) return { ok: false, reason: 'invoice_mismatch' };
    return { ok: true };
  }

  const data = parseInvoiceData(row.invoice_data);
  const existing = data[STRIPE_PAYMENT_CONFLICT_KEY];
  const list = Array.isArray(existing) ? [...existing] : existing ? [existing] : [];
  const seen = list.some(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      String((entry as { sessionId?: unknown }).sessionId || '') === sessionId &&
      String((entry as { reason?: unknown }).reason || '') === reason
  );
  if (!seen) {
    list.push({ reason, sessionId, at: new Date().toISOString(), ...detail });
    data[STRIPE_PAYMENT_CONFLICT_KEY] = list;
    const { error } = await writer
      .from('service_invoices')
      .update({ invoice_data: data })
      .eq('id', row.id)
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, reason: classifyInvoicePayFailure(error.message || 'update_failed') };
  }
  const amount = Number(detail.amount);
  const { error: payErr } = await writer.from('service_invoice_stripe_payments').insert({
    invoice_id: row.id,
    session_id: sessionId,
    amount: Number.isFinite(amount) ? amount : 0,
    outcome: 'charge_mismatch',
  });
  if (payErr) {
    if (/duplicate|unique|23505/i.test(payErr.message || '')) return { ok: true };
    return { ok: false, reason: classifyInvoicePayFailure(payErr.message || 'update_failed') };
  }
  await notifyShopOfPayment(
    writer,
    row,
    String(row.status || 'sent'),
    Number.isFinite(amount) ? amount : 0,
    'charge_mismatch'
  );
  return { ok: true };
}

export async function applyInvoiceCheckoutSession(input: {
  writer: SupabaseClient;
  session: StripeObject;
}): Promise<{ ok: true; applied: AppliedInvoicePayment } | { ok: false; reason: string }> {
  const session = input.session;
  if (!checkoutLooksLikeInvoicePay(session)) return { ok: false, reason: 'not_invoice_checkout' };
  const paymentStatus = String(session.payment_status || '');
  const m = meta(session);
  const earlyId = String(m.invoice_id || session.client_reference_id || '').trim();
  const earlySession = String(session.id || '').trim();
  // A Checkout session with no charge is not a payment. It is logged and not
  // credited, and it is not written as a review row. Stripe should not retry it.
  if (paymentStatus === 'no_payment_required') {
    console.warn('[billing] invoice checkout has no_payment_required; not credited', {
      invoiceId: earlyId,
      sessionId: earlySession,
    });
    return { ok: false, reason: 'no_payment_required' };
  }
  if (paymentStatus !== 'paid') return { ok: false, reason: 'not_paid' };
  if (String(session.status || '') !== 'complete') return { ok: false, reason: 'not_complete' };

  const target = checkoutBelongsToInvoice({ metadata: m, client_reference_id: session.client_reference_id });
  if (!target.ok) return target;
  const invoiceId = target.invoiceId;

  const sessionId = String(session.id || '').trim();
  if (!invoiceSessionClaimFilter(sessionId)) return { ok: false, reason: 'bad_session_id' };
  const invoiceIdNum = Number(invoiceId);
  if (!Number.isSafeInteger(invoiceIdNum)) return { ok: false, reason: 'invoice_mismatch' };

  const loaded = await loadInvoice(input.writer, invoiceId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (String(row.id) !== invoiceId) return { ok: false, reason: 'invoice_mismatch' };

  const recorded = await recordedCheckoutSession(input.writer, sessionId);
  if (recorded) {
    if (recorded.invoiceId !== String(row.id) && recorded.invoiceId !== invoiceId) {
      return { ok: false, reason: 'invoice_mismatch' };
    }
    if (recorded.outcome === 'credited') {
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
    if (
      recorded.outcome === 'overpaid_not_credited' ||
      recorded.outcome === 'possibly_already_credited' ||
      recorded.outcome === 'charge_mismatch'
    ) {
      return { ok: false, reason: recorded.outcome };
    }
  }

  const sessionCurrency = checkoutCurrencyCode(session.currency) || (session.currency ? null : 'usd');
  const amountTotal = Number(session.amount_total);
  const stored = readStoredCheckoutCharge(m, row.invoice_data);
  let mismatch: 'currency_mismatch' | 'amount_mismatch' | null = null;
  if (!sessionCurrency) {
    mismatch = 'currency_mismatch';
  } else if (!Number.isInteger(amountTotal) || amountTotal <= 0) {
    mismatch = 'amount_mismatch';
  } else if (stored.kind === 'unusable') {
    mismatch = String(m.charge_amount_minor || '').trim() === '' ? 'amount_mismatch' : 'currency_mismatch';
  } else if (stored.kind === 'ready') {
    if (sessionCurrency !== stored.currency) mismatch = 'currency_mismatch';
    else if (amountTotal !== stored.minor) mismatch = 'amount_mismatch';
  } else {
    const orgCurrency = await loadChargeCurrency(input.writer, row.organization_id);
    const expected = orgCurrency.ok ? orgCurrency.currency : null;
    if (!expected || sessionCurrency !== expected) mismatch = 'currency_mismatch';
  }
  const chargeCurrency = sessionCurrency || 'usd';
  const majorAmount = Number.isInteger(amountTotal)
    ? fromStripeMinorUnits(amountTotal, chargeCurrency)
    : Number.NaN;
  if (mismatch) {
    console.error('[billing] invoice payment not credited', {
      reason: mismatch,
      invoiceId,
      sessionId,
      sessionCurrency: sessionCurrency || String(session.currency ?? ''),
      amountTotal,
      stored,
    });
    const recordedReview = await recordChargeMismatch(input.writer, row, sessionId, mismatch, {
      sessionCurrency: sessionCurrency || String(session.currency ?? ''),
      amountTotal: Number.isFinite(amountTotal) ? amountTotal : null,
      amount: Number.isFinite(majorAmount) ? majorAmount : 0,
    });
    if (!recordedReview.ok) return recordedReview;
    return { ok: false, reason: mismatch };
  }

  const roundedMajor = Number(majorAmount.toFixed(currencyMajorScale(chargeCurrency)));
  const { data, error } = await input.writer.rpc('apply_service_invoice_stripe_payment', {
    p_invoice_id: invoiceIdNum,
    p_session_id: sessionId,
    p_amount: roundedMajor,
    p_currency: chargeCurrency,
    p_extra: invoicePayoutRecord(m),
  });
  if (error) {
    console.warn('[billing] invoice payment claim failed', error.message);
    return { ok: false, reason: classifyInvoicePayFailure(error.message || 'update_failed') };
  }
  const claim = readClaim(data);
  const sessionAmount = money2(Number(claim?.session_amount) || roundedMajor);
  if (claim?.ok === true && claim.reason === 'possibly_already_credited') {
    console.warn('[billing] Checkout session may already have been credited; not applied again', {
      invoiceId,
      sessionId,
    });
    if (claim.notify) {
      await notifyShopOfPayment(input.writer, row, String(claim.status || row.status || 'sent'), sessionAmount, 'verify');
    }
    return { ok: false, reason: 'possibly_already_credited' };
  }
  if (claim?.ok === true && claim.overpaid) {
    if (claim.notify) {
      await notifyShopOfPayment(
        input.writer,
        row,
        String(claim.status || row.status || 'sent'),
        sessionAmount,
        'overpaid',
        money2(Number(claim.balance_due) || 0)
      );
    }
    return { ok: false, reason: 'overpaid_not_credited' };
  }
  if (!claim || claim.ok !== true) {
    const reason = String(claim?.reason || 'update_failed');
    if (reason === 'currency_mismatch' || reason === 'amount_mismatch' || reason === 'charge_mismatch') {
      console.error('[billing] invoice payment not credited', { reason, invoiceId, sessionId });
      if (claim?.notify) {
        await notifyShopOfPayment(input.writer, row, String(row.status || 'sent'), sessionAmount, 'charge_mismatch');
      }
      return { ok: false, reason };
    }
    if (reason === 'different_paid_session') {
      console.warn('[billing] paid Checkout session was not applied; invoice already credited to a different session', {
        invoiceId,
        sessionId,
      });
      if (claim?.notify) {
        await notifyShopOfPayment(input.writer, row, String(row.status || 'paid'), sessionAmount, 'verify');
      }
    }
    return { ok: false, reason };
  }

  const status = String(claim.status || row.status || 'paid');
  const amountPaid = money2(Number(claim.amount_paid) || 0);
  if (claim.claimed) {
    await notifyShopOfPayment(input.writer, row, status, roundedMajor, 'payment', 0, {
      paid: amountPaid,
      total: money2(Number(row.total) || 0),
    });
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

const INVOICE_NOTICE_ROLES = ['admin', 'company_admin', 'owner'] as const;

export async function notifyShopOfPayment(
  writer: SupabaseClient,
  inv: InvoicePaymentRow,
  _status: string,
  amount: number,
  notice: 'payment' | 'overpaid' | 'verify' | 'charge_mismatch' = 'payment',
  balanceDue = 0,
  ledger?: { paid?: number; total?: number }
): Promise<void> {
  const ids: string[] = [];
  if (inv.organization_id != null) {
    try {
      const { data: members, error } = await writer
        .from('organization_memberships')
        .select('user_id, role')
        .eq('organization_id', inv.organization_id)
        .or(INVOICE_NOTICE_ROLES.map((role) => `role.ilike.${role}`).join(','))
        .order('user_id', { ascending: true })
        .limit(100);
      if (error) throw new Error(error.message || 'membership roster');
      const seen = new Set<string>();
      for (const member of members || []) {
        const role = String(member.role || '').toLowerCase();
        const userId = String(member.user_id || '');
        if (!userId || seen.has(userId)) continue;
        if (!(INVOICE_NOTICE_ROLES as readonly string[]).includes(role)) continue;
        seen.add(userId);
        ids.push(userId);
      }
      ids.sort();
    } catch (e) {
      console.warn('invoice pay notify roster', e);
    }
  }
  const num = inv.invoice_number || `#${inv.id}`;
  const who = inv.customer_name || 'A customer';
  let shown = formatOrgMoney(money2(amount));
  let balanceShown = formatOrgMoney(money2(balanceDue));
  let paidShown = formatOrgMoney(money2(ledger?.paid ?? amount));
  let totalShown = formatOrgMoney(money2(ledger?.total ?? (Number(inv.total) || 0)));
  try {
    const prefs = await loadOrgMoneyPrefs(writer, inv.organization_id);
    shown = formatOrgMoney(money2(amount), prefs);
    balanceShown = formatOrgMoney(money2(balanceDue), prefs);
    paidShown = formatOrgMoney(money2(ledger?.paid ?? amount), prefs);
    totalShown = formatOrgMoney(money2(ledger?.total ?? (Number(inv.total) || 0)), prefs);
  } catch {
    /* USD locale format */
  }
  const message =
    notice === 'overpaid'
      ? `Overpayment on invoice ${num} needs a manual refund. ${who} sent ${shown}, which is more than the balance due (${balanceShown}). It was not applied.`
      : notice === 'verify'
        ? `Check Stripe: invoice ${num} may have been paid twice.`
        : notice === 'charge_mismatch'
          ? `Invoice ${num}: A payment came in that doesn't match this invoice's amount or currency. We didn't apply it. Please check it in Stripe before crediting the invoice.`
          : `${shown} payment received on invoice ${num} (${paidShown} of ${totalShown} paid).`;
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
