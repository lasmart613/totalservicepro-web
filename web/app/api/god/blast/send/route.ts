import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { selectedOrgIds } from '@/lib/god-orgs';
import { loadAssembledGodOrgs } from '@/lib/god-org-load';
import {
  BLAST_TEMPLATES,
  blastFromAddress,
  blastReplyTo,
  blastSkipReason,
  parseBlastTemplateKey,
  pickBlastRecipient,
  type BlastTemplate,
  type BlastTemplateKey,
} from '@/lib/god-email-blast';
import { newUnsubscribeToken, shopInviteResendHeaders } from '@/lib/shop-invite-unsubscribe';

export const dynamic = 'force-dynamic';

async function recipientUnsubscribed(email: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('god_email_sends')
      .select('id')
      .ilike('recipient_email', email)
      .not('unsubscribed_at', 'is', null)
      .limit(1);
    if (error) return false;
    return Boolean(data?.length);
  } catch {
    return false;
  }
}

async function sendResend(opts: {
  to: string;
  template: BlastTemplate;
  unsubscribeToken: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: blastFromAddress(opts.template),
      to: [opts.to],
      reply_to: blastReplyTo(opts.template),
      subject: opts.template.subject,
      html: opts.template.html(),
      text: opts.template.text(),
      headers: shopInviteResendHeaders(opts.unsubscribeToken),
    }),
  });
  const result = await rr.json().catch(() => ({}));
  if (!rr.ok) {
    return { ok: false, error: result?.message || `Email provider error (${rr.status})` };
  }
  return { ok: true, id: result?.id || null };
}

async function logSend(row: {
  organizationId: number | string;
  organizationName: string;
  recipientEmail: string;
  subject: string;
  templateKey: BlastTemplateKey;
  sentByUserId: string;
  sentByEmail: string;
  unsubscribeToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!hasServiceRole()) return { ok: false, error: 'Service role missing' };
  const payload = {
    organization_id: row.organizationId,
    organization_name: row.organizationName,
    recipient_email: row.recipientEmail,
    subject: row.subject,
    template_key: row.templateKey,
    sent_by_user_id: row.sentByUserId,
    sent_by_email: row.sentByEmail,
    unsubscribe_token: row.unsubscribeToken,
  };
  try {
    const first = await getSupabaseAdmin().from('god_email_sends').insert(payload);
    if (!first.error) return { ok: true };
    if (!/column|schema cache|does not exist/i.test(first.error.message || '')) {
      return { ok: false, error: first.error.message };
    }
    const { unsubscribe_token, ...legacy } = payload;
    void unsubscribe_token;
    const fallback = await getSupabaseAdmin().from('god_email_sends').insert(legacy);
    if (fallback.error) return { ok: false, error: fallback.error.message };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not log send' };
  }
}

/**
 * POST /api/god/blast/send
 * Body: { template_key: 'clinic_invite' | 'shop_invite', organization_ids: (string|number)[], confirm: true }
 * Sends a locked template to org.email of each selected org only.
 * Never sends to every org. Never sends without confirm. Dedupes emails in one send.
 */
export async function POST(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;

  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: 'Confirm the send on the God dashboard before mail goes out.' },
      { status: 400 }
    );
  }

  const templateKey = parseBlastTemplateKey(body.template_key ?? body.templateKey);
  if (!templateKey) {
    return NextResponse.json(
      { error: 'Choose a locked template (shop_invite or clinic_invite).' },
      { status: 400 }
    );
  }
  const template = BLAST_TEMPLATES[templateKey];

  const ids = selectedOrgIds(body.organization_ids ?? body.organizationIds);
  if (!ids.length) {
    return NextResponse.json(
      { error: 'Select one or more organizations. Nothing is auto-selected.' },
      { status: 400 }
    );
  }

  const all = await loadAssembledGodOrgs();
  const wanted = new Set(ids.map(String));
  const targets = all.filter((org) => wanted.has(String(org.id)));
  if (!targets.length) {
    return NextResponse.json({ error: 'None of the selected organizations were found.' }, { status: 400 });
  }

  const results: Array<{
    organizationId: number | string;
    organizationName: string;
    recipient: string;
    ok: boolean;
    error?: string;
  }> = [];
  const sentEmails = new Set<string>();

  for (const org of targets) {
    const skip = blastSkipReason(templateKey, org);
    if (skip) {
      results.push({
        organizationId: org.id,
        organizationName: org.name,
        recipient: pickBlastRecipient(org),
        ok: false,
        error: skip,
      });
      continue;
    }
    const recipient = pickBlastRecipient(org);
    const emailKey = recipient.toLowerCase();
    if (sentEmails.has(emailKey)) {
      results.push({
        organizationId: org.id,
        organizationName: org.name,
        recipient,
        ok: false,
        error: 'Duplicate email already sent in this blast',
      });
      continue;
    }
    if (await recipientUnsubscribed(recipient)) {
      results.push({
        organizationId: org.id,
        organizationName: org.name,
        recipient,
        ok: false,
        error: 'Recipient unsubscribed from God email',
      });
      continue;
    }
    const unsubscribeToken = newUnsubscribeToken();
    const sent = await sendResend({ to: recipient, template, unsubscribeToken });
    if (sent.ok) {
      sentEmails.add(emailKey);
      const logged = await logSend({
        organizationId: org.id,
        organizationName: org.name,
        recipientEmail: recipient,
        subject: template.subject,
        templateKey,
        sentByUserId: gate.caller.userId,
        sentByEmail: gate.caller.email,
        unsubscribeToken,
      });
      results.push({
        organizationId: org.id,
        organizationName: org.name,
        recipient,
        ok: true,
        error: logged.ok ? undefined : `Sent, but log failed: ${logged.error}`,
      });
    } else {
      results.push({
        organizationId: org.id,
        organizationName: org.name,
        recipient,
        ok: false,
        error: sent.error,
      });
    }
  }

  const sentCount = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: sentCount > 0,
    sentCount,
    skipped: results.length - sentCount,
    template_key: templateKey,
    template_name: template.name,
    subject: template.subject,
    from: blastFromAddress(template),
    reply_to: blastReplyTo(template),
    results,
  });
}
