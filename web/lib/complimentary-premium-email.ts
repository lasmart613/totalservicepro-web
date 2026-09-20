/**
 * Transactional mail when Larry gifts a 60-day complimentary Premium trial.
 * Server-only builders + Resend send. Do not import from client components.
 *
 * Soft beta. Not a paid subscription. No ads.
 */

import {
  COMPLIMENTARY_PREMIUM_DAYS,
  clampComplimentaryDays,
  isComplimentaryGrant,
} from './complimentary-premium.ts';
import { SHARED_SERVICE_HISTORY_LINE, planTileLines } from './billing/plan-tiles.ts';
import { pickAdminEmail, type GodMember } from './god-orgs.ts';
import type { OrgPlanFields } from './org-plan.ts';

export const COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY = 'complimentary_premium_trial';
export const COMPLIMENTARY_PREMIUM_TRIAL_SUBJECT = '60 days of Premium on us';
export const COMPLIMENTARY_PREMIUM_TRIAL_CTA = 'Log in';
export const COMPLIMENTARY_PREMIUM_TRIAL_LOGIN_PATH = '/login?next=%2Fhub';
export const COMPLIMENTARY_PREMIUM_TRIAL_FROM_DEFAULT =
  'Total Service Pro <contact@medicalrepairnetwork.com>';
export const COMPLIMENTARY_PREMIUM_TRIAL_REPLY_TO_DEFAULT = 'contact@medicalrepairnetwork.com';

export const COMPLIMENTARY_PREMIUM_TRIAL_FORBIDDEN_PHRASES = [
  'AdSense',
  'Google Ads',
  'unlock your',
  'elevate your',
  'game-changer',
  'leverage',
  'journey',
  'you have been charged',
  'paid subscription started',
] as const;

const SKIP_TILE_LINES = new Set(['Paid plan for shops that need more of the app']);

const SHOP_TOOL_LINES = [
  'Write estimates and invoices on the same job',
  'Schedule service calls on the calendar',
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ComplimentaryTrialCopy = {
  organizationName?: string | null;
  firstName?: string | null;
  premiumUntil?: string | null;
  days?: number;
  loginUrl?: string | null;
  now?: Date;
};

export type ComplimentaryTrialSendRow = {
  template_key?: string | null;
  organization_id?: string | number | null;
  recipient_email?: string | null;
  created_at?: string | null;
};

export type ComplimentaryTrialRecipient = {
  email: string;
  firstName: string | null;
};

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function orgName(name?: string | null): string {
  return String(name || '').trim() || 'your shop';
}

export function complimentaryTrialEmailKey(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function isValidComplimentaryTrialEmail(value?: string | null): boolean {
  const email = String(value || '').trim();
  return email.length >= 6 && email.length <= 254 && EMAIL_RE.test(email);
}

export function complimentaryPremiumTrialLoginUrl(origin?: string | null): string {
  const base = String(origin || 'https://repairplanet.net').replace(/\/$/, '');
  return `${base}/login?next=${encodeURIComponent('/hub')}`;
}

export function complimentaryPremiumTrialFromAddress(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    String(env.NOTIFY_FROM_EMAIL || env.RESEND_FROM || '').trim() ||
    COMPLIMENTARY_PREMIUM_TRIAL_FROM_DEFAULT
  );
}

export function complimentaryPremiumTrialReplyTo(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    String(env.NOTIFY_REPLY_TO || env.RESEND_REPLY_TO || '').trim() ||
    COMPLIMENTARY_PREMIUM_TRIAL_REPLY_TO_DEFAULT
  );
}

/**
 * Company Premium tile lines (live /plans copy) plus shop tools the trial
 * actually includes. Drops the "paid plan" marketing line — this mail is a gift.
 */
export function complimentaryPremiumTrialBenefits(): string[] {
  const tiles = planTileLines('company', 'premium').filter((line) => !SKIP_TILE_LINES.has(line));
  const historyIdx = tiles.findIndex((line) => line === SHARED_SERVICE_HISTORY_LINE);
  if (historyIdx >= 0) {
    return [...tiles.slice(0, historyIdx + 1), ...SHOP_TOOL_LINES, ...tiles.slice(historyIdx + 1)];
  }
  return [...tiles, ...SHOP_TOOL_LINES];
}

