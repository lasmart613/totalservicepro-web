import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAddCustomers } from '@/lib/roles';
import { isOwnerOrgType } from '@/lib/org-types';
import {
  buildCustomerInviteHtml,
  buildCustomerInviteText,
  canSignCustomerInvite,
  customerInviteLoginUrl,
  customerInviteSignupUrl,
  customerInviteSubject,
  isValidCustomerEmail,
  publicSiteOrigin,
  publicCustomerInviteBody,
  signCustomerInvite,
  verifyCustomerInvite,
} from '@/lib/customer-invite';
import { fetchDirectoryContactSources, pickCrmReachEmail, resolveDirectoryContact } from '@/lib/customer-contacts';
import { getCompanyTheme } from '@/lib/company-theme';

/**
 * GET /api/customers/invite?token=
 * Public preview for the owner signup form (company name + email only).
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const payload = verifyCustomerInvite(token);
  if (!payload) {
    return NextResponse.json({ valid: false, error: 'Invite link is invalid or expired.' }, { status: 200 });
  }
  return NextResponse.json({
    valid: true,
    companyName: payload.name,
    email: payload.email,
  });
}

/**
 * POST /api/customers/invite
 * Body: { customer_organization_id }
 *
 * Sends a free-account CTA to the email already on that customer record.
 * Never uses a caller-supplied destination address. Never BCCs anyone.
 */
export async function POST(req: NextRequest) {
  return runCustomerInvite(req);
}

