import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  parseProductIssue,
  productIssueHtml,
  productIssueSubject,
  productIssueText,
  productIssuesInbox,
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

async function deliverToProductInbox(opts: {
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const to = productIssuesInbox();
  const from =
    process.env.NOTIFY_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    'Total Service Pro <contact@medicalrepairnetwork.com>';
  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!rr.ok) {
    const result = await rr.json().catch(() => ({}));
    return { ok: false, error: result?.message || `Email provider error (${rr.status})` };
  }
  return { ok: true };
}

/**
 * POST /api/product-issues
 * Short tester report. Delivers to the product contact inbox and/or product_issue_reports.
 * Never emails the reporter.
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
    const subject = productIssueSubject(parsed.report);
    const text = productIssueText({
      report: parsed.report,
      reporterEmail: caller.email,
      reporterUserId: caller.userId,
    });
    const html = productIssueHtml({
      report: parsed.report,
      reporterEmail: caller.email,
      reporterUserId: caller.userId,
    });

    let stored = false;
    if (hasServiceRole()) {
      try {
        const admin = getSupabaseAdmin();
        const { error } = await admin.from('product_issue_reports').insert({
          what_happened: parsed.report.whatHappened,
          page_url: parsed.report.pageUrl || null,
          user_agent: parsed.report.userAgent || null,
          reporter_user_id: caller.userId || null,
          reporter_email: caller.email || null,
        });
        if (!error) stored = true;
        else if (!/schema cache|does not exist|relation/i.test(error.message || '')) {
          console.error('[product-issues] persist', error.message);
        }
      } catch (e) {
        console.error('[product-issues] persist', e);
      }
    }

    const delivered = await deliverToProductInbox({ subject, html, text });
    if (delivered.ok && stored && hasServiceRole()) {
      try {
        await getSupabaseAdmin()
          .from('product_issue_reports')
          .update({ delivered_to_inbox: true })
          .eq('what_happened', parsed.report.whatHappened)
          .eq('page_url', parsed.report.pageUrl || '');
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

    console.info('[product-issues] accepted', {
      stored,
      emailed: delivered.ok,
      pageUrl: parsed.report.pageUrl,
    });

    return NextResponse.json({
      ok: true,
      stored,
      emailed: delivered.ok,
      message: 'Thanks — the Total Service Pro team has your report.',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not send report';
    console.error('[product-issues]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
