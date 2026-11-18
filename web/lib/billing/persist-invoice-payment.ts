/**
 * Write a payment onto service_invoices and notify the shop.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  alreadyAppliedSession,
  buildInvoicePaymentPatch,
  checkoutBelongsToInvoice,
  checkoutLooksLikeInvoicePay,
  invoiceFullyPaid,
  invoiceSessionClaimFilter,
  invoiceSessionCreditFilter,
  invoiceSessionEqualsFilter,
  money2,
  parseInvoiceData,
  type InvoicePaymentPatch,
  type InvoicePaymentRow,
} from './apply-invoice-payment.ts';
import type { StripeObject } from './stripe-subscription.ts';
import { formatOrgMoney } from '../money-format.ts';
import { loadOrgMoneyPrefs } from '../org-money.ts';
import { invoicePayoutRecord } from './stripe-connect.ts';
import { flagVoidInvoicePayment, isVoidInvoiceStatus } from './void-invoice.ts';

export type AppliedInvoicePayment = {
  invoiceId: string;
  status: string;
  amountPaid: number;
  alreadyApplied: boolean;
};

/** Stored on invoice_data when a second paid session arrives after the invoice is paid. */
export const STRIPE_PAYMENT_CONFLICT_KEY = 'stripe_payment_conflict';

function meta(session: StripeObject): Record<string, string> {
  const m = session.metadata;
  if (!m || typeof m !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v != null) out[k] = String(v);
  }
  return out;
}

function appliedResult(row: InvoicePaymentRow, alreadyApplied: boolean): AppliedInvoicePayment {
  return {
    invoiceId: String(row.id),
    status: String(row.status || 'paid'),
    amountPaid: money2(Number(row.amount_paid) || 0),
    alreadyApplied,
  };
}