export async function runCustomerInvite(
  req: NextRequest,
  deps: {
    createUserClient?: (
      url: string,
      anonKey: string,
      accessToken: string
    ) => {
      auth: {
        getUser: (token: string) => Promise<{
          data: { user: { id: string; email?: string | null } | null };
          error: { message?: string } | null;
        }>;
      };
      from: (table: string) => unknown;
    };
    sendEmail?: (message: {
      to: string[];
      subject: string;
      html: string;
      text: string;
    }) => Promise<{ ok: boolean; status?: number; id?: string | null; message?: string }>;
    resendKey?: string | null;
  } = {}
) {
  const respond = (body: Record<string, unknown>, status = 200) =>
    NextResponse.json(publicCustomerInviteBody(body), { status });

  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return respond({ error: 'Sign in required' }, 401);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return respond({ error: 'Server misconfigured' }, 500);
    }

    const supabase = deps.createUserClient
      ? deps.createUserClient(url, anon, token)
      : createClient(url, anon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return respond({ error: 'Invalid session' }, 401);
    }

    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!prof?.organization_id) {
      return respond({ error: 'You are not linked to an organization' }, 403);
    }

    const { data: callerOrg } = await supabase
      .from('organizations')
      .select('id, name, type')
      .eq('id', prof.organization_id)
      .maybeSingle();

    if (!canAddCustomers(prof.role, callerOrg?.type)) {
      return respond({ error: 'Only service company staff can send customer invites' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const customerId = body.customer_organization_id ?? body.customerId ?? null;
    if (customerId == null || customerId === '') {
      return respond({ error: 'customer_organization_id is required' }, 400);
    }

    const { data: link } = await supabase
      .from('organization_customers')
      .select('customer_organization_id')
      .eq('service_organization_id', prof.organization_id)
      .eq('customer_organization_id', customerId)
      .maybeSingle();

    if (!link) {
      return respond({ error: 'Customer is not in your directory' }, 403);
    }

    let { data: customer, error: customerErr } = await supabase
      .from('organizations')
      .select('id, name, email, contact_name, type, directory_contacts')
      .eq('id', customerId)
      .maybeSingle();
    if (customerErr) {
      ({ data: customer, error: customerErr } = await supabase
        .from('organizations')
        .select('id, name, email, contact_name, type')
        .eq('id', customerId)
        .maybeSingle());
    }

    if (!customer) {
      return respond({ error: 'Customer not found' }, 404);
    }

    if (customer.type && !isOwnerOrgType(customer.type) && customer.type !== 'customer') {
      return respond({ error: 'Not a customer organization' }, 400);
    }

    const sources = await fetchDirectoryContactSources(supabase, customer.id);
    const reach = pickCrmReachEmail({
      directoryContacts: sources.directoryContacts ?? (customer as { directory_contacts?: unknown }).directory_contacts,
      contactRows: sources.contactRows,
      officeEmail: sources.officeEmail ?? customer.email,
    });
    const resolved = resolveDirectoryContact({
      directoryContacts: sources.directoryContacts ?? (customer as { directory_contacts?: unknown }).directory_contacts,
      contactRows: sources.contactRows,
      legacyContactName: sources.legacyContactName ?? (customer as { contact_name?: string | null }).contact_name,
      officeEmail: sources.officeEmail ?? customer.email,
    });
    const toEmail = reach.email;
    if (!toEmail) {
      return respond({
        ok: true,
        emailed: false,
        skipped: 'no_email',
        to: null,
        error: 'No email on file. Customer was saved; invite was not sent.',
      });
    }
    if (!isValidCustomerEmail(toEmail)) {
      return respond({
        ok: true,
        emailed: false,
        skipped: 'invalid_email',
        to: toEmail,
        error: 'Email on file is not valid. Customer was saved; invite was not sent.',
      });
    }

    const origin = publicSiteOrigin(req);
    const companyName = String(customer.name || '').trim() || 'your clinic';
    let claimToken: string | null = null;
    if (canSignCustomerInvite()) {
      try {
        claimToken = signCustomerInvite({
          orgId: String(customer.id),
          email: toEmail,
          name: companyName,
        });
      } catch (e) {
        console.warn('customer invite sign failed', e);
      }
    }

    const signupUrl = customerInviteSignupUrl(origin, claimToken, companyName, toEmail);
    const loginUrl = customerInviteLoginUrl(origin, claimToken);
    const subject = customerInviteSubject(companyName);
    const theme = await getCompanyTheme(prof.organization_id, supabase);
    const html = buildCustomerInviteHtml({
      companyName,
      contactName: resolved.name || (customer as { contact_name?: string | null }).contact_name,
      serviceCompanyName: callerOrg?.name || theme.companyName || null,
      signupUrl,
      loginUrl,
      theme,
    });
    const text = buildCustomerInviteText({
      companyName,
      contactName: resolved.name || (customer as { contact_name?: string | null }).contact_name,
      serviceCompanyName: callerOrg?.name || null,
      signupUrl,
      loginUrl,
    });

    const resendKey = deps.resendKey === undefined ? process.env.RESEND_API_KEY : deps.resendKey || '';
    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';

    if (!resendKey) {
      return respond({
        ok: true,
        emailed: false,
        skipped: 'not_configured',
        to: toEmail,
        error:
          'Email delivery is not configured (RESEND_API_KEY). Customer was saved; invite was not sent.',
      });
    }

    const sent = deps.sendEmail
      ? await deps.sendEmail({ to: [toEmail], subject, html, text })
      : await (async () => {
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
              html,
              text,
            }),
          });
          const result = await rr.json().catch(() => ({}));
          return {
            ok: rr.ok,
            status: rr.status,
            id: result?.id || null,
            message: result?.message || (rr.ok ? '' : `Email provider error (${rr.status})`),
          };
        })();

    if (!sent.ok) {
      const msg = sent.message || `Email provider error (${sent.status ?? 'unknown'})`;
      const logged = /claim=|\/signup\/owner/i.test(msg) ? 'provider error' : msg;
      console.error('Resend customer invite failed', logged);
      return respond({
        ok: true,
        emailed: false,
        skipped: 'send_failed',
        to: toEmail,
        error: msg,
      });
    }

    return respond({
      ok: true,
      emailed: true,
      to: toEmail,
      id: sent.id || null,
    });
  } catch (e: any) {
    const message = e?.message || 'Server error';
    console.error('customer invite', /claim=|\/signup\/owner/i.test(String(message)) ? 'server error' : message);
    return respond({ error: /claim=|\/signup\/owner/i.test(String(message)) ? 'Server error' : message }, 500);
  }
}
