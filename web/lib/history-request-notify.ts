/**
 * Server-side notifications for service history requests (000922).
 * Called by the API routes with a service-role client AFTER the user-session
 * RPC succeeded. A notify failure never undoes the request or the decision.
 *
 * notifications.type has a CHECK list on prod; these rows use type 'general'
 * and carry { kind, request_id } in data. One row per (user, kind, request):
 * a retry skips users who already have it.
 *
 * Clinic: owner/company_admin/admin/manager members (the roles that can
 *   approve), in-app always; email if their prefs allow and the clinic is
 *   under 10 request emails in 24h (take_service_history_slot).
 * Shop:   requester + shop owner/admin members, in-app; email on approval
 *   only (denial is in-app only).
 */
import {
  HISTORY_NOTIFICATION_KINDS,
  INBOX_PATH,
} from './service-history-requests.ts';
import {
  historyApprovedHtml,
  historyApprovedSubject,
  historyApprovedText,
  historyRequestHtml,
  historyRequestSubject,
  historyRequestText,
  isEmailAddress,
  type OutgoingEmail,
} from './history-request-email.ts';

export type NoticeRecipient = {
  user_id: string;
  email?: string | null;
  first_name?: string | null;
  email_ok?: boolean;
  is_requester?: boolean;
};

export type RequestNotice = {
  id: number;
  status: string;
  owner_org_id: number;
  owner_name?: string | null;
  shop_org_id: number;
  shop_name?: string | null;
  equipment_id: number;
  laser?: string | null;
  serial_number?: string | null;
  teaser_count?: number | null;
  requested_by?: string | null;
  requested_by_name?: string | null;
  notified_at?: string | null;
  owner_recipients: NoticeRecipient[];
  shop_recipients: NoticeRecipient[];
};

type Result = { data?: any; error?: any };
type Thenable = PromiseLike<Result>;

/** The small slice of the service-role Supabase client this needs. */
export type NotifyAdmin = {
  rpc: (fn: string, args?: Record<string, unknown>) => Thenable;
  from: (table: string) => any;
};

export type NotifyDeps = {
  admin: NotifyAdmin;
  send: (msg: OutgoingEmail) => Promise<{ ok: boolean; error?: string }>;
  origin: string;
};

export type NotifyOutcome = { notified: number; emailed: number; skippedEmail: number; error?: string };

export const OWNER_EMAILS_PER_DAY = 10;

async function loadNotice(admin: NotifyAdmin, requestId: number): Promise<RequestNotice | null> {
  const { data, error } = await admin.rpc('service_history_request_notice', { p_request_id: requestId });
  if (error || !data || typeof data !== 'object') return null;
  return data as RequestNotice;
}

async function alreadyNotified(admin: NotifyAdmin, kind: string, requestId: number, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const { data } = await admin
    .from('notifications')
    .select('user_id')
    .eq('type', 'general')
    .contains('data', { kind, request_id: requestId })
    .in('user_id', userIds);
  return new Set((Array.isArray(data) ? data : []).map((r: any) => String(r.user_id)));
}

function laserText(n: RequestNotice): string {
  const laser = String(n.laser || '').trim() || 'a laser';
  return n.serial_number ? `${laser} (SN ${n.serial_number})` : laser;
}

export function ownerNotificationMessage(n: RequestNotice): string {
  const count = Math.max(0, Number(n.teaser_count) || 0);
  return `${n.shop_name || 'A service company'} asked to see the earlier service history of ${laserText(n)}${
    count ? ` (${count} report${count === 1 ? '' : 's'})` : ''
  }.`;
}

export function shopNotificationMessage(n: RequestNotice): string {
  const clinic = n.owner_name || 'The clinic';
  return n.status === 'approved'
    ? `${clinic} shared the earlier service history of ${laserText(n)}.`
    : `${clinic} declined to share the earlier service history of ${laserText(n)}.`;
}

export function shopLink(n: RequestNotice): string {
  return `/customers/${n.owner_org_id}?tab=equipment&eq=${n.equipment_id}`;
}

export function inboxLink(n: RequestNotice): string {
  return `${INBOX_PATH}?r=${n.id}`;
}

