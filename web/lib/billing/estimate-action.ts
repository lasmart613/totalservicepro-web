/**
 * Tokenized public estimate actions (approve / request changes).
 * Token is created at send time; customer_action is stored beside status
 * so list filters (draft/sent/invoiced/expired) stay unchanged.
 */

import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_ORIGIN, estimateActionUrl } from '@/lib/share';
import {
  ESTIMATE_VALID_DAYS,
  customerActionFromEstimate,
  customerActionLabel,
  isEstimateExpired,
  parseJsonField,
  type CustomerActionKind,
} from '@/lib/billing/save-helpers';

export { customerActionFromEstimate, customerActionLabel, estimateActionUrl };
export const CUSTOMER_ACTION_APPROVED = 'approved' as const;
export const CUSTOMER_ACTION_CHANGES = 'changes_requested' as const;

export type { CustomerActionKind };

export type EstimateCustomerAction = {
  action: CustomerActionKind | null;
  at: string | null;
  note: string | null;
  token: string | null;
};

const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

export function isValidEstimateActionToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token.trim());
}

export function generateEstimateActionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function mergeCustomerActionIntoEstimateData(
  estimateData: unknown,
  fields: Partial<EstimateCustomerAction> & { token?: string | null }
): Record<string, unknown> {
  const ed = { ...parseJsonField(estimateData) };
  if (fields.token != null) ed.customer_action_token = fields.token;
  if (fields.action !== undefined) ed.customer_action = fields.action;
  if (fields.at !== undefined) ed.customer_action_at = fields.at;
  if (fields.note !== undefined) ed.customer_action_note = fields.note;
  return ed;
}

