/**
 * Server-only: email the shop admin after a God complimentary Premium grant.
 * Do not import from client components.
 */

import { clampComplimentaryDays } from './complimentary-premium.ts';
import {
  COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY,
  complimentaryPremiumTrialLoginUrl,
  complimentaryPremiumTrialSubject,
  complimentaryTrialEmailAlreadySent,
  complimentaryTrialEmailWindowMs,
  complimentaryTrialRecipients,
  hadActiveComplimentaryWindow,
  sendComplimentaryPremiumTrialEmail,
  shouldSendComplimentaryTrialEmail,
  type ComplimentaryTrialCopy,
  type ComplimentaryTrialSendRow,
} from './complimentary-premium-email.ts';
import { type GodMember } from './god-orgs.ts';
import type { OrgPlanFields } from './org-plan.ts';
import { getSupabaseAdmin, hasServiceRole } from './supabase/admin.ts';

export type ComplimentaryTrialNotifyGrant = {
  id: string | number;
  name: string;
  premium_until: string;
};

export type ComplimentaryTrialNotifyResult = {
  organizationId: string | number;
  organizationName: string;
  recipient: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

async function loadRecentTrialSends(
  organizationIds: Array<string | number>,
  sinceIso: string
): Promise<{ available: boolean; sends: ComplimentaryTrialSendRow[] }> {
  if (!organizationIds.length) return { available: true, sends: [] };
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('god_email_sends')
      .select('recipient_email, template_key, created_at, organization_id')
      .eq('template_key', COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY)
      .in('organization_id', organizationIds)
      .gte('created_at', sinceIso);
    if (error) {
      return { available: false, sends: [] };
    }
    return { available: true, sends: (data as ComplimentaryTrialSendRow[]) || [] };
  } catch {
    return { available: false, sends: [] };
  }
}

async function logTrialSend(row: {
  organizationId: string | number;
  organizationName: string;
  recipientEmail: string;
  subject: string;
  sentByUserId?: string;
  sentByEmail?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!hasServiceRole()) return { ok: false, error: 'Service role missing' };
  const payload = {
    organization_id: row.organizationId,
    organization_name: row.organizationName,
    recipient_email: row.recipientEmail,
    subject: row.subject,
    template_key: COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY,
    sent_by_user_id: row.sentByUserId || null,
    sent_by_email: row.sentByEmail || null,
  };
  try {
    const first = await getSupabaseAdmin().from('god_email_sends').insert(payload);
    if (!first.error) return { ok: true };
    if (!/column|schema cache|does not exist/i.test(first.error.message || '')) {
      return { ok: false, error: first.error.message };
    }
    const { sent_by_user_id, sent_by_email, ...legacy } = payload;
    void sent_by_user_id;
    void sent_by_email;
    const fallback = await getSupabaseAdmin().from('god_email_sends').insert(legacy);
    if (fallback.error) return { ok: false, error: fallback.error.message };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not log send' };
  }
}

async function loadOrgMembers(
  organizationIds: Array<string | number>
): Promise<Map<string, GodMember[]>> {
  const byOrg = new Map<string, GodMember[]>();
  if (!organizationIds.length) return byOrg;
  try {
    const admin = getSupabaseAdmin();
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('id, email, first_name, last_name, role, organization_id')
      .in('organization_id', organizationIds);
    for (const row of (profiles as Array<Record<string, unknown>> | null) || []) {
      const orgId = row.organization_id;
      if (orgId == null || orgId === '') continue;
      const key = String(orgId);
      const list = byOrg.get(key) || [];
      list.push({
        id: String(row.id),
        email: (row.email as string | null) || null,
        firstName: (row.first_name as string | null) || null,
        lastName: (row.last_name as string | null) || null,
        role: (row.role as string | null) || null,
        organizationId: orgId as string | number,
      });
      byOrg.set(key, list);
    }
  } catch {
    /* missing user_profiles — fall back to org.email */
  }
  return byOrg;
}

/**
 * After a successful God complimentary grant, email the shop admin.
 * Grant already happened — mail failure does not roll it back.
 */
