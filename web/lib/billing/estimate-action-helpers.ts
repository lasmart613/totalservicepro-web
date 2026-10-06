/**
 * Pure helpers for tokenized estimate CTAs (safe for node:test — no @/ imports).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { publicSiteOrigin } from '../site-origin.ts';
import { formatOrgMoney, type OrgMoneyPrefs } from '../money-format.ts';
import {
  customerActionFromEstimate,
  parseCustomerActionKind,
  parseEstimateEmailAction,
  parseJsonField,
  resolveCustomerActionApply,
  type CustomerActionKind,
  type EstimateEmailAction,
} from './save-helpers.ts';

export const CUSTOMER_ACTION_APPROVED = 'approved' as const;
export const CUSTOMER_ACTION_REJECTED = 'rejected' as const;
export const CUSTOMER_ACTION_CHANGES = 'changes_requested' as const;

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

export function escAttr(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escHtml(s: unknown) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildOrgNotifyEmail(opts: {
  action: CustomerActionKind;
  companyName: string;
  customerName: string;
  estimateNumber: string;
  total: number;
  note: string | null;
  estimateId: string | number;
  moneyPrefs?: OrgMoneyPrefs | null;
  locale?: string | null;
}): { subject: string; html: string } {
  const num = opts.estimateNumber || String(opts.estimateId);
  const total = formatOrgMoney(opts.total, opts.moneyPrefs, opts.locale);
  const approved = opts.action === CUSTOMER_ACTION_APPROVED;
  const rejected = opts.action === CUSTOMER_ACTION_REJECTED;
  const subject = approved
    ? `Estimate ${num} approved by ${opts.customerName}`
    : rejected
      ? `Estimate ${num} rejected by ${opts.customerName}`
      : `Modification requested on estimate ${num} by ${opts.customerName}`;
  const detailUrl = `${publicSiteOrigin()}/estimates/new?id=${encodeURIComponent(String(opts.estimateId))}`;
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
      : rejected
        ? `rejected estimate <strong>${escHtml(num)}</strong> (${escHtml(total)}).`
        : `requested a modification on estimate <strong>${escHtml(num)}</strong> (${escHtml(total)}).`) +
    `</p>` +
    noteBlock +
    `<p style="margin:16px 0;"><a href="${escAttr(detailUrl)}" ` +
    `style="display:inline-block;background:#FBBF24;color:#111827;padding:10px 18px;border-radius:8px;` +
    `text-decoration:none;font-weight:700;">Open estimate</a></p>` +
    `<p style="font-size:12px;color:#666;margin-top:20px;">Sent via Total Service Pro · repairplanet.net</p>` +
    `</div>`;

  return { subject, html };
}

/** Confirm nonce lifetime. Matches the 30-day estimate validity window. */
export const ESTIMATE_ACTION_CONFIRM_TTL_SEC = 60 * 60 * 24 * 30;

const CONFIRM_PURPOSE = 'estimate-confirm';

export type EstimateActionEstimateRecord = {
  customer_action?: string | null;
  customer_action_at?: string | null;
  customer_action_note?: string | null;
  customer_action_token?: string | null;
  estimate_data?: unknown;
};

export type CustomerActionPatch = {
  customer_action: CustomerActionKind;
  customer_action_at: string;
  customer_action_note: string | null;
  estimate_data: Record<string, unknown>;
};

export type EstimateActionConfirms = Record<EstimateEmailAction, string>;

/**
 * Signed field one confirm button must POST.
 * Bound to the estimate token and that button's action:
 * `estimate-confirm.<token>.<action>.<exp>`.
 * An action-less nonce, or a nonce for a different action, does not verify.
 */