function paymentPatch(
  row: InvoicePaymentRow,
  amountCents: number,
  sessionId: string,
  metadata: Record<string, string>
): InvoicePaymentPatch {
  const patch = buildInvoicePaymentPatch({
    invoice: row,
    addAmount: amountCents / 100,
    method: 'Stripe',
    sessionId,
  });
  Object.assign(patch.invoice_data, invoicePayoutRecord(metadata));
  return patch;
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

  const amountCents = Number(session.amount_total);
  if (!Number.isFinite(amountCents) || amountCents < 50) return { ok: false, reason: 'bad_amount' };

  const loaded = await loadInvoice(input.writer, invoiceId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (String(row.id) !== invoiceId) return { ok: false, reason: 'invoice_mismatch' };

  if (isVoidInvoiceStatus(row.status)) {
    const flagged = flagVoidInvoicePayment(row.invoice_data, {
      sessionId,
      amount: amountCents / 100,
    });
    await input.writer
      .from('service_invoices')
      .update({ invoice_data: flagged })
      .eq('id', invoiceId)
      .select('id')
      .maybeSingle();
    return { ok: false, reason: 'invoice_void' };
  }
  if (alreadyAppliedSession(row, sessionId)) {
    return { ok: true, applied: appliedResult(row, true) };
  }

  const patch = paymentPatch(row, amountCents, sessionId, m);
  const claim = await claimInvoicePayment(
    input.writer,
    invoiceId,
    patch,
    sessionId,
    invoiceSessionCreditFilter(sessionId)
  );
  if (!claim.ok) return claim;
  if (claim.claimed) {
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

  const freshLoad = await loadInvoice(input.writer, invoiceId);
  if (!freshLoad.ok) return freshLoad;
  const fresh = freshLoad.row;
  if (alreadyAppliedSession(fresh, sessionId)) {
    return { ok: true, applied: appliedResult(fresh, true) };
  }

  const currentSession = String(fresh.stripe_session_id || '').trim();
  if (!currentSession) return { ok: false, reason: 'claim_conflict' };
  if (invoiceFullyPaid(fresh)) {
    await flagDifferentPaidSession(input.writer, fresh, sessionId);
    return { ok: false, reason: 'different_paid_session' };
  }

  const casFilter = invoiceSessionEqualsFilter(currentSession);
  if (!casFilter) {
    console.warn('[billing] invoice payment not applied; credited session id is not filter-safe', {
      invoiceId,
      sessionId,
    });
    return { ok: false, reason: 'claim_conflict' };
  }
  const balancePatch = paymentPatch(fresh, amountCents, sessionId, m);
  const cas = await claimInvoicePayment(input.writer, invoiceId, balancePatch, sessionId, casFilter);
  if (!cas.ok) return cas;
  if (cas.claimed) {
    await notifyShopOfPayment(input.writer, fresh, balancePatch.status, balancePatch.amount_paid);
    return {
      ok: true,
      applied: {
        invoiceId,
        status: balancePatch.status,
        amountPaid: balancePatch.amount_paid,
        alreadyApplied: false,
      },
    };
  }

  const again = await loadInvoice(input.writer, invoiceId);
  if (!again.ok) return again;
  if (alreadyAppliedSession(again.row, sessionId)) {
    return { ok: true, applied: appliedResult(again.row, true) };
  }
  if (invoiceFullyPaid(again.row)) {
    await flagDifferentPaidSession(input.writer, again.row, sessionId);
    return { ok: false, reason: 'different_paid_session' };
  }
  return { ok: false, reason: 'claim_conflict' };
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

/**
 * Log and record a paid Checkout session that must not credit an invoice
 * another session already paid in full. Does not change amount_paid,
 * status, or stripe_session_id.
 */
async function flagDifferentPaidSession(
  writer: SupabaseClient,
  inv: InvoicePaymentRow,
  sessionId: string
): Promise<void> {
  const creditedSessionId = String(inv.stripe_session_id || '').trim() || null;
  console.warn('[billing] paid Checkout session was not applied; invoice already credited to a different session', {
    invoiceId: String(inv.id),
    sessionId,
    creditedSessionId,
  });
  const data = parseInvoiceData(inv.invoice_data);
  const previous = data[STRIPE_PAYMENT_CONFLICT_KEY];
  const same =
    previous &&
    typeof previous === 'object' &&
    String((previous as { sessionId?: string }).sessionId || '') === sessionId;
  if (!same) {
    data[STRIPE_PAYMENT_CONFLICT_KEY] = {
      sessionId,
      creditedSessionId,
      at: new Date().toISOString(),
    };
  }
  try {
    const { error } = await writer
      .from('service_invoices')
      .update({ invoice_data: data, updated_at: new Date().toISOString() })
      .eq('id', inv.id)
      .select('id')
      .maybeSingle();
    if (error) console.warn('[billing] could not flag conflicting Checkout session', error.message);
  } catch (e) {
    console.warn('[billing] could not flag conflicting Checkout session', e);
  }
}

/**
 * One session credits once. The conditional update returns a row only for the
 * delivery that claimed stripe_session_id. Overlapping deliveries of the same
 * session get no row and must not notify or add the amount again.
 * The credit filter is stripe_session_id IS NULL. A same-session retry is
 * success on the follow-up read. A different session does not match this
 * filter. If the column is not migrated yet, fall back to a plain update.
 */
async function claimInvoicePayment(
  writer: SupabaseClient,
  invoiceId: string,
  patch: InvoicePaymentPatch,
  sessionId: string,
  filter: string | null
): Promise<{ ok: true; claimed: boolean } | { ok: false; reason: string }> {
  const safe = invoiceSessionClaimFilter(sessionId);
  const payload: Record<string, unknown> = {
    ...patch,
    ...(safe ? { stripe_session_id: sessionId } : {}),
  };
  let activeFilter = safe ? filter : null;
  let lastErr: { message?: string } | null = null;

  for (let i = 0; i < 8; i++) {
    let query = writer.from('service_invoices').update(payload).eq('id', invoiceId);
    if (activeFilter) query = query.or(activeFilter);
    const { data, error } = await query.select('id').maybeSingle();
    if (!error) {
      if (activeFilter && !data) return { ok: true, claimed: false };
      return { ok: true, claimed: true };
    }
    lastErr = error;
    const col = error.message?.match(/Could not find the '([^']+)' column/i)?.[1];
    if (col === 'stripe_session_id') {
      delete payload.stripe_session_id;
      activeFilter = null;
      continue;
    }
    if (col && col in payload) {
      delete payload[col];
      continue;
    }
    break;
  }
  return { ok: false, reason: lastErr?.message || 'update_failed' };
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
