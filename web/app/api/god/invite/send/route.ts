import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { assembleGodOrgs, selectedOrgIds, type GodMember, type GodOrgSource } from '@/lib/god-orgs';
import {
  SHOP_INVITE_SUBJECT,
  SHOP_INVITE_TEMPLATE_KEY,
  shopInviteHtml,
  shopInviteText,
} from '@/lib/shop-invite-email';
import { fetchAllPages } from '@/lib/supabase/paginate';

export const dynamic = 'force-dynamic';

async function loadGodOrgs(): Promise<ReturnType<typeof assembleGodOrgs>> {
  const admin = getSupabaseAdmin();
  const { data: orgs } = await fetchAllPages<GodOrgSource>(async (from, to) => {
    const cols =
      'id, name, type, email, created_at, is_premium, subscription_tier, plan';
    let res = await admin.from('organizations').select(cols).order('id').range(from, to);
    if (res.error && /column|schema cache|does not exist/i.test(res.error.message || '')) {
      res = await admin
        .from('organizations')
        .select('id, name, type, email, created_at, is_premium')
        .order('id')
        .range(from, to);
    }
    return { data: (res.data as GodOrgSource[] | null) || [], error: res.error };
  });

  const { data: profiles } = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
    const res = await admin
      .from('user_profiles')
      .select('id, email, first_name, last_name, role, organization_id')
      .order('id')
      .range(from, to);
    return { data: (res.data as Record<string, unknown>[] | null) || [], error: res.error };
  });

  const members: GodMember[] = (profiles || []).map((row) => ({
    id: String(row.id),
    email: (row.email as string | null) || null,
    firstName: (row.first_name as string | null) || null,
    lastName: (row.last_name as string | null) || null,
    role: (row.role as string | null) || null,
    organizationId: (row.organization_id as number | string | null) ?? null,
  }));

  return assembleGodOrgs({ orgs: orgs || [], members });
}

async function sendResend(to: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
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
      subject: SHOP_INVITE_SUBJECT,
      html: shopInviteHtml(),
      text: shopInviteText(),
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
  sentByUserId: string;
  sentByEmail: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!hasServiceRole()) return { ok: false, error: 'Service role missing' };
  try {
    const { error } = await getSupabaseAdmin().from('god_email_sends').insert({
      organization_id: row.organizationId,
      organization_name: row.organizationName,
      recipient_email: row.recipientEmail,
      subject: SHOP_INVITE_SUBJECT,
      template_key: SHOP_INVITE_TEMPLATE_KEY,
      sent_by_user_id: row.sentByUserId,
      sent_by_email: row.sentByEmail,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not log send' };
  }
}

/**
 * POST /api/god/invite/send
 * Body: { organization_ids: (string|number)[], confirm: true }
 * Sends the locked shop invite to the admin email of each selected org only.
 * Never sends to every org. Never sends without confirm.
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

  const ids = selectedOrgIds(body.organization_ids ?? body.organizationIds);
  if (!ids.length) {
    return NextResponse.json(
      { error: 'Select one or more organizations. Nothing is auto-selected.' },
      { status: 400 }
    );
  }

  const all = await loadGodOrgs();
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

  for (const org of targets) {
    const recipient = org.adminEmail;
    if (!recipient) {
      results.push({
        organizationId: org.id,
        organizationName: org.name,
        recipient: '',
        ok: false,
        error: 'No admin email on this organization',
      });
      continue;
    }
    const sent = await sendResend(recipient);
    if (sent.ok) {
      const logged = await logSend({
        organizationId: org.id,
        organizationName: org.name,
        recipientEmail: recipient,
        sentByUserId: gate.caller.userId,
        sentByEmail: gate.caller.email,
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
    results,
  });
}
