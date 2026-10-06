import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { publicSiteOrigin, wrapCustomerFacingDocumentEmail } from '@/lib/customer-invite';
import { fetchDirectoryContactSources, pickCrmReachEmail } from '@/lib/customer-contacts';
import { getCompanyTheme } from '@/lib/company-theme';
import {
  buildOwnedReportMessage,
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

const REPORT_SELECTS = [
  'id, created_by, organization_id, customer_name, customer_organization_id, customer_email, report_number, status',
  'id, created_by, organization_id, customer_name, customer_email, report_number, status',
];

/**
 * POST /api/billing/send-report
 * Body: { report_id }
 * Mail is sent only for a service report the caller's organization owns.
 * The HTML and recipient come from that report. The body cannot supply them.
 * No customer-invite claim token is minted.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return respond({ error: 'Sign in required' }, 401);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) return respond({ error: 'Server misconfigured' }, 500);

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
    const request = ownedSendRequest(raw, 'report_id');
    const reportId = request.documentId;
    if (reportId == null) return respond({ error: 'Service report id is required.' }, 400);

    const loaded = await loadOwnedDocument({
      userClient: supabase,
      adminClient: hasServiceRole() ? getSupabaseAdmin() : null,
      table: 'service_reports',
      id: reportId,
      callerOrgId,
      narrowSelects: REPORT_SELECTS,
      notFoundError: 'Service report not found.',
      forbiddenError: 'This service report belongs to another organization.',
    });
    if (!loaded.ok) return respond({ error: loaded.error }, loaded.status);
    const report = loaded.row;
    if (!documentOwnedByOrganization(report, callerOrgId)) {
      return respond({ error: 'This service report belongs to another organization.' }, 403);
    }

    let crm: { email: string; source: 'crm_org' | 'crm_contact' | 'form' | 'none' } | null = null;
    const custOrgId = documentCustomerOrgId(report);
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
      storedEmail: storedCustomerEmail(report, 'report'),
    });
    if (!recipient.email) {
      return respond(
        {
          error:
            'No email on file for this customer. Add an email on the customer/clinic profile or the service report.',
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
    const subject = ownedDocumentSubject('report', report.report_number, company.company_name, request.locale);
    const html = buildOwnedReportMessage(report, theme, request.locale);
    const { signupUrl, loginUrl } = documentAccountLinks(publicSiteOrigin(req));
    const wrapped = wrapCustomerFacingDocumentEmail({
      subject,
      documentHtml: html,
      signupUrl,
      loginUrl,
      companyName: String(report.customer_name || '').trim(),
      theme,
      locale: request.locale,
    });

    const resendKey = process.env.RESEND_API_KEY;
    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';
    if (!resendKey) {
      return respond(
        {
          ok: false,
          emailSent: false,
          error:
            'Email delivery is not configured (RESEND_API_KEY). Use the device email app with the address on file.',
          needsConfig: true,
        },
        503
      );
    }

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
          html: wrapped,
          replyTo: company.email,
        })
      ),
    });

    const result = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      console.error('Resend service-report send failed', result);
      const msg = result?.message || `Email provider error (${rr.status})`;
      const friendly =
        /verify a domain|own email address|testing emails|not verified/i.test(msg)
          ? `${msg} — Verify medicalrepairnetwork.com DNS in Resend before sending to customers.`
          : msg;
      return respond({ ok: false, emailSent: false, error: friendly }, 502, [recipient.email]);
    }

    return respond(
      {
        ok: true,
        emailSent: true,
        id: result?.id || null,
        to: recipient.email,
        emailSource: recipient.source,
        reportId,
      },
      200,
      [recipient.email]
    );
  } catch (e: any) {
    console.error('send-report', e);
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
