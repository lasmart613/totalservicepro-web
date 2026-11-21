/**
 * Public invoice pay links may only send the browser to Stripe Checkout.
 *
 * payment_url is written by send-invoice from createInvoiceCheckoutSession
 * (POST /v1/checkout/sessions, platform charge and Connect destination
 * charge). Stripe's hosted Checkout URL uses checkout.stripe.com. This repo
 * does not set a Checkout custom domain.
 *
 * Other Checkout Session creators return session.url to the browser and do
 * not store it on the invoice:
 * - createPartCheckoutSession (marketplace)
 * - createOrgUpgradeCheckoutSession (org plan)
 * Those URLs are the same Checkout host.
 *
 * Not allowlisted, because they are not invoice payment_url values:
 * - invoice.stripe.com — subscription hosted_invoice_url on the upgrade receipt
 * - pay.stripe.com — charge receipt_url on that same receipt
 * - buy.stripe.com — Payment Links are not created
 *
 * The list is exact hosts. Subdomains are rejected.
 */
import { VOIDED_INVOICE_MESSAGE } from './void-invoice.ts';

export const INVOICE_PAYMENT_URL_HOSTS = ['checkout.stripe.com'] as const;

export const INVOICE_PAYMENT_LINK_UNAVAILABLE = 'This invoice has no payment link.';

const INVOICE_PAY_PAGE_FALLBACK = 'This invoice cannot be paid from this link.';

const ALLOWED_HOSTS = new Set<string>(INVOICE_PAYMENT_URL_HOSTS);

/** ASCII controls, backslash, or any leftover whitespace. Parser differentials. */
const UNSAFE_URL_BYTES = /[\u0000-\u001F\u007F\\\s]/;

export function allowedInvoicePaymentUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return null;
  if (UNSAFE_URL_BYTES.test(trimmed)) return null;
  const authority = /^https:\/\/([^/?#]*)/i.exec(trimmed);
  if (!authority || authority[1].includes('@')) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.port !== '') return null;
  const host = url.hostname;
  if (!ALLOWED_HOSTS.has(host)) return null;
  if (host.includes('%') || host.includes('\\') || host.endsWith('.')) return null;
  if (url.origin !== `https://${host}`) return null;
  return url.href;
}

export type InvoicePayPageAction =
  | { type: 'voided'; message: string }
  | { type: 'redirect'; url: string }
  | { type: 'unavailable'; message: string }
  | { type: 'message'; message: string };

/**
 * What the public pay page may do with a pay-status body.
 * A payable flag is not enough: the URL is checked again before navigation.
 */
export function invoicePayPageAction(json: unknown): InvoicePayPageAction {
  const body = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  if (body.voided === true) {
    const message =
      typeof body.message === 'string' && body.message ? body.message : VOIDED_INVOICE_MESSAGE;
    return { type: 'voided', message };
  }
  const url = allowedInvoicePaymentUrl(body.paymentUrl);
  if (body.payable === true && url) {
    return { type: 'redirect', url };
  }
  if (
    body.payable === true ||
    body.message === INVOICE_PAYMENT_LINK_UNAVAILABLE
  ) {
    return { type: 'unavailable', message: INVOICE_PAYMENT_LINK_UNAVAILABLE };
  }
  const message =
    typeof body.message === 'string' && body.message ? body.message : INVOICE_PAY_PAGE_FALLBACK;
  return { type: 'message', message };
}
