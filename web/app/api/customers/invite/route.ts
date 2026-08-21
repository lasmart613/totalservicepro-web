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
  signCustomerInvite,
  verifyCustomerInvite,
} from '@/lib/customer-invite';

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

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!prof?.organization_id) {
      return NextResponse.json({ error: 'You are not linked to an organization' }, { status: 403 });
    }

    const { data: callerOrg } = await supabase
      .from('organizations')
      .select('id, name, type')
      .eq('id', prof.organization_id)
      .maybeSingle();

    if (!canAddCustomers(prof.role, callerOrg?.type)) {
      return NextResponse.json({ error: 'Only service company staff can send customer invites' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const customerId = body.customer_organization_id ?? body.customerId ?? null;
    if (customerId == null || customerId === '') {
      return NextResponse.json({ error: 'customer_organization_id is required' }, { status: 400 });
    }

    const { data: link } = await supabase
      .from('organization_customers')
      .select('customer_organization_id')
      .eq('service_organization_id', prof.organization_id)
      .eq('customer_organization_id', customerId)
      .maybeSingle();

    if (!link) {
      return NextResponse.json({ error: 'Customer is not in your directory' }, { status: 403 });
    }

    const { data: customer } = await supabase
      .from('organizations')
      .select('id, name, email, contact_name, type')
      .eq('id', customerId)
      .maybeSingle();

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    if (customer.type && !isOwnerOrgType(customer.type) && customer.type !== 'customer') {
      return NextResponse.json({ error: 'Not a customer organization' }, { status: 400 });
    }

    const toEmail = String(customer.email || '').trim();
    if (!toEmail) {
      return NextResponse.json({
        ok: true,
        emailed: false,
        skipped: 'no_email',
        to: null,
        error: 'No email on file. Customer was saved; invite was not sent.',
      });
    }
    if (!isValidCustomerEmail(toEmail)) {
      return NextResponse.json({
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
    const html = buildCustomerInviteHtml({
      companyName,
      contactName: (customer as { contact_name?: string | null }).contact_name,
      serviceCompanyName: callerOrg?.name || null,
      signupUrl,
      loginUrl,
    });
    const text = buildCustomerInviteText({
      companyName,
      contactName: (customer as { contact_name?: string | null }).contact_name,
      serviceCompanyName: callerOrg?.name || null,
      signupUrl,
      loginUrl,
    });

    const resendKey = process.env.RESEND_API_KEY;
    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';

    if (!resendKey) {
      return NextResponse.json({
        ok: true,
        emailed: false,
        skipped: 'not_configured',
        to: toEmail,
        signupUrl,
        error:
          'Email delivery is not configured (RESEND_API_KEY). Customer was saved; invite was not sent.',
      });
    }

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
    if (!rr.ok) {
      console.error('Resend customer invite failed', result);
      const msg = result?.message || `Email provider error (${rr.status})`;
      return NextResponse.json({
        ok: true,
        emailed: false,
        skipped: 'send_failed',
        to: toEmail,
        signupUrl,
        error: msg,
      });
    }

    return NextResponse.json({
      ok: true,
      emailed: true,
      to: toEmail,
      id: result?.id || null,
      signupUrl,
    });
  } catch (e: any) {
    console.error('customer invite', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