export async function notifyComplimentaryPremiumGrants(opts: {
  grants: ComplimentaryTrialNotifyGrant[];
  priorOrgs: Array<
    OrgPlanFields & {
      id?: string | number;
      email?: string | null;
      name?: string | null;
    }
  >;
  days: number;
  sentByUserId?: string;
  sentByEmail?: string;
  now?: Date;
}): Promise<{
  emailed: ComplimentaryTrialNotifyResult[];
  skipped: ComplimentaryTrialNotifyResult[];
  emailedCount: number;
  skippedCount: number;
}> {
  const emailed: ComplimentaryTrialNotifyResult[] = [];
  const skipped: ComplimentaryTrialNotifyResult[] = [];
  const now = opts.now ?? new Date();
  const days = clampComplimentaryDays(opts.days);
  const grants = opts.grants || [];
  if (!grants.length) {
    return { emailed, skipped, emailedCount: 0, skippedCount: 0 };
  }

  const priorById = new Map<string, (typeof opts.priorOrgs)[number]>();
  for (const org of opts.priorOrgs || []) {
    if (org.id == null) continue;
    priorById.set(String(org.id), org);
  }

  const ids = grants.map((row) => row.id);
  const sinceIso = new Date(now.getTime() - complimentaryTrialEmailWindowMs(days)).toISOString();
  const recent = await loadRecentTrialSends(ids, sinceIso);
  const sendLogAvailable = recent.available;
  const sends = recent.sends;
  const membersByOrg = await loadOrgMembers(ids);
  const loginUrl = complimentaryPremiumTrialLoginUrl();

  for (const grant of grants) {
    const prior = priorById.get(String(grant.id));
    const recipients = complimentaryTrialRecipients({
      orgEmail: prior?.email ?? null,
      members: membersByOrg.get(String(grant.id)) || [],
    });
    if (!recipients.length) {
      skipped.push({
        organizationId: grant.id,
        organizationName: grant.name,
        recipient: '',
        ok: false,
        skipped: true,
        error: 'No admin email on this organization',
      });
      continue;
    }

    for (const recipient of recipients) {
      const alreadySent = complimentaryTrialEmailAlreadySent({
        sends,
        organizationId: grant.id,
        recipientEmail: recipient.email,
        now,
        windowMs: complimentaryTrialEmailWindowMs(days),
      });
      if (
        !shouldSendComplimentaryTrialEmail({
          alreadySent,
          sendLogAvailable,
          hadActiveComplimentaryWindow: hadActiveComplimentaryWindow(prior, now),
        })
      ) {
        skipped.push({
          organizationId: grant.id,
          organizationName: grant.name,
          recipient: recipient.email,
          ok: true,
          skipped: true,
          error: 'Already sent this trial email in the current window',
        });
        continue;
      }

      const copy: ComplimentaryTrialCopy = {
        organizationName: grant.name,
        firstName: recipient.firstName,
        premiumUntil: grant.premium_until,
        days,
        loginUrl,
        now,
      };
      const sent = await sendComplimentaryPremiumTrialEmail({ to: recipient.email, copy });
      if (!sent.ok) {
        skipped.push({
          organizationId: grant.id,
          organizationName: grant.name,
          recipient: recipient.email,
          ok: false,
          error: sent.error || 'Could not send trial email',
        });
        continue;
      }

      const logged = await logTrialSend({
        organizationId: grant.id,
        organizationName: grant.name,
        recipientEmail: recipient.email,
        subject: complimentaryPremiumTrialSubject(grant.name),
        sentByUserId: opts.sentByUserId,
        sentByEmail: opts.sentByEmail,
      });
      sends.push({
        template_key: COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY,
        organization_id: grant.id,
        recipient_email: recipient.email,
        created_at: now.toISOString(),
      });
      emailed.push({
        organizationId: grant.id,
        organizationName: grant.name,
        recipient: recipient.email,
        ok: true,
        error: logged.ok ? undefined : `Sent, but log failed: ${logged.error}`,
      });
    }
  }

  return {
    emailed,
    skipped,
    emailedCount: emailed.length,
    skippedCount: skipped.length,
  };
}
