/**
 * Decide whether send-invoice may open a Stripe Checkout session.
 * A paid invoice is not given a new session. An open session is reused.
 * Anything else is expired before a replacement is created, so two links
 * cannot both be payable.
 */
import { existingPaidAmount, money2, parseInvoiceData } from './apply-invoice-payment.ts';
import { expireCheckoutSession } from './stripe-pay.ts';
import { retrieveCheckoutSession } from './stripe-subscription.ts';
import type { CheckoutExpireClass } from './void-invoice.ts';

export const INVOICE_ALREADY_PAID = 'This invoice is already paid.';
export const INVOICE_CHECKOUT_ALREADY_PAID = 'This invoice already has a paid Checkout session.';
export const INVOICE_PAY_LINK_BUSY = 'The open payment link could not be replaced. Try again.';

const CHECKOUT_SESSION_ID = /^cs_(test|live)_[A-Za-z0-9_]+$/;

export type PayLinkInvoice = {
  id?: string | number | null;
  status?: string | null;
  total?: number | string | null;
  amount_paid?: number | string | null;
  invoice_data?: unknown;
  stripe_session_id?: string | null;
};

export type CheckoutSessionSnapshot = {
  status?: string | null;
  payment_status?: string | null;
  url?: string | null;
  amount_total?: number | null;
};

export type OpenPayLink = {
  sessionId: string;
  url: string;
  amount: number | null;
};

export type PayLinkPlan =
  | { action: 'reuse'; sessionId: string; url: string }
  | { action: 'create' }
  | { action: 'skip'; reason: string };

type LoadCheckout = (sessionId: string) => Promise<CheckoutSessionSnapshot | null>;
type ExpireCheckout = (sessionId: string) => Promise<CheckoutExpireClass>;

export function invoiceAlreadyPaid(inv: PayLinkInvoice): boolean {
  if (String(inv.status || '').trim().toLowerCase() === 'paid') return true;
  const total = money2(Number(inv.total) || 0);
  if (total <= 0) return false;
  const paid = existingPaidAmount({
    id: inv.id ?? 0,
    total: inv.total,
    amount_paid: inv.amount_paid,
    invoice_data: inv.invoice_data,
    stripe_session_id: inv.stripe_session_id,
  });
  return paid + 0.004 >= total;
}

/** The pay link stored when the invoice was sent. Not proof that anyone paid. */
export function openPayLink(invoiceData: unknown): OpenPayLink | null {
  const data = parseInvoiceData(invoiceData);
  const sessionId = String(data.stripe_checkout_session_id || '').trim();
  const url = String(data.payment_url || '').trim();
  if (!CHECKOUT_SESSION_ID.test(sessionId) || !url) return null;
  const amount = Number(data.payment_amount);
  return { sessionId, url, amount: Number.isFinite(amount) ? amount : null };
}

function sessionSettled(snapshot: CheckoutSessionSnapshot): boolean {
  if (String(snapshot.payment_status || '') === 'paid') return true;
  return String(snapshot.status || '') === 'complete';
}

function sessionOpen(snapshot: CheckoutSessionSnapshot): boolean {
  return String(snapshot.status || '') === 'open' && String(snapshot.payment_status || '') !== 'paid';
}

function sameCharge(payAmount: number, snapshot: CheckoutSessionSnapshot | null, storedAmount: number | null): boolean {
  if (snapshot && snapshot.amount_total != null && Number.isFinite(Number(snapshot.amount_total))) {
    return Math.round(Number(snapshot.amount_total)) === Math.round(payAmount * 100);
  }
  if (storedAmount != null && Number.isFinite(storedAmount)) {
    return Math.abs(storedAmount - payAmount) < 0.009;
  }
  return true;
}

async function defaultLoadCheckout(sessionId: string): Promise<CheckoutSessionSnapshot | null> {
  const session = await retrieveCheckoutSession(sessionId);
  return {
    status: typeof session.status === 'string' ? session.status : null,
    payment_status: typeof session.payment_status === 'string' ? session.payment_status : null,
    url: typeof session.url === 'string' ? session.url : null,
    amount_total: typeof session.amount_total === 'number' ? session.amount_total : null,
  };
}

async function defaultExpireCheckout(sessionId: string): Promise<CheckoutExpireClass> {
  const result = await expireCheckoutSession(sessionId);
  return result.classification;
}

export async function planInvoicePayLink(input: {
  invoice: PayLinkInvoice;
  payAmount: number;
  loadCheckout?: LoadCheckout;
  expireCheckout?: ExpireCheckout;
}): Promise<PayLinkPlan> {
  if (invoiceAlreadyPaid(input.invoice)) return { action: 'skip', reason: INVOICE_ALREADY_PAID };
  const open = openPayLink(input.invoice.invoice_data);
  if (!open) return { action: 'create' };

  const load = input.loadCheckout ?? defaultLoadCheckout;
  const expire = input.expireCheckout ?? defaultExpireCheckout;
  let snapshot: CheckoutSessionSnapshot | null = null;
  try {
    snapshot = await load(open.sessionId);
  } catch (e) {
    console.warn('[billing] Checkout session lookup failed', e);
    snapshot = null;
  }

  if (snapshot && sessionSettled(snapshot)) {
    console.warn('[billing] refusing a new Checkout session; the open pay link is already complete', {
      invoiceId: input.invoice.id == null ? null : String(input.invoice.id),
      sessionId: open.sessionId,
      status: snapshot.status || null,
      payment_status: snapshot.payment_status || null,
    });
    return { action: 'skip', reason: INVOICE_CHECKOUT_ALREADY_PAID };
  }

  if (snapshot && sessionOpen(snapshot) && sameCharge(input.payAmount, snapshot, open.amount)) {
    return { action: 'reuse', sessionId: open.sessionId, url: open.url };
  }

  let classification: CheckoutExpireClass = 'failed';
  try {
    classification = await expire(open.sessionId);
  } catch (e) {
    console.warn('[billing] Checkout session expire failed', e);
    classification = 'failed';
  }
  if (classification === 'completed') return { action: 'skip', reason: INVOICE_CHECKOUT_ALREADY_PAID };
  if (classification === 'expired' || classification === 'already_expired') return { action: 'create' };
  return { action: 'skip', reason: INVOICE_PAY_LINK_BUSY };
}
