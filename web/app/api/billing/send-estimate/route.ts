import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { ensureEstimateActionCtas } from '@/lib/billing/doc-html';
import {
  generateEstimateActionToken,
  persistEstimateActionToken,
  persistEstimateDocumentLocale,
  readExistingActionToken,
} from '@/lib/billing/estimate-action';
import { estimateActionUrl, estimateCustomerPath, stampLangOnEstimateLinks } from '@/lib/share';
import { publicSiteOrigin, wrapCustomerFacingDocumentEmail } from '@/lib/customer-invite';
import { fetchDirectoryContactSources, pickCrmReachEmail } from '@/lib/customer-contacts';
import { getCompanyTheme } from '@/lib/company-theme';
import { loadOrgMoneyPrefs } from '@/lib/org-money';
import { resolveNumberingTimeZone } from '@/lib/org-timezone';
import {
  finalizeEstimateDelivery,
  isEstimateMarkedSent,
} from '@/lib/billing/finalize-estimate';
import {
  buildOwnedEstimateMessage,
  buildOwnedEstimateEmailText,
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
import { rejectedEstimateChangeRefusal } from '@/lib/billing/estimate-display';
import { releaseDocumentSendSlot, takeDocumentSendSlot } from '@/lib/billing/send-rate-limit';

/** Same body for a missing estimate and an estimate owned by another shop. */
const ESTIMATE_NOT_FOUND = 'Estimate not found.';

type SendEstimateDeps = {
  userClient?: SupabaseClient;
  adminClient?: SupabaseClient | null;
};

const EST_SELECTS = [
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, customer_action, customer_action_token, services, issues, created_at',
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, customer_action_token',
  'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status',
];

/**
 * POST /api/billing/send-estimate
 * Body: { estimate_id }
 * Mail is sent only for an estimate the caller's organization owns.
 * The HTML and recipient come from that estimate. The body cannot supply them.
 * No customer-invite claim token is minted. Approve / reject links use the
 * estimate action token already stored on that estimate.
 * The existing row is marked pending before mail is sent. A repeat call for an
 * already pending/sent estimate does not send again and does not insert.
 */
export async function POST(req: NextRequest) {
  return runSendEstimate(req);
}

export async function runSendEstimate(req: NextRequest, deps: SendEstimateDeps = {}) {
  let heldSlot: { organizationId: string | number | null; documentId: string | number; stamp: number } | null =
    null;
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
    const request = ownedSendRequest(raw, 'estimate_id');
    const estimateId = request.documentId;
    if (estimateId == null) return respond({ error: 'Estimate id is required.' }, 400);

    const admin =
      deps.adminClient !== undefined ? deps.adminClient : hasServiceRole() ? getSupabaseAdmin() : null;

    const loaded = await loadOwnedDocument({
      userClient: supabase,
      adminClient: admin,
      table: 'service_estimates',
      id: estimateId,
      callerOrgId,
      narrowSelects: EST_SELECTS,
      notFoundError: ESTIMATE_NOT_FOUND,
    });
    if (!loaded.ok || !documentOwnedByOrganization(loaded.row, callerOrgId)) {
      return respond({ error: ESTIMATE_NOT_FOUND }, 404);
    }
    const est = loaded.row;
    const rejected = rejectedEstimateChangeRefusal(est);
    if (rejected) {
      return respond({ ok: false, emailSent: false, error: rejected.error }, rejected.status);
    }

    let crm: { email: string; source: 'crm_org' | 'crm_contact' | 'form' | 'none' } | null = null;
    const custOrgId = documentCustomerOrgId(est, 'estimate_data');
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
      storedEmail: storedCustomerEmail(est, 'estimate'),
    });
    if (!recipient.email) {
      return respond(
        { error: 'No valid customer email. Add email on the customer profile or estimate form.' },
        400
      );
    }

    if (isEstimateMarkedSent(est.status)) {
      return respond(
        {
          ok: true,
          emailSent: false,
          alreadySent: true,
          to: recipient.email,
          emailSource: recipient.source,
          estimateId,
        },
        200,
        [recipient.email]
      );
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return respond(
        {
          ok: false,
          emailSent: false,
          error:
            'Email delivery is not configured (RESEND_API_KEY). Save as draft or mark sent without email.',
          needsConfig: true,
        },
        503
      );
    }

    const sendLimit = takeDocumentSendSlot({
      organizationId: callerOrgId,
      documentId: estimateId,
      documentType: 'estimate',
    });
    if (!sendLimit.ok) {
      return respond({ error: sendLimit.message, rateLimited: true }, 429);
    }
    heldSlot = { organizationId: callerOrgId, documentId: estimateId, stamp: sendLimit.stamp };

    const techName = await readTechName(supabase, user.id);
    const company =
      callerOrgId != null
        ? await loadSenderCompany(supabase, callerOrgId, techName)
        : senderCompanyFromOrg(null, techName);
    const theme = callerOrgId != null ? await getCompanyTheme(callerOrgId, supabase) : null;

    let actionToken = readExistingActionToken(est);
    if (!actionToken) actionToken = generateEstimateActionToken();
    const writer = admin ?? supabase;
    try {
      await persistEstimateActionToken(writer, estimateId, actionToken, est.estimate_data);
    } catch (e) {
      console.warn('could not persist estimate action token', e);
    }

    const subject = ownedDocumentSubject('estimate', est.estimate_number, company.company_name, request.locale);
    const moneyPrefs = callerOrgId != null ? await loadOrgMoneyPrefs(supabase, callerOrgId) : null;
    const zone = await resolveNumberingTimeZone(supabase, callerOrgId, { allowBrowser: false });
    const actionUrl = estimateActionUrl(actionToken, { lang: request.locale });
    const mailInput = {
      row: est,
      company,
      theme,
      actionUrl,
      moneyPrefs,
      locale: request.locale,
      timeZone: zone.timeZone,
    };
    const html = ensureEstimateActionCtas(
      buildOwnedEstimateMessage(mailInput),
      actionUrl,
      request.locale,
    );
    const origin = publicSiteOrigin(req);
    const { signupUrl, loginUrl } = documentAccountLinks(origin, estimateCustomerPath(estimateId));
    const text = stampLangOnEstimateLinks(
      buildOwnedEstimateEmailText({
        ...mailInput,
        signupUrl,
        loginUrl,
      }),
      request.locale
    );
    const mailedHtml = stampLangOnEstimateLinks(
      wrapCustomerFacingDocumentEmail({
        subject,
        documentHtml: html,
        signupUrl,
        loginUrl,
        companyName: String(est.customer_name || '').trim(),
        theme,
        locale: request.locale,
      }),
      request.locale
    );

    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';

    const delivery = await finalizeEstimateDelivery({
      client: writer,
      estimateId,
      row: est,
      send: async () => {
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
              text,
              replyTo: company.email,
            })
          ),
        });
        const result = await rr.json().catch(() => ({}));
        if (!rr.ok) {
          console.error('Resend estimate send failed', result);
          const msg = result?.message || `Email provider error (${rr.status})`;
          const friendly =
            /verify a domain|own email address|testing emails|not verified/i.test(msg)
              ? `${msg} — Verify medicalrepairnetwork.com DNS in Resend before sending to customers.`
              : msg;
          return { ok: false, error: friendly };
        }
        return { ok: true, id: result?.id || null };
      },
    });

    if (!delivery.ok) {
      if (heldSlot) {
        releaseDocumentSendSlot({ ...heldSlot, documentType: 'estimate' });
        heldSlot = null;
      }
      return respond({ ok: false, emailSent: false, error: delivery.error }, 502, [recipient.email]);
    }

    if (delivery.emailed) {
      try {
        await persistEstimateDocumentLocale(writer, estimateId, request.locale);
      } catch (e) {
        console.warn('could not stamp estimate document locale', e);
      }
    }

    heldSlot = null;
    return respond(
      {
        ok: true,
        emailSent: delivery.emailed,
        alreadySent: delivery.alreadySent,
        id: delivery.providerId,
        to: recipient.email,
        emailSource: recipient.source,
        estimateId,
      },
      200,
      [recipient.email]
    );
  } catch (e: any) {
    if (heldSlot) releaseDocumentSendSlot({ ...heldSlot, documentType: 'estimate' });
    console.error('send-estimate', e);
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
