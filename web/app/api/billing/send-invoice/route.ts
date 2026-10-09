import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createInvoiceCheckoutSession as defaultCreateInvoiceCheckoutSession,
  stripeSecretProblem,
  type InvoiceCheckoutOutcome,
  type InvoicePayLinkInput,
} from '@/lib/billing/stripe-pay';
import { decideSellerChargeRoute, CONNECT_REQUIRED_CODE } from '@/lib/billing/stripe-connect';
import { loadSellerPayoutAccount } from '@/lib/billing/stripe-connect-api';
import {
  invoiceCheckoutDescription,
  resolveInvoiceCollectable,
} from '@/lib/billing/invoice-collectable';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { publicSiteOrigin, wrapCustomerFacingDocumentEmail } from '@/lib/customer-invite';
import { fetchDirectoryContactSources, pickCrmReachEmail } from '@/lib/customer-contacts';
import { getCompanyTheme } from '@/lib/company-theme';
import { loadOrgMoneyPrefs } from '@/lib/org-money';
import { resolveNumberingTimeZone } from '@/lib/org-timezone';
import { readEstimateDocumentLocale } from '@/lib/billing/estimate-action';
import { isVoidInvoiceStatus, VOIDED_INVOICE_MESSAGE } from '@/lib/billing/void-invoice';
import { releaseDocumentSendSlot, takeDocumentSendSlot } from '@/lib/billing/send-rate-limit';
import { stampLangOnEstimateLinks } from '@/lib/share';
import { loadInvoiceRow, mergePaymentFieldsIntoInvoiceData } from '@/lib/billing/invoice-row-load';
import {
  buildOwnedInvoiceMessage,
  documentAccountLinks,
  documentCustomerOrgId,
  documentOwnedByOrganization,
  loadOwnedDocument,
  loadSenderCompany,
  ownedDocumentSubject,
  ownedSendRequest,
  resendMessage,
  resolveOwnedRecipient,
  sanitizeMailResponse,
  senderCompanyFromOrg,
  storedCustomerEmail,
} from '@/lib/billing/owned-doc-mail';

/**
 * POST /api/billing/send-invoice
 * Body: { invoice_id, include_payment_link? }
 * Mail is sent only for an invoice the caller's organization owns.
 * The HTML and recipient come from that invoice. The body cannot supply them.
 * No customer-invite claim token is minted.
 */
type SendInvoiceDeps = {
  userClient?: SupabaseClient;
  adminClient?: SupabaseClient | null;
  createCheckout?: (input: InvoicePayLinkInput) => Promise<InvoiceCheckoutOutcome>;
};

export async function POST(req: NextRequest) {
  return runSendInvoice(req);
}