/** New request: tell the clinic's owners/admins (in-app + capped email). */
export async function notifyOwnersOfRequest(deps: NotifyDeps, requestId: number, triggeredBy: string): Promise<NotifyOutcome> {
  const out: NotifyOutcome = { notified: 0, emailed: 0, skippedEmail: 0 };
  const n = await loadNotice(deps.admin, requestId);
  if (!n) return { ...out, error: 'request not found' };
  if (n.notified_at) return out;
  const kind = HISTORY_NOTIFICATION_KINDS.request;
  const recipients = (n.owner_recipients || []).filter((r) => r && r.user_id);
  const done = await alreadyNotified(deps.admin, kind, n.id, recipients.map((r) => String(r.user_id)));
  const fresh = recipients.filter((r) => !done.has(String(r.user_id)));
  if (fresh.length) {
    const { error } = await deps.admin.from('notifications').insert(
      fresh.map((r) => ({
        user_id: r.user_id,
        type: 'general',
        message: ownerNotificationMessage(n),
        triggered_by: triggeredBy,
        is_read: false,
        link: inboxLink(n),
        data: { kind, request_id: n.id, equipment_id: n.equipment_id },
      }))
    );
    if (error) return { ...out, error: error.message || String(error) };
    out.notified = fresh.length;
  }
  const url = `${deps.origin.replace(/\/$/, '')}${inboxLink(n)}`;
  for (const r of fresh) {
    if (!r.email_ok || !isEmailAddress(r.email)) {
      out.skippedEmail += 1;
      continue;
    }
    const { data: slot } = await deps.admin.rpc('take_service_history_slot', {
      p_bucket: 'request_email_owner',
      p_key: String(n.owner_org_id),
      p_max: OWNER_EMAILS_PER_DAY,
      p_window: '24 hours',
    });
    if (slot !== true) {
      out.skippedEmail += 1;
      continue;
    }
    const copy = {
      firstName: r.first_name,
      shopName: n.shop_name,
      laser: n.laser,
      serialNumber: n.serial_number,
      reportCount: n.teaser_count,
      url,
    };
    const sent = await deps.send({
      to: String(r.email),
      subject: historyRequestSubject(copy),
      html: historyRequestHtml(copy),
      text: historyRequestText(copy),
    });
    if (sent.ok) out.emailed += 1;
    else out.skippedEmail += 1;
  }
  await deps.admin.from('service_history_requests').update({ notified_at: new Date().toISOString() }).eq('id', n.id);
  return out;
}

/** Decision: tell the shop (in-app; email only on approval, only the requester). */
export async function notifyShopOfResponse(deps: NotifyDeps, requestId: number, triggeredBy: string): Promise<NotifyOutcome> {
  const out: NotifyOutcome = { notified: 0, emailed: 0, skippedEmail: 0 };
  const n = await loadNotice(deps.admin, requestId);
  if (!n) return { ...out, error: 'request not found' };
  if (n.status !== 'approved' && n.status !== 'denied') return out;
  const kind = n.status === 'approved' ? HISTORY_NOTIFICATION_KINDS.approved : HISTORY_NOTIFICATION_KINDS.denied;
  const recipients = (n.shop_recipients || []).filter((r) => r && r.user_id);
  const done = await alreadyNotified(deps.admin, kind, n.id, recipients.map((r) => String(r.user_id)));
  const fresh = recipients.filter((r) => !done.has(String(r.user_id)));
  if (fresh.length) {
    const { error } = await deps.admin.from('notifications').insert(
      fresh.map((r) => ({
        user_id: r.user_id,
        type: 'general',
        message: shopNotificationMessage(n),
        triggered_by: triggeredBy,
        is_read: false,
        link: shopLink(n),
        data: { kind, request_id: n.id, equipment_id: n.equipment_id },
      }))
    );
    if (error) return { ...out, error: error.message || String(error) };
    out.notified = fresh.length;
  }
  if (n.status !== 'approved') return out;
  const url = `${deps.origin.replace(/\/$/, '')}${shopLink(n)}`;
  for (const r of fresh) {
    if (!r.is_requester || !r.email_ok || !isEmailAddress(r.email)) continue;
    const copy = { firstName: r.first_name, clinicName: n.owner_name, laser: n.laser, serialNumber: n.serial_number, url };
    const sent = await deps.send({
      to: String(r.email),
      subject: historyApprovedSubject(copy),
      html: historyApprovedHtml(copy),
      text: historyApprovedText(copy),
    });
    if (sent.ok) out.emailed += 1;
    else out.skippedEmail += 1;
  }
  return out;
}
