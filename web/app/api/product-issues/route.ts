import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  parseProductIssue,
  planProductIssueMail,
  productIssueConfirmationHtml,
  productIssueConfirmationSubject,
  productIssueConfirmationText,
  productIssueHtml,
  productIssueSubject,
  productIssueText,
  productIssuesFromAddress,
  PRODUCT_ISSUE_CONFIRM_REPLY_TO,
} from '@/lib/product-issues';

export const dynamic = 'force-dynamic';

const recentByIp = new Map<string, number[]>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const prev = (recentByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    recentByIp.set(ip, prev);
    return true;
  }
  prev.push(now);
  recentByIp.set(ip, prev);
  return false;
}

async function optionalCaller(req: NextRequest): Promise<{
  userId?: string;
  email?: string | null;
}> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return {};
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return {};
  try {
    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) return {};
    return { userId: user.id, email: user.email || null };
  } catch {
    return {};
  }
}

async function sendResendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const to = opts.to.filter(Boolean);
  if (!to.length) return { ok: false, error: 'No recipients' };
  const from = productIssuesFromAddress();
  const body: Record<string, unknown> = {
    from,
    to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  if (opts.replyTo) body.reply_to = opts.replyTo;
  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!rr.ok) {
    const result = await rr.json().catch(() => ({}));
    return { ok: false, error: result?.message || `Email provider error (${rr.status})` };
  }
  return { ok: true };
}

async function confirmationAlreadySent(opts: {
  email: string;
  whatHappened: string;
}): Promise<boolean> {
  if (!hasServiceRole()) return false;
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('product_issue_reports')
      .select('id')
      .eq('reporter_email', opts.email)
      .eq('what_happened', opts.whatHappened)
      .eq('confirmation_sent', true)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * POST /api/product-issues
 * Short tester report. Delivers to the product inbox and QA, then sends one
 * confirmation to the reporter when we have a valid address.
 */
export async function POST(req: NextRequest) {
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json(
        { error: 'Too many reports from this network. Try again in a few minutes.' },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseProductIssue({
      whatHappened: body.whatHappened ?? body.what_happened ?? body.description,
      pageUrl: body.pageUrl ?? body.page_url ?? body.url,
      userAgent: body.userAgent ?? body.user_agent,
    });
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const caller = await optionalCaller(req);
    const planned = planProductIssueMail({
      sessionEmail: caller.email,
      submittedEmail: body.email ?? body.reporterEmail ?? body.reporter_email,
    });
    if (!planned.ok) {
      return NextResponse.json({ error: planned.error }, { status: 400 });
    }
    const alreadySent = planned.plan.reporterEmail
      ? await confirmationAlreadySent({
          email: planned.plan.reporterEmail,
          whatHappened: parsed.report.whatHappened,
        })
      : false;
    const plan = {
      ...planned.plan,
      confirmationTo: alreadySent ? null : planned.plan.confirmationTo,
    };

    const subject = productIssueSubject(parsed.report);
    const text = productIssueText({
      report: parsed.report,
      reporterEmail: plan.reporterEmail,
      reporterUserId: caller.userId,
      confirmationSent: !!plan.confirmationTo,
    });
    const html = productIssueHtml({
      report: parsed.report,
      reporterEmail: plan.reporterEmail,
      reporterUserId: caller.userId,
      confirmationSent: !!plan.confirmationTo,
    });

    let stored = false;
    let storedId: string | null = null;
    if (hasServiceRole()) {
      try {
        const admin = getSupabaseAdmin();
        const { data, error } = await admin
          .from('product_issue_reports')
          .insert({
            what_happened: parsed.report.whatHappened,
            page_url: parsed.report.pageUrl || null,
            user_agent: parsed.report.userAgent || null,
            reporter_user_id: caller.userId || null,
            reporter_email: plan.reporterEmail || null,
            confirmation_sent: false,
          })
          .select('id')
          .maybeSingle();
        if (!error) {
          stored = true;
          storedId = data?.id ? String(data.id) : null;
        } else if (!/schema cache|does not exist|relation|confirmation_sent/i.test(error.message || '')) {
          console.error('[product-issues] persist', error.message);
        } else {
          const retry = await admin.from('product_issue_reports').insert({
            what_happened: parsed.report.whatHappened,
            page_url: parsed.report.pageUrl || null,
            user_agent: parsed.report.userAgent || null,
            reporter_user_id: caller.userId || null,
            reporter_email: plan.reporterEmail || null,
          });
          if (!retry.error) stored = true;
        }
      } catch (e) {
        console.error('[product-issues] persist', e);
      }
    }

    const delivered = await sendResendEmail({
      to: plan.teamRecipients,
      subject,
      html,
      text,
    });
    if (delivered.ok && stored && storedId && hasServiceRole()) {
      try {
        await getSupabaseAdmin()
          .from('product_issue_reports')
          .update({ delivered_to_inbox: true })
          .eq('id', storedId);
      } catch {
        /* ignore */
      }
    }

    if (!delivered.ok && !stored) {
      console.error('[product-issues] undelivered', {
        pageUrl: parsed.report.pageUrl,
        what: parsed.report.whatHappened.slice(0, 200),
        inboxError: delivered.error,
      });
      return NextResponse.json(
        {
          error:
            'Could not reach the product team inbox yet. Try again, or write contact@medicalrepairnetwork.com.',
        },
        { status: 503 }
      );
    }

    let confirmed = false;
    if (plan.confirmationTo) {
      const confirm = await sendResendEmail({
        to: [plan.confirmationTo],
        subject: productIssueConfirmationSubject(),
        html: productIssueConfirmationHtml(),
        text: productIssueConfirmationText(),
        replyTo: PRODUCT_ISSUE_CONFIRM_REPLY_TO,
      });
      confirmed = confirm.ok;
      if (!confirm.ok) {
        console.error('[product-issues] confirmation', confirm.error);
      } else if (stored && storedId && hasServiceRole()) {
        try {
          await getSupabaseAdmin()
            .from('product_issue_reports')
            .update({ confirmation_sent: true })
            .eq('id', storedId);
        } catch {
          /* ignore */
        }
      }
    }

    console.info('[product-issues] accepted', {
      stored,
      emailed: delivered.ok,
      confirmed,
      pageUrl: parsed.report.pageUrl,
    });

    return NextResponse.json({
      ok: true,
      stored,
      emailed: delivered.ok,
      confirmed,
      message: plan.confirmationTo
        ? 'Thanks — the Total Service Pro team has your report. We emailed you a confirmation.'
        : 'Thanks — the Total Service Pro team has your report.',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not send report';
    console.error('[product-issues]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