export async function runSendInvoice(req: NextRequest, deps: SendInvoiceDeps = {}) {
  let heldSlot: { organizationId: string | number | null; documentId: string | number; stamp: number } | null =
    null;
  let checkoutSessionCreated = false;
  const createInvoiceCheckoutSession = deps.createCheckout ?? defaultCreateInvoiceCheckoutSession;
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return respond({ error: 'Sign in required' }, 401);

    let supabase: SupabaseClient;
    if (deps.userClient) {
      supabase = deps.userClient;
    } else {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
      if (!url || !anon) return respond({ error: 'Server misconfigured' }, 500);
      supabase = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    const admin: SupabaseClient | null =
      deps.adminClient !== undefined ? deps.adminClient : hasServiceRole() ? getSupabaseAdmin() : null;

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) return respond({ error: 'Invalid session' }, 401);

    let callerOrgId: string | number | null = null;
    try {
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      callerOrgId = prof?.organization_id ?? null;
    } catch {
      callerOrgId = null;
    }

    const raw = await req.json().catch(() => ({}));
    const request = ownedSendRequest(raw, 'invoice_id');
    const invoiceId = request.documentId;
    if (invoiceId == null) return respond({ error: 'Invoice id is required.' }, 400);

    const loaded = await loadOwnedDocument({
      userClient: supabase,
      adminClient: admin,
      table: 'service_invoices',
      id: invoiceId,
      callerOrgId,
      readNarrow: async (client) => (await loadInvoiceRow(client, invoiceId)).row,
      notFoundError: 'Invoice not found.',
      forbiddenError: 'This invoice belongs to another organization.',
    });
    if (!loaded.ok) return respond({ error: loaded.error }, loaded.status);
    const inv = loaded.row;
    if (!documentOwnedByOrganization(inv, callerOrgId)) {
      return respond({ error: 'This invoice belongs to another organization.' }, 403);
    }

    let crm: { email: string; source: 'crm_org' | 'crm_contact' | 'form' | 'none' } | null = null;
    const custOrgId = documentCustomerOrgId(inv, 'invoice_data');
    if (custOrgId) {
      try {
        const sources = await fetchDirectoryContactSources(supabase, custOrgId);
        crm = pickCrmReachEmail({
          directoryContacts: sources.directoryContacts,
          contactRows: sources.contactRows,
          officeEmail: sources.officeEmail,
        });
      } catch {
        crm = null;
      }
    }
    const recipient = resolveOwnedRecipient({
      crm,
      storedEmail: storedCustomerEmail(inv, 'invoice'),
    });
    if (!recipient.email) {
      return respond(
        {
          error:
            'No valid customer email. Add an email on the customer profile (CRM company email or a contact), or on the invoice form.',
        },
        400
      );
    }

    const techName = await readTechName(supabase, user.id);
    const company =
      callerOrgId != null
        ? await loadSenderCompany(supabase, callerOrgId, techName)
        : senderCompanyFromOrg(null, techName);
    const theme = callerOrgId != null ? await getCompanyTheme(callerOrgId, supabase) : null;

    const collectable = resolveInvoiceCollectable({
      total: inv.total,
      amountPaid: inv.amount_paid,
      invoice_data: inv.invoice_data,
    });
    const payAmount = collectable.stripeAmount;
    const includePay = request.includePaymentLink;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return respond(
        {
          ok: false,
          emailSent: false,
          error:
            'Email delivery is not configured (RESEND_API_KEY). Invoice was finalized; export PDF or set up Resend to send mail.',
          needsConfig: true,
        },
        503,
        [recipient.email]
      );
    }

    const sendLimit = takeDocumentSendSlot({
      organizationId: callerOrgId,
      documentId: invoiceId,
      documentType: 'invoice',
    });
    if (!sendLimit.ok) {
      return respond({ error: sendLimit.message, rateLimited: true }, 429);
    }
    heldSlot = { organizationId: callerOrgId, documentId: invoiceId, stamp: sendLimit.stamp };

    let paymentUrl: string | null = null;
    let stripeSessionId: string | null = null;
    let stripeSkippedReason: string | null = null;
    let connectRequired = false;
    let stripeConnect: Record<string, unknown> | null = null;
    const stripeProblem = stripeSecretProblem();
    if (isVoidInvoiceStatus(inv.status)) {
      stripeSkippedReason = VOIDED_INVOICE_MESSAGE;
    } else if (includePay && payAmount >= 0.5) {
      if (stripeProblem) {
        stripeSkippedReason = stripeProblem;
      } else {
        const amountCents = Math.round(payAmount * 100);
        const invoiceOrgId = inv.organization_id;
        const sellerOrgId =
          typeof invoiceOrgId === 'string' || typeof invoiceOrgId === 'number'
            ? invoiceOrgId
            : callerOrgId;
        const loaded = await loadSellerPayoutAccount(sellerOrgId);
        const decision = decideSellerChargeRoute({
          organizationId: sellerOrgId,
          account: loaded.account,
          amountCents,
          schemaReady: loaded.schemaReady,
        });
        if (decision.mode === 'refuse') {
          connectRequired = true;
          stripeConnect = decision.prompt;
          stripeSkippedReason = decision.message;
        }
        const pay =
          decision.mode === 'refuse'
            ? null
            : await createInvoiceCheckoutSession({
                amountCents,
                description: invoiceCheckoutDescription(
                  collectable,
                  String(inv.invoice_number || `Invoice #${invoiceId}`)
                ),
                invoiceId,
                invoiceNumber: inv.invoice_number ? String(inv.invoice_number) : null,
                customerEmail: recipient.email,
                companyName: company.company_name || null,
                paymentKind: collectable.paymentKind,
                ...(decision.mode === 'destination'
                  ? {
                      destinationAccountId: decision.accountId,
                      payoutStatus: decision.payoutStatus,
                      applicationFeeCents: decision.applicationFeeCents,
                      organizationId: sellerOrgId,
                    }
                  : { legacyPlatformCharge: true as const }),
              });
        if (pay && !pay.ok && pay.code === CONNECT_REQUIRED_CODE) {
          connectRequired = true;
          stripeConnect = pay.prompt;
          stripeSkippedReason = pay.message;
        } else if (pay && !pay.ok) {
          stripeSkippedReason = pay.message;
        } else if (pay?.ok) {
          checkoutSessionCreated = true;
          paymentUrl = pay.url;
          stripeSessionId = pay.sessionId;
          if (invoiceId && inv) {
            try {
              const merged = mergePaymentFieldsIntoInvoiceData(inv, {
                payment_url: pay.url,
                stripe_checkout_session_id: pay.sessionId,
                payment_amount: payAmount,
                payment_kind: collectable.paymentKind,
              });
              if (merged) {
                const writer = admin ?? supabase;
                const { error: upErr } = await writer
                  .from('service_invoices')
                  .update({ invoice_data: merged, updated_at: new Date().toISOString() })
                  .eq('id', invoiceId);
                if (upErr) console.warn('could not persist payment_url', upErr.message);
              } else {
                console.warn('send-invoice: skipped payment_url persist; invoice_data was not loaded');
              }
            } catch (e) {
              console.warn('could not persist payment_url', e);
            }
          }
        }
      }
    } else if (includePay && payAmount < 0.5) {
      stripeSkippedReason = collectable.hasDeferredSplit && !collectable.deferredReleased
        ? collectable.amountPaid > 0
          ? 'Deposit is paid. Remaining balance is due on completion — use Collect remaining balance to enable Stripe.'
          : 'Amount due now is under $0.50 — no Stripe pay link added.'
        : 'Balance due is under $0.50 — no Stripe pay link added.';
    }

    let mailLocale: string | null = request.locale;
    const sourceEstimateId = inv.estimate_id;
    if (sourceEstimateId != null && String(sourceEstimateId).trim() !== '') {
      try {
        const reader = admin ?? supabase;
        const stored = await readEstimateDocumentLocale(reader, sourceEstimateId);
        if (stored) mailLocale = stored;
      } catch (e) {
        console.warn('could not read estimate document locale', e);
      }
    }

    const subject = ownedDocumentSubject('invoice', inv.invoice_number, company.company_name, mailLocale);
    const moneyPrefs = callerOrgId != null ? await loadOrgMoneyPrefs(supabase, callerOrgId) : null;
    const zone = await resolveNumberingTimeZone(supabase, callerOrgId, { allowBrowser: false });
    const sitePayUrl =
      paymentUrl && stripeSessionId && invoiceId != null
        ? `${publicSiteOrigin(req)}/pay/invoice/${encodeURIComponent(String(invoiceId))}?session=${encodeURIComponent(stripeSessionId)}`
        : paymentUrl;
    const html = buildOwnedInvoiceMessage({
      row: inv,
      company,
      theme,
      paymentUrl: sitePayUrl,
      moneyPrefs,
      locale: mailLocale,
      timeZone: zone.timeZone,
    });
    const { signupUrl, loginUrl } = documentAccountLinks(publicSiteOrigin(req));
    const wrapped = wrapCustomerFacingDocumentEmail({
      subject,
      documentHtml: html,
      signupUrl,
      loginUrl,
      companyName: String(inv.customer_name || '').trim(),
      theme,
      locale: mailLocale,
    });
    const mailedHtml = stampLangOnEstimateLinks(wrapped, mailLocale);

    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';

    const rr = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        resendMessage({
          from,
          to: recipient.email,
          subject,
          html: mailedHtml,
          replyTo: company.email,
        })
      ),
    });

    const result = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      console.error('Resend invoice send failed', result);
      if (heldSlot && !checkoutSessionCreated) {
        releaseDocumentSendSlot({ ...heldSlot, documentType: 'invoice' });
        heldSlot = null;
      }
      const msg = result?.message || `Email provider error (${rr.status})`;
      const friendly =
        /verify a domain|own email address|testing emails|not verified/i.test(msg)
          ? `${msg} — Verify medicalrepairnetwork.com in Resend (DNS: resend._domainkey + send MX/TXT). Until verified, delivery may be limited to your Resend account email.`
          : msg;
      return respond(
        { ok: false, emailSent: false, error: friendly, paymentUrl, connectRequired, stripeConnect },
        502,
        [recipient.email]
      );
    }

    heldSlot = null;
    return respond(
      {
        ok: true,
        emailSent: true,
        id: result?.id || null,
        to: recipient.email,
        emailSource: recipient.source,
        invoiceId,
        invoiceLoaded: true,
        paymentUrl,
        stripeSessionId,
        stripeSkippedReason: paymentUrl ? null : stripeSkippedReason,
        connectRequired,
        stripeConnect,
      },
      200,
      [recipient.email]
    );
  } catch (e: any) {
    if (heldSlot && !checkoutSessionCreated) {
      releaseDocumentSendSlot({ ...heldSlot, documentType: 'invoice' });
    }
    console.error('send-invoice', e);
    return respond({ error: e?.message || 'Server error' }, 500);
  }
}

function respond(body: Record<string, unknown>, status = 200, allowedEmails: string[] = []) {
  return NextResponse.json(sanitizeMailResponse(body, allowedEmails), { status });
}

async function readTechName(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('id', userId)
      .maybeSingle();
    return [data?.first_name, data?.last_name].filter(Boolean).join(' ');
  } catch {
    return '';
  }
}
