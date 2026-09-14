/**
 * Pure helpers for tokenized estimate CTAs (safe for node:test — no @/ imports).
 */

import { randomBytes } from 'crypto';
import { SITE_ORIGIN } from '../share.ts';
import { parseJsonField, type CustomerActionKind } from './save-helpers.ts';

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
}): { subject: string; html: string } {
  const num = opts.estimateNumber || String(opts.estimateId);
  const total = `$${(Number(opts.total) || 0).toFixed(2)}`;
  const approved = opts.action === CUSTOMER_ACTION_APPROVED;
  const rejected = opts.action === CUSTOMER_ACTION_REJECTED;
  const subject = approved
    ? `Estimate ${num} approved by ${opts.customerName}`
    : rejected
      ? `Estimate ${num} rejected by ${opts.customerName}`
      : `Modification requested on estimate ${num} by ${opts.customerName}`;
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
