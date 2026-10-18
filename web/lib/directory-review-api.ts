import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller, type GodCaller } from '@/lib/god-auth';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { publicSiteOrigin } from '@/lib/site-origin';
import {
  buildCustomerInviteHtml,
  buildCustomerInviteText,
  customerInviteLoginUrl,
  customerInviteSignupUrl,
  customerInviteSubject,
  signCustomerInvite,
} from '@/lib/customer-invite';
import {
  stripBidi,
  buildListingInviteEmail,
  directoryClaimUrl,
  DIRECTORY_EMAIL_FROM_DEFAULT,
  isForbiddenDirectoryRecipient,
  isRegistrationId,
  parseReviewDecision,
  signDirectoryListingInvite,
} from '@/lib/directory-review';


type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
type Mail = { to: string[]; subject: string; html: string; text: string };
type SendResult = { ok: boolean; status?: number; message?: string };

export type DirectoryReviewDeps = {
  gate?: (req: NextRequest) => Promise<{ ok: true; caller: GodCaller } | { ok: false; response: NextResponse }>;
  rpc?: Rpc;
  sendEmail?: (m: Mail) => Promise<SendResult>;
  resendKey?: string | null;
};

function adminRpc(): Rpc {
  const admin = getSupabaseAdmin();
  return (fn, args) => admin.rpc(fn, args);
}

async function resendSend(key: string, m: Mail): Promise<SendResult> {
  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.DIRECTORY_EMAIL_FROM || process.env.NOTIFY_FROM_EMAIL || DIRECTORY_EMAIL_FROM_DEFAULT,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    }),
  });
  const j = await rr.json().catch(() => ({}));
  return { ok: rr.ok, status: rr.status, message: j?.message };
}

/** GET /api/god/directory: pending sign-ups with dedupe flags. Platform admins only. */
export async function runDirectoryReviewList(req: NextRequest, deps: DirectoryReviewDeps = {}) {
  const gate = await (deps.gate ?? requireGodCaller)(req);
  if (!gate.ok) return gate.response;
  if (!deps.rpc && !hasServiceRole()) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const { data, error } = await (deps.rpc ?? adminRpc())('directory_registrations_for_review', { p_limit: 200 });
  if (error) return NextResponse.json({ error: 'Could not load registrations' }, { status: 503 });
  return NextResponse.json({ ok: true, registrations: Array.isArray(data) ? data : [] });
}

/**
 * POST /api/god/directory { registration_id, decision: 'approve' | 'reject' }
 * The database decides and audits (directory_registration_review). An approve
 * that issued an invite sends it to the registered email. A repeated decision
 * is a no-op and sends nothing. Email failure is reported, not fatal.
 */
export async function runDirectoryReview(req: NextRequest, deps: DirectoryReviewDeps = {}) {
  const gate = await (deps.gate ?? requireGodCaller)(req);
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = parseReviewDecision(body.decision);
  if (!isRegistrationId(body.registration_id) || !decision) {
    return NextResponse.json({ error: 'registration_id and decision are required' }, { status: 400 });
  }
  if (!deps.rpc && !hasServiceRole()) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  const { data, error } = await (deps.rpc ?? adminRpc())('directory_registration_review', {
    p_registration_id: body.registration_id,
    p_decision: decision,
    p_reviewer_id: gate.caller.userId,
    p_reviewer_email: gate.caller.email || 'unknown@reviewer',
  });
  if (error) return NextResponse.json({ error: 'Review failed' }, { status: 503 });
  const r = (data || {}) as Record<string, unknown>;
  if (r.ok !== true) return NextResponse.json({ ok: false, code: r.code ?? 'refused' }, { status: 409 });

  const out: Record<string, unknown> = {
    ok: true,
    status: r.status,
    already: r.already === true,
    invite_kind: r.invite_kind ?? null,
    invite_skipped: r.invite_skipped ?? null,
    emailed: false,
  };
  const inviteId = typeof r.invite_id === 'string' ? r.invite_id : null;
  const to = typeof r.invite_email === 'string' ? r.invite_email : null;
  if (decision !== 'approve' || r.already === true || !inviteId || !to) return NextResponse.json(out);
  if (isForbiddenDirectoryRecipient(to)) {
    out.email_skipped = 'forbidden_recipient';
    return NextResponse.json(out);
  }

  const key = deps.resendKey === undefined ? process.env.RESEND_API_KEY || '' : deps.resendKey || '';
  if (!key && !deps.sendEmail) {
    out.email_skipped = 'not_configured';
    return NextResponse.json(out);
  }

  const origin = publicSiteOrigin(req);
  const company = stripBidi(r.organization_name).trim() || 'your company';
  const contact = typeof r.contact_name === 'string' ? stripBidi(r.contact_name) : null;
  let mail: Mail;
  try {
    if (r.invite_kind === 'clinic_owner') {
      const token = signCustomerInvite({ orgId: String(r.organization_id), email: to, name: company, inv: inviteId });
      const signupUrl = customerInviteSignupUrl(origin, token, company, to);
      const loginUrl = customerInviteLoginUrl(origin, token);
      mail = {
        to: [to],
        subject: customerInviteSubject(company),
        html: buildCustomerInviteHtml({ companyName: company, contactName: contact, serviceCompanyName: 'Medical Repair Network', signupUrl, loginUrl }),
        text: buildCustomerInviteText({ companyName: company, contactName: contact, serviceCompanyName: 'Medical Repair Network', signupUrl, loginUrl }),
      };
    } else {
      const token = signDirectoryListingInvite({ inv: inviteId, org: String(r.organization_id), email: to });
      mail = { to: [to], ...buildListingInviteEmail({ companyName: company, contactName: contact, claimUrl: directoryClaimUrl(origin, token) }) };
    }
  } catch {
    out.email_skipped = 'signing_not_configured';
    return NextResponse.json(out);
  }

  try {
    const sent = await (deps.sendEmail ?? ((m: Mail) => resendSend(key, m)))(mail);
    out.emailed = sent.ok;
    if (!sent.ok) out.email_skipped = 'send_failed';
  } catch {
    out.email_skipped = 'send_failed';
  }
  return NextResponse.json(out);
}
