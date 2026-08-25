import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createInvoiceCheckoutSession, stripeSecretProblem } from '@/lib/billing/stripe-pay';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  publicSiteOrigin,
  resolveFreeAccountUrls,
  wrapCustomerFacingDocumentEmail,
} from '@/lib/customer-invite';

const INV_SELECT_FULL =
  'id, created_by, organization_id, customer_name, customer_organization_id, total, invoice_data, invoice_number, status';
const INV_SELECT_CORE =
  'id, created_by, organization_id, customer_name, customer_organization_id, total, status';
const INV_SELECT_MIN = 'id, created_by, organization_id, customer_name, total, status';

async function loadInvoiceRow(
  client: SupabaseClient,
  invoiceId: string | number
): Promise<{ row: any | null; errorMsg: string | null }> {
  // Try richest select first; fall back if columns missing in this DB
  for (const cols of [INV_SELECT_FULL, INV_SELECT_CORE, INV_SELECT_MIN, 'id, created_by, organization_id, total']) {
    const { data, error } = await client
      .from('service_invoices')
      .select(cols)
      .eq('id', invoiceId)
      .maybeSingle();
    if (!error && data) return { row: data, errorMsg: null };
    if (error && !/column|does not exist|schema cache/i.test(error.message || '')) {
      return { row: null, errorMsg: error.message };
    }
  }
  return { row: null, errorMsg: null };
}

