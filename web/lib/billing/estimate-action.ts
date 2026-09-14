/**
 * Tokenized public estimate actions (approve / reject / modify).
 * Token is created at send time; customer_action is stored beside status
 * so list filters (draft/sent/invoiced/expired) stay unchanged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateActionUrl } from '@/lib/share';
import { approveEstimateCreatingUnscheduledRequest } from '@/lib/billing/approve-estimate';
import {
  ESTIMATE_VALID_DAYS,
  customerActionFromEstimate,
  customerActionLabel,
  isEstimateExpired,
  parseJsonField,
  resolveCustomerActionApply,
  type CustomerActionKind,
} from '@/lib/billing/save-helpers';
import {
  CUSTOMER_ACTION_APPROVED,
  CUSTOMER_ACTION_CHANGES,
  CUSTOMER_ACTION_REJECTED,
  buildOrgNotifyEmail,
  escHtml,
  generateEstimateActionToken,
  isValidEstimateActionToken,
  mergeCustomerActionIntoEstimateData,
} from '@/lib/billing/estimate-action-helpers';

export { customerActionFromEstimate, customerActionLabel, estimateActionUrl };
export {
  CUSTOMER_ACTION_APPROVED,
  CUSTOMER_ACTION_CHANGES,
  CUSTOMER_ACTION_REJECTED,
  buildOrgNotifyEmail,
  generateEstimateActionToken,
  isValidEstimateActionToken,
  mergeCustomerActionIntoEstimateData,
};
export type { CustomerActionKind };
export type { EstimateCustomerAction } from '@/lib/billing/estimate-action-helpers';

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
): Promise<{ already: boolean; conflict: boolean; action: CustomerActionKind }> {
  const prev = customerActionFromEstimate(estimate);
  const resolved = resolveCustomerActionApply(prev.action, action);
  if (!resolved.apply) {
    return { already: true, conflict: resolved.conflict, action: prev.action || action };
  }
  const at = new Date().toISOString();
  const nextNote =
    action === CUSTOMER_ACTION_CHANGES
      ? (note || '').trim() || prev.note
      : prev.note;
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
    if (!error) return { already: false, conflict: false, action };
    if (!/column|schema cache|does not exist/i.test(error.message || '')) {
      throw new Error(error.message);
    }
  }
  throw new Error('Could not save customer action');
}

/**
 * Apply a tokenized email CTA. Approve still creates the unscheduled shop ticket
 * when possible; if that write fails the customer_action is still recorded.
 */
export async function applyEstimateCustomerAction(
  client: SupabaseClient,
  estimate: any,
  action: CustomerActionKind,
  note: string | null
): Promise<{
  already: boolean;
  conflict: boolean;
  action: CustomerActionKind;
  ticket?: { id: string | number; ticket_number: string | null } | null;
}> {
  const prev = customerActionFromEstimate(estimate);
  const resolved = resolveCustomerActionApply(prev.action, action);
  if (!resolved.apply) {
    return { already: true, conflict: resolved.conflict, action: prev.action || action };
  }

  if (action === CUSTOMER_ACTION_APPROVED) {
    try {
      const { already, ticket } = await approveEstimateCreatingUnscheduledRequest(client, estimate);
      return { already, conflict: false, action, ticket };
    } catch (e) {
      console.warn('approve ticket from estimate action failed; recording approval only', e);
      const saved = await persistCustomerAction(client, estimate, action, note);
      return { ...saved, ticket: null };
    }
  }

  const saved = await persistCustomerAction(client, estimate, action, note);
  return { ...saved, ticket: null };
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

/** Shop inbox + email when a clinic acts from the dashboard or a token link. */
export async function notifyShopOfCustomerAction(
  client: SupabaseClient,
  estimate: any,
  action: CustomerActionKind,
  note: string | null
): Promise<void> {
  const { companyName, emails } = await resolveOrgNotifyEmails(client, estimate);
  const payload = publicEstimatePayload(estimate, companyName);
  const ed = parseJsonField(estimate.estimate_data);
  const customerEmail = ed.custEmail || ed.email || null;
  const mail = buildOrgNotifyEmail({
    action,
    companyName,
    customerName: payload.customerName,
    estimateNumber: payload.estimateNumber,
    total: payload.total,
    note: action === CUSTOMER_ACTION_CHANGES ? note : null,
    estimateId: estimate.id,
  });
  if (!emails.length) {
    console.warn('org notify: no recipient emails for estimate', estimate.id);
    return;
  }
  const sent = await sendResendHtml({
    to: emails,
    subject: mail.subject,
    html: mail.html,
    replyTo: customerEmail && String(customerEmail).includes('@') ? String(customerEmail) : undefined,
  });
  if (!sent.ok) console.warn('org notify email skipped', sent.error);
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