export function formatComplimentaryTrialEndDate(
  iso?: string | null,
  opts: { now?: Date; days?: number } = {}
): string {
  const days = clampComplimentaryDays(opts.days);
  const parsed = iso ? Date.parse(String(iso)) : NaN;
  const date = Number.isFinite(parsed)
    ? new Date(parsed)
    : new Date((opts.now ?? new Date()).getTime() + days * 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return `${days} days from today`;
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function complimentaryPremiumTrialSubject(organizationName?: string | null): string {
  const shop = String(organizationName || '').trim();
  return shop ? `${shop}: 60 days of Premium on us` : COMPLIMENTARY_PREMIUM_TRIAL_SUBJECT;
}

/** True when the org already has unexpired complimentary Premium. */
export function hadActiveComplimentaryWindow(
  org: (OrgPlanFields & { premium_until?: string | null }) | null | undefined,
  now: Date = new Date()
): boolean {
  if (!org || org.is_premium !== true || !org.premium_until) return false;
  const until = Date.parse(String(org.premium_until));
  if (!Number.isFinite(until) || until <= now.getTime()) return false;
  if (org.premium_grant != null && org.premium_grant !== '' && !isComplimentaryGrant(org.premium_grant)) {
    return false;
  }
  return true;
}

export function complimentaryTrialEmailWindowMs(
  days: number = COMPLIMENTARY_PREMIUM_DAYS
): number {
  return clampComplimentaryDays(days) * 24 * 60 * 60 * 1000;
}

/** Same org + email + template inside the current trial window = already told them. */
export function complimentaryTrialEmailAlreadySent(opts: {
  sends: ComplimentaryTrialSendRow[];
  organizationId: string | number;
  recipientEmail: string;
  now?: Date;
  windowMs?: number;
}): boolean {
  const emailKey = complimentaryTrialEmailKey(opts.recipientEmail);
  if (!emailKey) return false;
  const orgKey = String(opts.organizationId);
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - (opts.windowMs ?? complimentaryTrialEmailWindowMs());

  return opts.sends.some((row) => {
    if (complimentaryTrialEmailKey(row.recipient_email) !== emailKey) return false;
    if (String(row.template_key || '').toLowerCase() !== COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY) {
      return false;
    }
    if (row.organization_id != null && String(row.organization_id) !== orgKey) return false;
    const at = Date.parse(String(row.created_at || ''));
    if (!Number.isFinite(at)) return true;
    return at >= cutoff;
  });
}

/**
 * Send unless this window already mailed them.
 * If god_email_sends cannot be read, skip only when they already have an
 * active complimentary window (avoids a double-click spam without a log).
 */
export function shouldSendComplimentaryTrialEmail(opts: {
  alreadySent: boolean;
  sendLogAvailable: boolean;
  hadActiveComplimentaryWindow: boolean;
}): boolean {
  if (opts.alreadySent) return false;
  if (!opts.sendLogAvailable && opts.hadActiveComplimentaryWindow) return false;
  return true;
}

/** Admin email (then org email). One recipient per shop — same as shop invite. */
export function complimentaryTrialRecipients(input: {
  orgEmail?: string | null;
  members: Array<{
    email?: string | null;
    firstName?: string | null;
    role?: string | null;
    organizationId?: string | number | null;
  }>;
}): ComplimentaryTrialRecipient[] {
  const members = input.members as GodMember[];
  const email = pickAdminEmail({ orgEmail: input.orgEmail, members });
  if (!isValidComplimentaryTrialEmail(email)) return [];
  const member = members.find(
    (row) => complimentaryTrialEmailKey(row.email) === complimentaryTrialEmailKey(email)
  );
  return [
    {
      email: String(email).trim(),
      firstName: String(member?.firstName || '').trim() || null,
    },
  ];
}

function trialFields(opts: ComplimentaryTrialCopy) {
  const days = clampComplimentaryDays(opts.days);
  return {
    org: orgName(opts.organizationName),
    greetName: String(opts.firstName || '').trim(),
    until: formatComplimentaryTrialEndDate(opts.premiumUntil, { now: opts.now, days }),
    days,
    loginUrl:
      String(opts.loginUrl || '').trim() || complimentaryPremiumTrialLoginUrl(),
    benefits: complimentaryPremiumTrialBenefits(),
  };
}

function bulletRow(text: string): string {
  return (
    `<tr>` +
    `<td valign="top" style="width:18px;padding:0 8px 8px 0;font-size:13px;line-height:1.55;color:#d4af37;">&#9656;</td>` +
    `<td valign="top" style="padding:0 0 8px;font-size:15px;line-height:1.55;color:#e8edf4;">${esc(text)}</td>` +
    `</tr>`
  );
}

function wrapTrialEmail(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#0f1419;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8edf4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1419;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#161c24;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background:#d4af37;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;text-align:center;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#d4af37;text-transform:uppercase;">TOTAL SERVICE PRO</div>
              <div style="font-family:Georgia,Times New Roman,Times,serif;font-size:32px;line-height:1.2;color:#e8edf4;margin-top:8px;">RepairPlanet</div>
              <div style="font-size:13px;color:#8b95a5;margin-top:6px;">Complimentary Premium trial</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 8px;">${inner}</td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #243040;text-align:center;">
              <div style="font-size:11px;color:#8b95a5;">
                Sent by <span style="color:#d4af37;font-weight:700;">Total Service Pro</span>
                &nbsp;&middot;&nbsp;
                <a href="https://repairplanet.net" style="color:#8b95a5;text-decoration:none;">repairplanet.net</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function complimentaryPremiumTrialHtml(opts: ComplimentaryTrialCopy): string {
  const { org, greetName, until, days, loginUrl, benefits } = trialFields(opts);
  const subject = complimentaryPremiumTrialSubject(opts.organizationName);
  const greet = greetName ? `Hi ${esc(greetName)},` : 'Hi,';
  const bullets = benefits.map((line) => bulletRow(line)).join('');
  const inner =
    `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#e8edf4;">${greet}</p>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#e8edf4;">` +
    `<strong>${esc(org)}</strong> received a complimentary ${days}-day Premium trial on RepairPlanet. ` +
    `This is not a paid subscription. No card. No charge.` +
    `</p>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#e8edf4;">` +
    `Premium is on through <strong style="color:#d4af37;">${esc(until)}</strong>.` +
    `</p>` +
    `<p style="margin:0 0 10px;font-size:15px;line-height:1.55;color:#e8edf4;">What you get during the trial:</p>` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 8px;">${bullets}</table>` +
    `<p style="margin:16px 0;font-size:15px;line-height:1.6;color:#e8edf4;">` +
    `This is a soft beta. You will see rough edges. After the trial you can stay on the Free Plan, keep Premium, or walk away.` +
    `</p>` +
    `<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:22px auto 8px;">` +
    `<tr><td align="center" style="border-radius:8px;background:#d4af37;">` +
    `<a href="${esc(loginUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#111111;text-decoration:none;border-radius:8px;">${esc(COMPLIMENTARY_PREMIUM_TRIAL_CTA)}</a>` +
    `</td></tr></table>` +
    `<p style="margin:0 0 8px;text-align:center;font-size:12px;line-height:1.5;color:#8b95a5;word-break:break-all;">` +
    `<a href="${esc(loginUrl)}" style="color:#d4af37;text-decoration:none;">${esc(loginUrl)}</a>` +
    `</p>`;
  return wrapTrialEmail(subject, inner);
}

export function complimentaryPremiumTrialText(opts: ComplimentaryTrialCopy): string {
  const { org, greetName, until, days, loginUrl, benefits } = trialFields(opts);
  return [
    greetName ? `Hi ${greetName},` : 'Hi,',
    '',
    `${org} received a complimentary ${days}-day Premium trial on RepairPlanet. This is not a paid subscription. No card. No charge.`,
    '',
    `Premium is on through ${until}.`,
    '',
    'What you get during the trial:',
    ...benefits.map((line) => `- ${line}`),
    '',
    'This is a soft beta. You will see rough edges. After the trial you can stay on the Free Plan, keep Premium, or walk away.',
    '',
    `${COMPLIMENTARY_PREMIUM_TRIAL_CTA}: ${loginUrl}`,
    '',
    'Sent by Total Service Pro · repairplanet.net',
  ].join('\n');
}

export async function sendComplimentaryPremiumTrialEmail(opts: {
  to: string;
  copy: ComplimentaryTrialCopy;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const env = opts.env || process.env;
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const to = String(opts.to || '').trim();
  if (!isValidComplimentaryTrialEmail(to)) {
    return { ok: false, error: 'No valid recipient email' };
  }
  const subject = complimentaryPremiumTrialSubject(opts.copy.organizationName);
  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: complimentaryPremiumTrialFromAddress(env),
      to: [to],
      reply_to: complimentaryPremiumTrialReplyTo(env),
      subject,
      html: complimentaryPremiumTrialHtml(opts.copy),
      text: complimentaryPremiumTrialText(opts.copy),
    }),
  });
  const result = await rr.json().catch(() => ({}));
  if (!rr.ok) {
    return { ok: false, error: result?.message || `Email provider error (${rr.status})` };
  }
  return { ok: true, id: result?.id || undefined };
}
