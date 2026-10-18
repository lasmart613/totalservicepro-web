import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emailsMatch, normalizeLookupEmail } from '@/lib/email-match';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { canSendClinicOwnerInvite } from '@/lib/roles';
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

/** issue_clinic_owner_invite refusal codes (000923) -> HTTP status and message. */
const ISSUE_REFUSALS: Record<string, { status: number; error: string }> = {
  not_signed_in: { status: 401, error: 'Sign in required' },
  not_shop_admin: { status: 403, error: 'Only a shop owner or admin can send the clinic owner invite.' },
  not_linked: { status: 403, error: 'Customer is not in your directory' },
  not_clinic: { status: 400, error: 'Not a customer organization' },
  invalid_request: { status: 400, error: 'customer_organization_id is required' },
  invalid_email: { status: 400, error: 'Email on file is not valid. Invite was not sent.' },
  owner_exists: { status: 409, error: 'This clinic already has an owner account. Invite was not sent.' },
  email_not_on_clinic: { status: 409, error: 'The email on file just changed. Reload the customer and try again.' },
  email_of_record_differs: {
    status: 409,
    error:
      "This clinic's owner invite is tied to the email it was first sent to. Contact support to change it. Invite was not sent.",
  },
  confirm_required: {
    status: 409,
    error:
      "This clinic's email was changed by a team member who is not a shop admin. Confirm the address with the clinic (phone or in person), then send again and confirm. Invite was not sent.",
  },
  rate_limited: { status: 429, error: 'Too many invites for this clinic today. Try again tomorrow.' },
};
import { fetchDirectoryContactSources, pickCrmReachEmail, resolveDirectoryContact } from '@/lib/customer-contacts';
import { getCompanyTheme } from '@/lib/company-theme';

/**
 * GET /api/customers/invite?token=
 * Public preview for the owner signup form (company name + email only).
 * The token email must still be the clinic's current reach email
 * (same emailsMatch rule as POST /api/customers/claim). A mismatch is
 * invalid and does not include the clinic's current address.
 */
export async function GET(req: NextRequest) {
  return runCustomerInvitePreview(req);
}

export async function runCustomerInvitePreview(
  req: NextRequest,
  deps: {
    hasServiceRole?: () => boolean;
    getReader?: () => { from: (table: string) => any };
  } = {}
) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const payload = verifyCustomerInvite(token);
  if (!payload) {
    return NextResponse.json({ valid: false, error: 'Invite link is invalid or expired.' }, { status: 200 });
  }

  const ready = deps.hasServiceRole ?? hasServiceRole;
  if (!ready()) {
    return NextResponse.json({ valid: false, error: 'Invite could not be checked.' }, { status: 200 });
  }

  const reader = (deps.getReader ?? getSupabaseAdmin)();
  // 000923: the token must name an open invite row for this clinic and email.
  if (!payload.inv) {
    return NextResponse.json({ valid: false, error: 'Invite link is invalid or expired.' }, { status: 200 });
  }
  const { data: invite, error: inviteErr } = await reader
    .from('clinic_owner_invites')
    .select('id, customer_organization_id, email, expires_at, consumed_at, revoked_at')
    .eq('id', payload.inv)
    .maybeSingle();
  const inviteRow = invite as {
    customer_organization_id?: string | number | null;
    email?: string | null;
    expires_at?: string | null;
    consumed_at?: string | null;
    revoked_at?: string | null;
  } | null;
  if (
    inviteErr ||
    !inviteRow ||
    String(inviteRow.customer_organization_id) !== String(payload.orgId) ||
    !emailsMatch(inviteRow.email, payload.email) ||
    inviteRow.consumed_at ||
    inviteRow.revoked_at ||
    !inviteRow.expires_at ||
    Date.parse(inviteRow.expires_at) <= Date.now()
  ) {
    return NextResponse.json({ valid: false, error: 'Invite link is invalid or expired.' }, { status: 200 });
  }

  const { data: org, error: orgErr } = await reader
    .from('organizations')
    .select('id, email')
    .eq('id', payload.orgId)
    .maybeSingle();
  if (orgErr || !org) {
    return NextResponse.json({ valid: false, error: 'Invite link is invalid or expired.' }, { status: 200 });
  }

  const sources = await fetchDirectoryContactSources(reader, org.id);
  const currentEmail = pickCrmReachEmail({
    directoryContacts: sources.directoryContacts,
    contactRows: sources.contactRows,
    officeEmail: sources.officeEmail ?? (org as { email?: string | null }).email,
  }).email;
  if (!emailsMatch(currentEmail, payload.email)) {
    return NextResponse.json(
      {
        valid: false,
        reason: 'email_mismatch',
        error: 'This invite was issued for an email that is no longer on this clinic.',
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    valid: true,
    companyName: payload.name,
    email: payload.email,
  });
}

/**
 * POST /api/customers/invite
 * Body: { customer_organization_id, confirm_out_of_band? }
 *
 * Sends a free-account CTA to the email already on that customer record.
 * Never uses a caller-supplied destination address. Never BCCs anyone.
 *
 * 000923: only a shop owner, company_admin or admin may send it, and only
 * while the clinic has no owner. The invite is a database row
 * (issue_clinic_owner_invite) and the claim token carries its id. The first
 * invite fixes the clinic's email of record; later invites go only there. If
 * a non-admin changed the clinic's email since the last invite, the admin must
 * confirm the address with the clinic and resend with confirm_out_of_band.
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

    const { data: membership, error: membershipErr } = await (supabase as unknown as SupabaseClient)
      .from('organization_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', prof.organization_id)
      .maybeSingle();
    if (membershipErr) {
      return respond({ error: 'Could not verify your role. Invite was not sent.' }, 503);
    }
    if (!canSendClinicOwnerInvite((membership as { role?: string | null } | null)?.role, callerOrg?.type)) {
      return respond(
        { error: 'Only a shop owner or admin can send the clinic owner invite.', code: 'not_shop_admin' },
        403
      );
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
    const toEmail = normalizeLookupEmail(reach.email);
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

    const resendKey = deps.resendKey === undefined ? process.env.RESEND_API_KEY : deps.resendKey || '';
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

    // The database decides who may invite, to which address, and records it.
    const { data: issued, error: issueErr } = await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
    }).rpc('issue_clinic_owner_invite', {
      p_service_org: Number(prof.organization_id),
      p_customer_org: Number(customer.id),
      p_email: toEmail,
      p_confirmed_out_of_band: body.confirm_out_of_band === true,
    });
    if (issueErr) {
      console.error('issue clinic owner invite', issueErr.message || issueErr);
      return respond({ error: 'Could not create the clinic invite. Invite was not sent.' }, 503);
    }
    const issuedRow = (issued || {}) as { ok?: boolean; code?: string; invite_id?: string };
    if (issuedRow.ok !== true || !issuedRow.invite_id) {
      const code = String(issuedRow.code || 'refused');
      const refusal = ISSUE_REFUSALS[code] ?? { status: 403, error: 'Invite was not sent.' };
      return respond({ ok: false, emailed: false, code, error: refusal.error }, refusal.status);
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
          inv: issuedRow.invite_id,
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

    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';

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