function escAttr(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escHtml(s: unknown) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function readExistingActionToken(est: any): string | null {
  return customerActionFromEstimate(est || {}).token;
}

export async function persistEstimateActionToken(
  client: SupabaseClient,
  estimateId: string | number,
  token: string,
  existingEstimateData?: unknown
): Promise<void> {
  const ed = mergeCustomerActionIntoEstimateData(existingEstimateData, { token });
  const attempts: Record<string, unknown>[] = [
    { customer_action_token: token, estimate_data: ed },
    { estimate_data: ed },
  ];
  for (const body of attempts) {
    const { error } = await client.from('service_estimates').update(body).eq('id', estimateId);
    if (!error) return;
    if (!/column|schema cache|does not exist/i.test(error.message || '')) {
      console.warn('persistEstimateActionToken', error.message);
      return;
    }
  }
}

export async function findEstimateByActionToken(
  client: SupabaseClient,
  token: string
): Promise<any | null> {
  if (!isValidEstimateActionToken(token)) return null;

  const { data, error } = await client
    .from('service_estimates')
    .select('*')
    .eq('customer_action_token', token)
    .maybeSingle();
  if (!error && data) return data;
  if (error && !/column|schema cache|does not exist/i.test(error.message || '')) {
    console.warn('findEstimateByActionToken column', error.message);
  }

  const { data: viaJson, error: jsonErr } = await client
    .from('service_estimates')
    .select('*')
    .filter('estimate_data->>customer_action_token', 'eq', token)
    .limit(1)
    .maybeSingle();
  if (jsonErr) {
    console.warn('findEstimateByActionToken json', jsonErr.message);
    return null;
  }
  return viaJson || null;
}

export async function persistCustomerAction(
  client: SupabaseClient,
  estimate: any,
  action: CustomerActionKind,
  note: string | null
): Promise<{ already: boolean }> {
  const prev = customerActionFromEstimate(estimate);
  if (action === CUSTOMER_ACTION_APPROVED && prev.action === CUSTOMER_ACTION_APPROVED) {
    return { already: true };
  }
  const at = new Date().toISOString();
  const nextNote =
    action === CUSTOMER_ACTION_CHANGES ? (note || '').trim() || null : prev.note;
  const ed = mergeCustomerActionIntoEstimateData(estimate.estimate_data, {
    token: prev.token,
    action,
    at,
    note: nextNote,
  });
  const attempts: Record<string, unknown>[] = [
    {
      customer_action: action,
      customer_action_at: at,
      customer_action_note: nextNote,
      estimate_data: ed,
    },
    { estimate_data: ed },
  ];
  for (const body of attempts) {
    const { error } = await client.from('service_estimates').update(body).eq('id', estimate.id);
    if (!error) return { already: false };
    if (!/column|schema cache|does not exist/i.test(error.message || '')) {
      throw new Error(error.message);
    }
  }
  throw new Error('Could not save customer action');
}

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export async function resolveOrgNotifyEmails(
  client: SupabaseClient,
  estimate: any
): Promise<{ emails: string[]; companyName: string }> {
  const emails = new Set<string>();
  let companyName = 'your service company';

  if (estimate.organization_id != null) {
    try {
      const { data: org } = await client
        .from('organizations')
        .select('name, email')
        .eq('id', estimate.organization_id)
        .maybeSingle();
      if (org?.name) companyName = String(org.name);
      if (org?.email && isValidEmail(String(org.email).trim())) {
        emails.add(String(org.email).trim());
      }
    } catch {
      /* continue */
    }
  }

  if (estimate.created_by) {
    try {
      const { data: prof } = await client
        .from('user_profiles')
        .select('email, first_name, last_name')
        .eq('id', estimate.created_by)
        .maybeSingle();
      if (prof?.email && isValidEmail(String(prof.email).trim())) {
        emails.add(String(prof.email).trim());
      }
    } catch {
      /* continue */
    }
    try {
      const { data } = await client.auth.admin.getUserById(String(estimate.created_by));
      const authEmail = data?.user?.email;
      if (authEmail && isValidEmail(authEmail.trim())) emails.add(authEmail.trim());
    } catch {
      /* admin API may be unavailable */
    }
  }

  const ed = parseJsonField(estimate.estimate_data);
  const companyEmail = ed.companyEmail || ed.company_email;
  if (companyEmail && isValidEmail(String(companyEmail).trim())) {
    emails.add(String(companyEmail).trim());
  }
  if (ed.company_name && !estimate.organization_id) {
    companyName = String(ed.company_name);
  }

  return { emails: Array.from(emails), companyName };
}

export function buildOrgNotifyEmail(opts: {
  action: CustomerActionKind;
  companyName: string;
  customerName: string;
  estimateNumber: string;
  total: number;
  note: string | null;
  estimateId: string | number;
}): { subject: string; html: string } {
  const num = opts.estimateNumber || String(opts.estimateId);
  const total = `$${(Number(opts.total) || 0).toFixed(2)}`;
  const approved = opts.action === CUSTOMER_ACTION_APPROVED;
  const subject = approved
    ? `Estimate ${num} approved by ${opts.customerName}`
    : `Changes requested on estimate ${num} by ${opts.customerName}`;
  const detailUrl = `${(SITE_ORIGIN || 'https://repairplanet.net').replace(/\/$/, '')}/estimates/new?id=${encodeURIComponent(String(opts.estimateId))}`;
  const noteBlock =
    opts.note && opts.note.trim()
      ? `<div style="margin:16px 0;padding:12px;background:#f8f4e8;border:1px solid #e8d9a0;border-radius:6px;">` +
        `<div style="font-size:11px;font-weight:700;color:#8a6f2e;text-transform:uppercase;margin-bottom:6px;">Customer note</div>` +
        `<div style="font-size:14px;color:#111;white-space:pre-wrap;">${escHtml(opts.note)}</div></div>`
      : '';

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.45;max-width:640px;margin:auto;">` +
    `<div style="border-bottom:3px solid #FBBF24;padding-bottom:8px;margin-bottom:16px;">` +
    `<div style="font-size:18px;font-weight:800;">${escHtml(opts.companyName)}</div>` +
    `<div style="font-size:13px;color:#555;">Estimate customer response</div></div>` +
    `<p style="margin:0 0 12px;"><strong>${escHtml(opts.customerName)}</strong> ` +
    (approved
      ? `approved estimate <strong>${escHtml(num)}</strong> (${escHtml(total)}).`
      : `requested changes on estimate <strong>${escHtml(num)}</strong> (${escHtml(total)}).`) +
    `</p>` +
    noteBlock +
    `<p style="margin:16px 0;"><a href="${escAttr(detailUrl)}" ` +
    `style="display:inline-block;background:#FBBF24;color:#111827;padding:10px 18px;border-radius:8px;` +
    `text-decoration:none;font-weight:700;">Open estimate</a></p>` +
    `<p style="font-size:12px;color:#666;margin-top:20px;">Sent via Total Service Pro · repairplanet.net</p>` +
    `</div>`;

  return { subject, html };
}

export async function sendResendHtml(opts: {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, error: 'RESEND_API_KEY not configured' };
  if (!opts.to.length) return { ok: false, error: 'No notify recipients' };

  const from =
    process.env.NOTIFY_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    'Total Service Pro <contact@medicalrepairnetwork.com>';

  const wrapped = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escHtml(opts.subject)}</title></head>
<body style="margin:0;padding:16px;background:#f4f4f5;font-family:system-ui,sans-serif;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 12px rgba(0,0,0,.06);">
    ${opts.html}
  </div>
</body></html>`;

  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: opts.subject,
      html: wrapped,
      reply_to: opts.replyTo || undefined,
    }),
  });
  if (!rr.ok) {
    const result = await rr.json().catch(() => ({}));
    const msg = result?.message || `Email provider error (${rr.status})`;
    console.error('Resend org notify failed', result);
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export function publicEstimatePayload(estimate: any, companyName: string) {
  const ed = parseJsonField(estimate.estimate_data);
  const action = customerActionFromEstimate(estimate);
  const expired = isEstimateExpired(estimate);
  const createdAt = estimate.created_at || null;
  let validUntil: string | null = null;
  if (createdAt) {
    const d = new Date(createdAt);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() + ESTIMATE_VALID_DAYS);
      validUntil = d.toISOString();
    }
  }
  return {
    estimateId: estimate.id ?? null,
    estimateNumber: estimate.estimate_number || ed.estimate_number || ed.estNumber || '',
    customerName: estimate.customer_name || ed.customer_name || 'Customer',
    total: Number(estimate.total) || Number(ed.total) || 0,
    companyName,
    validDays: ESTIMATE_VALID_DAYS,
    validUntil,
    createdAt,
    expired,
    customerAction: action.action,
    customerActionAt: action.at,
    customerActionNote: action.note,
  };
}