/**
 * POST /api/billing/send-invoice
 * Body: {
 *   invoice_id?, to_email?, subject?, html?, invoice_number?,
 *   balance_due?, total?, customer_organization_id?, reply_to?,
 *   include_payment_link?: boolean (default true)
 * }
 * Resolves customer email from CRM org profile when possible.
 * Optionally embeds a Stripe Checkout pay link for the balance due.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Prefer getUser(token) so JWT is validated even if header wiring is flaky
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // Caller's org (for ownership checks when using service role)
    let callerOrgId: string | number | null = null;
    try {
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      callerOrgId = prof?.organization_id ?? null;
    } catch {
      /* ignore */
    }

    const body = await req.json().catch(() => ({}));
    const bodyEmail = String(body.to_email || body.to || '').trim();
    let toEmail = '';
    let emailSource: 'crm_org' | 'crm_contact' | 'invoice_form' | 'invoice_data' | 'none' = 'none';
    let html = String(body.html || '').trim();
    const invoiceNumber = body.invoice_number ? String(body.invoice_number) : '';
    // Normalize id (URL/params often strings; DB is bigserial)
    const rawId = body.invoice_id ?? null;
    const invoiceId =
      rawId == null || rawId === '' || rawId === 'new'
        ? null
        : /^\d+$/.test(String(rawId))
          ? Number(rawId)
          : rawId;
    const includePay = body.include_payment_link !== false;

    // Load invoice — user client first, then service role (RLS often blocks RETURNING/select)
    let inv: any = null;
    let invLoadNote: string | null = null;
    if (invoiceId != null) {
      const userLoad = await loadInvoiceRow(supabase, invoiceId);
      inv = userLoad.row;

      if (!inv && hasServiceRole()) {
        try {
          const admin = getSupabaseAdmin();
          const adminLoad = await loadInvoiceRow(admin, invoiceId);
          if (adminLoad.row) {
            const row = adminLoad.row;
            const owns =
              (row.created_by && String(row.created_by) === String(user.id)) ||
              (callerOrgId != null &&
                row.organization_id != null &&
                String(row.organization_id) === String(callerOrgId));
            if (owns) {
              inv = row;
              invLoadNote = 'loaded_via_service_role';
            } else {
              invLoadNote = 'service_role_row_not_owned';
            }
          } else {
            invLoadNote = adminLoad.errorMsg || 'not_found_service_role';
          }
        } catch (e: any) {
          invLoadNote = e?.message || 'service_role_load_failed';
        }
      } else if (!inv) {
        invLoadNote = userLoad.errorMsg || 'not_found_user_rls';
      }

      if (!inv) {
        console.warn('send-invoice: invoice row not loaded', {
          invoiceId,
          invLoadNote,
          userId: user.id,
          callerOrgId,
        });
        const status = invLoadNote === 'service_role_row_not_owned' ? 403 : 404;
        return NextResponse.json(
          {
            error:
              status === 403
                ? 'This invoice belongs to another organization.'
                : 'Invoice not found.',
            invLoadNote,
          },
          { status }
        );
      }
    }

    const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

    // Prefer customer CRM profile email when linked (org profile, then primary contact)
    let custOrgId =
      body.customer_organization_id ?? inv?.customer_organization_id ?? null;

    // invoice_data may carry customer_organization_id if column was missing on older rows
    if (!custOrgId && inv?.invoice_data) {
      let idata = inv.invoice_data;
      if (typeof idata === 'string') {
        try {
          idata = JSON.parse(idata);
        } catch {
          idata = {};
        }
      }
      if (idata?.customer_organization_id) custOrgId = idata.customer_organization_id;
    }

    // Prefer service-role for CRM reads when available (customer org may be outside caller's RLS)
    const crmClient: SupabaseClient =
      hasServiceRole() ? getSupabaseAdmin() : supabase;

    if (custOrgId) {
      try {
        const { data: cOrg } = await crmClient
          .from('organizations')
          .select('id, name, email, phone')
          .eq('id', custOrgId)
          .maybeSingle();
        if (cOrg?.email && isValidEmail(String(cOrg.email).trim())) {
          toEmail = String(cOrg.email).trim();
          emailSource = 'crm_org';
        }
      } catch {
        /* try contacts next */
      }

      // Primary contact on customer profile (Contacts tab) if org has no company email
      if (!toEmail) {
        try {
          const { data: primary } = await crmClient
            .from('contacts')
            .select('email, is_primary, first_name')
            .eq('organization_id', custOrgId)
            .not('email', 'is', null)
            .order('is_primary', { ascending: false })
            .limit(5);
          const pick = (primary || []).find(
            (c: { email?: string | null }) => c.email && isValidEmail(String(c.email).trim())
          );
          if (pick?.email) {
            toEmail = String(pick.email).trim();
            emailSource = 'crm_contact';
          }
        } catch {
          /* keep looking */
        }
      }
    }

    // Fall back to typed invoice form / request body
    if (!toEmail && bodyEmail && isValidEmail(bodyEmail)) {
      toEmail = bodyEmail;
      emailSource = 'invoice_form';
    }

    // Fall back to saved invoice_data.custEmail
    if ((!toEmail || !isValidEmail(toEmail)) && inv?.invoice_data) {
      let idata = inv.invoice_data;
      if (typeof idata === 'string') {
        try {
          idata = JSON.parse(idata);
        } catch {
          idata = {};
        }
      }
      if (idata?.custEmail && isValidEmail(String(idata.custEmail).trim())) {
        toEmail = String(idata.custEmail).trim();
        emailSource = 'invoice_data';
      }
    }

    if (!toEmail || !isValidEmail(toEmail)) {
      return NextResponse.json(
        {
          error:
            'No valid customer email. Add an email on the customer profile (CRM company email or a contact), or on the invoice form.',
        },
        { status: 400 }
      );
    }
    if (!html || html.length < 40) {
      return NextResponse.json({ error: 'Invoice HTML body is required' }, { status: 400 });
    }

    // Balance for Stripe
    let balanceDue =
      body.balance_due != null
        ? Number(body.balance_due)
        : body.total != null
          ? Number(body.total)
          : inv?.total != null
            ? Number(inv.total)
            : 0;
    if (inv?.invoice_data) {
      let idata = inv.invoice_data;
      if (typeof idata === 'string') {
        try {
          idata = JSON.parse(idata);
        } catch {
          idata = {};
        }
      }
      if (idata?.balanceDue != null) balanceDue = Number(idata.balanceDue);
      else if (idata?.deposit != null && inv.total != null) {
        balanceDue = Math.max(0, Number(inv.total) - Number(idata.deposit));
      }
    }

    let paymentUrl: string | null = null;
    let stripeSessionId: string | null = null;
    let stripeSkippedReason: string | null = null;
    const stripeProblem = stripeSecretProblem();
    if (includePay && balanceDue >= 0.5) {
      if (stripeProblem) {
        stripeSkippedReason = stripeProblem;
      } else {
        const pay = await createInvoiceCheckoutSession({
          amountCents: Math.round(balanceDue * 100),
          description: invoiceNumber || inv?.invoice_number || `Invoice #${invoiceId || ''}`,
          invoiceId: invoiceId || inv?.id,
          invoiceNumber: invoiceNumber || inv?.invoice_number,
          customerEmail: toEmail,
          companyName: body.company_name || null,
        });
        if (pay) {
          paymentUrl = pay.url;
          stripeSessionId = pay.sessionId;
          // Inject pay button into email HTML if not already present
          if (!html.includes(pay.url) && !html.includes('635BFF')) {
            const payBlock =
              `<div style="margin:22px 0;text-align:center;">` +
              `<a href="${pay.url}" style="display:inline-block;background:#635BFF;color:#fff;padding:14px 28px;` +
              `border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">` +
              `Pay $${balanceDue.toFixed(2)} securely with Stripe</a>` +
              `<div style="font-size:10px;color:#666;margin-top:8px;">Secure card payment · Powered by Stripe</div></div>`;
            if (html.includes('Thank you for choosing')) {
              html = html.replace('Thank you for choosing', payBlock + 'Thank you for choosing');
            } else {
              html = html + payBlock;
            }
          }
          // Persist link only on an invoice this caller already owns.
          if (invoiceId && inv) {
            try {
              let idata: any = inv?.invoice_data || {};
              if (typeof idata === 'string') {
                try {
                  idata = JSON.parse(idata);
                } catch {
                  idata = {};
                }
              }
              idata = {
                ...idata,
                payment_url: paymentUrl,
                stripe_checkout_session_id: stripeSessionId,
                payment_amount: balanceDue,
              };
              const writer = hasServiceRole() ? getSupabaseAdmin() : supabase;
              const { error: upErr } = await writer
                .from('service_invoices')
                .update({ invoice_data: idata, updated_at: new Date().toISOString() })
                .eq('id', invoiceId);
              if (upErr) {
                // invoice_data column may not exist — ignore
                console.warn('could not persist payment_url', upErr.message);
              }
            } catch (e) {
              console.warn('could not persist payment_url', e);
            }
          }
        } else {
          stripeSkippedReason =
            'Stripe Checkout session could not be created — check STRIPE_SECRET_KEY and amount.';
        }
      }
    } else if (includePay && balanceDue < 0.5) {
      stripeSkippedReason = 'Balance due is under $0.50 — no Stripe pay link added.';
    }

    const subject =
      String(body.subject || '').trim() ||
      (invoiceNumber
        ? `Invoice ${invoiceNumber} from Total Service Pro`
        : 'Invoice from Total Service Pro');

    const resendKey = process.env.RESEND_API_KEY;
    // Prefer verified domain from-address when configured
    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';

    if (!resendKey) {
      return NextResponse.json(
        {
          ok: false,
          emailSent: false,
          error:
            'Email delivery is not configured (RESEND_API_KEY). Invoice was finalized; export PDF or set up Resend to send mail.',
          needsConfig: true,
          paymentUrl,
        },
        { status: 503 }
      );
    }

    const companyName = String(inv?.customer_name || '').trim();
    const { signupUrl, loginUrl } = resolveFreeAccountUrls({
      origin: publicSiteOrigin(req),
      email: toEmail,
      companyName,
      customerOrgId: custOrgId,
    });
    const wrapped = wrapCustomerFacingDocumentEmail({
      subject,
      documentHtml: html,
      signupUrl,
      loginUrl,
      companyName,
    });

    const rr = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject,
        html: wrapped,
        reply_to: body.reply_to || undefined,
      }),
    });

    const result = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      console.error('Resend invoice send failed', result);
      const msg = result?.message || `Email provider error (${rr.status})`;
      // Friendlier copy for domain restriction
      const friendly =
        /verify a domain|own email address|testing emails|not verified/i.test(msg)
          ? `${msg} — Verify medicalrepairnetwork.com in Resend (DNS: resend._domainkey + send MX/TXT). Until verified, delivery may be limited to your Resend account email.`
          : msg;
      return NextResponse.json(
        {
          ok: false,
          emailSent: false,
          error: friendly,
          paymentUrl,
          attemptedTo: toEmail,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      emailSent: true,
      id: result?.id || null,
      to: toEmail,
      emailSource,
      customerOrganizationId: custOrgId,
      invoiceId,
      invoiceLoaded: !!inv,
      invLoadNote,
      paymentUrl,
      stripeSessionId,
      stripeSkippedReason: paymentUrl ? null : stripeSkippedReason,
    });
  } catch (e: any) {
    console.error('send-invoice', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