export function signEstimateActionConfirm(
  token: string,
  action: unknown,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): string {
  const emailAction = parseEstimateEmailAction(action);
  if (!emailAction) return '';
  const exp = nowSec + ESTIMATE_ACTION_CONFIRM_TTL_SEC;
  const payload = confirmMacPayload(token, emailAction, exp);
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${exp}.${sig}`;
}

export function signEstimateActionConfirms(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): EstimateActionConfirms {
  return {
    approve: signEstimateActionConfirm(token, 'approve', secret, nowSec),
    reject: signEstimateActionConfirm(token, 'reject', secret, nowSec),
    modify: signEstimateActionConfirm(token, 'modify', secret, nowSec),
  };
}

export function verifyEstimateActionConfirm(
  token: string,
  action: unknown,
  confirm: unknown,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  const emailAction = parseEstimateEmailAction(action);
  const trimmed = String(token || '').trim();
  if (!secret || !emailAction || !isValidEstimateActionToken(trimmed)) return false;
  const raw = String(confirm ?? '').trim();
  const dot = raw.indexOf('.');
  if (dot < 1) return false;
  const expRaw = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^\d+$/.test(expRaw) || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < nowSec) return false;
  const expected = createHmac('sha256', secret)
    .update(confirmMacPayload(trimmed, emailAction, exp))
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function confirmMacPayload(token: string, action: EstimateEmailAction, exp: number): string {
  return `${CONFIRM_PURPOSE}.${String(token || '').trim()}.${action}.${exp}`;
}

export type EstimateActionHttpDecision =
  | { effect: 'none'; status: number; error: string }
  | { effect: 'mutate'; token: string; action: CustomerActionKind; note: string | null };

/**
 * GET never mutates, even when the body already contains a valid confirm nonce.
 * POST mutates only with a token, a known action, and a confirm nonce for that action.
 */
export function decideEstimateActionHttp(input: {
  method: string;
  body?: Record<string, unknown> | null;
  secret: string;
  nowSec?: number;
}): EstimateActionHttpDecision {
  if (String(input.method || '').toUpperCase() !== 'POST') {
    return { effect: 'none', status: 405, error: 'Method not allowed' };
  }
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const token = String(body.token || '').trim();
  if (!isValidEstimateActionToken(token)) {
    return { effect: 'none', status: 400, error: 'Invalid link' };
  }
  if (!input.secret) {
    return {
      effect: 'none',
      status: 503,
      error: 'This page is temporarily unavailable. Please contact the company that sent the estimate.',
    };
  }
  const action = parseCustomerActionKind(body.action);
  if (!action) return { effect: 'none', status: 400, error: 'Unknown action' };
  if (!verifyEstimateActionConfirm(token, action, body.confirm, input.secret, input.nowSec)) {
    return {
      effect: 'none',
      status: 400,
      error: 'Use the button on the estimate page. Opening the link does not approve or reject it.',
    };
  }
  const note = String(body.note || '').trim() || null;
  return { effect: 'mutate', token, action, note };
}

/**
 * Hosts a form-POST redirect may name. A Netlify deploy permalink is not included.
 * Production customers stay on repairplanet.net.
 */
export function isAllowedEstimateRedirectHost(host: string): boolean {
  const hostname = headerHost(host).replace(/:\d+$/, '');
  if (!hostname || hostname.includes('/') || hostname.includes(' ')) return false;
  if (hostname === 'repairplanet.net' || hostname === 'www.repairplanet.net') return true;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  return /^deploy-preview-[a-z0-9-]+--totalservicepro\.netlify\.app$/.test(hostname);
}

/** Relative `/e/<token>` path for a confirm form result. Never an absolute URL. */
export function estimateActionFormRedirectPath(input: {
  token: string;
  status: number;
  action?: unknown;
  already?: boolean;
  notice?: unknown;
}): string | null {
  const token = String(input.token || '').trim();
  if (!isValidEstimateActionToken(token)) return null;
  const params = new URLSearchParams();
  const done = parseCustomerActionKind(input.action);
  if (input.status === 200 && done && !input.already) {
    params.set('done', done);
  } else if (input.status !== 200 && input.notice) {
    const emailAction = parseEstimateEmailAction(input.action);
    if (emailAction) params.set('action', emailAction);
    params.set('notice', String(input.notice));
  }
  const path = `/e/${encodeURIComponent(token)}`;
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Location for the confirm form's 303. Prefer the public request host when it
 * is allowlisted. Otherwise return a relative path. Never reads Netlify URL env.
 */
export function estimateActionRedirectLocation(input: {
  token: string;
  status: number;
  action?: unknown;
  already?: boolean;
  notice?: unknown;
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
}): string | null {
  const path = estimateActionFormRedirectPath(input);
  if (!path) return null;
  const host = headerHost(input.forwardedHost) || headerHost(input.host);
  if (!host || !isAllowedEstimateRedirectHost(host)) return path;
  return `${redirectProto(host, input.forwardedProto)}://${host}${path}`;
}

function headerHost(value: string | null | undefined): string {
  return String(value || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function redirectProto(host: string, forwardedProto: string | null | undefined): string {
  const hostname = host.replace(/:\d+$/, '');
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http';
  const proto = String(forwardedProto || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return proto === 'http' || proto === 'https' ? proto : 'https';
}

/**
 * Pure customer-action write. Approved and rejected stay final.
 * changes_requested can still become approved or rejected.
 * A null patch means the caller must not update the row.
 */
export function customerActionWrite(
  estimate: EstimateActionEstimateRecord,
  action: CustomerActionKind,
  note: string | null,
  at: string
): {
  already: boolean;
  conflict: boolean;
  action: CustomerActionKind;
  patch: CustomerActionPatch | null;
} {
  const prev = customerActionFromEstimate(estimate);
  const resolved = resolveCustomerActionApply(prev.action, action);
  if (!resolved.apply) {
    return { already: true, conflict: resolved.conflict, action: prev.action || action, patch: null };
  }
  const nextNote =
    action === CUSTOMER_ACTION_APPROVED
      ? prev.note
      : (note || '').trim() || prev.note;
  return {
    already: false,
    conflict: false,
    action,
    patch: {
      customer_action: action,
      customer_action_at: at,
      customer_action_note: nextNote,
      estimate_data: mergeCustomerActionIntoEstimateData(estimate.estimate_data, {
        token: prev.token,
        action,
        at,
        note: nextNote,
      }),
    },
  };
}
