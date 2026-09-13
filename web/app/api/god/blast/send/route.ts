import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { loadAssembledGodOrgs } from '@/lib/god-org-load';
import { fetchAllPages } from '@/lib/supabase/paginate';
import {
  BLAST_ALREADY_SENT_WINDOW_MS,
  BLAST_SEND_CHUNK_SIZE,
  BLAST_TEMPLATES,
  blastFromAddress,
  blastReplyTo,
  encodeBlastResumeToken,
  nextBlastChunk,
  parseBlastSendBody,
  pickBlastRecipient,
  type BlastRecentSend,
  type BlastSendContent,
  type BlastTemplate,
  type BlastTemplateKey,
} from '@/lib/god-email-blast';
import { newUnsubscribeToken, shopInviteResendHeaders } from '@/lib/shop-invite-unsubscribe';

export const dynamic = 'force-dynamic';
/** Must be a numeric literal for the Next/OpenNext plugin. Keep in sync with BLAST_SEND_MAX_DURATION_SECONDS. */
export const maxDuration = 60;

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
  content: BlastSendContent;
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
      subject: opts.content.subject,
      html: opts.content.html,
      text: opts.content.text,
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

async function loadRecentBlastSends(
  templateKey: BlastTemplateKey,
  sinceIso: string
): Promise<{ ok: true; sends: BlastRecentSend[] } | { ok: false; error: string }> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await fetchAllPages<BlastRecentSend>(async (from, to) => {
      const res = await admin
        .from('god_email_sends')
        .select('recipient_email, template_key, subject, created_at, organization_id')
        .eq('template_key', templateKey)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .range(from, to);
      return { data: (res.data as BlastRecentSend[] | null) || [], error: res.error };
    });
    if (error) {
      if (/relation|does not exist|schema cache/i.test(error.message || '')) {
        return { ok: true, sends: [] };
      }
      return { ok: false, error: error.message || 'Could not read recent God email sends' };
    }
    return { ok: true, sends: data || [] };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read recent God email sends' };
  }
}

/**
 * POST /api/god/blast/send
 * Body: { template_key: 'clinic_invite' | 'shop_invite', organization_ids, confirm: true, subject?, html?, text?, blast_id?, resume_token? }
 * Optional subject/html/text apply to this send only. Locked source files are not overwritten.
 * Processes at most BLAST_SEND_CHUNK_SIZE recipients per invocation so Netlify cannot time out mid-blast.
 * Duration is raised via export const maxDuration = BLAST_SEND_MAX_DURATION_SECONDS (60).
 * Do not set a generated OpenNext handler timeout in netlify.toml; that key fails deploy.
 * Never sends to every org. Never sends without confirm. Dedupes emails in one send and last 24h.
 */
export async function POST(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;

  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  const parsed = parseBlastSendBody(await req.json().catch(() => ({})));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const { templateKey, organizationIds: ids, content } = parsed;
  const blastId = parsed.blastId || randomUUID();
  const template = BLAST_TEMPLATES[templateKey];

  const all = await loadAssembledGodOrgs();
  const byId = new Map(all.map((org) => [String(org.id), org]));
  const targets = ids.map((id) => byId.get(String(id))).filter((org): org is (typeof all)[number] => Boolean(org));
  if (!targets.length) {
    return NextResponse.json({ error: 'None of the selected organizations were found.' }, { status: 400 });
  }

  const sinceIso = new Date(Date.now() - BLAST_ALREADY_SENT_WINDOW_MS).toISOString();
  const recent = await loadRecentBlastSends(templateKey, sinceIso);
  if (!recent.ok) {
    return NextResponse.json({ error: recent.error }, { status: 500 });
  }
  const recentSends = recent.sends;
  const { chunkOrgs, remainingIds: leftoverIds } = nextBlastChunk({
    organizationIds: ids,
    orgs: targets,
    templateKey,
    recentSends,
    subject: content.subject,
  });

  const results: Array<{
    organizationId: number | string;
    organizationName: string;
    recipient: string;
    ok: boolean;
    error?: string;
  }> = [];
  const sentEmails = new Set<string>();

  for (const org of chunkOrgs) {
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
    const sent = await sendResend({ to: recipient, template, content, unsubscribeToken });
    if (sent.ok) {
      sentEmails.add(emailKey);
      const logged = await logSend({
        organizationId: org.id,
        organizationName: org.name,
        recipientEmail: recipient,
        subject: content.subject,
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
        error: sent.error || 'Email provider error',
      });
    }
  }

  const remaining_organization_ids = leftoverIds;

  const sentCount = results.filter((r) => r.ok).length;
  const complete = remaining_organization_ids.length === 0;
  const resume_token = complete
    ? null
    : encodeBlastResumeToken({
        blast_id: blastId,
        template_key: templateKey,
        organization_ids: remaining_organization_ids,
      });

  return NextResponse.json({
    ok: sentCount > 0 || complete,
    sentCount,
    skipped: results.length - sentCount,
    processed: results.length,
    queued: ids.length,
    remaining: remaining_organization_ids.length,
    remaining_organization_ids,
    complete,
    chunk_size: BLAST_SEND_CHUNK_SIZE,
    blast_id: blastId,
    resume_token,
    template_key: templateKey,
    template_name: template.name,
    subject: content.subject,
    customized: content.customized,
    body_customized: content.bodyCustomized,
    from: blastFromAddress(template),
    reply_to: blastReplyTo(template),
    results,
  });
}
