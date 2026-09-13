/**
 * God email blast — locked templates, recipient rules, no auto-select.
 * Soft beta. No Ads. clinic_invite excludes service_company.
 */

import { clinicInviteHtml, clinicInviteText } from './clinic-invite-email.ts';
import {
  CLINIC_INVITE_FROM_DEFAULT,
  CLINIC_INVITE_REPLY_TO_DEFAULT,
  CLINIC_INVITE_SUBJECT,
  CLINIC_INVITE_TEMPLATE_KEY,
  CLINIC_INVITE_TEMPLATE_NAME,
} from './clinic-invite-email.ts';
import { isServiceOrgType } from './org-types.ts';
import {
  SHOP_INVITE_SUBJECT,
  SHOP_INVITE_TEMPLATE_KEY,
  shopInviteHtml,
  shopInviteText,
} from './shop-invite-email.ts';
import type { GodOrgRow } from './god-orgs.ts';

export const SHOP_INVITE_TEMPLATE_NAME = 'Shop invite';
export const SHOP_INVITE_FROM_DEFAULT = 'Total Service Pro <contact@medicalrepairnetwork.com>';
export const SHOP_INVITE_REPLY_TO_DEFAULT = 'contact@medicalrepairnetwork.com';

export const BLAST_TEMPLATE_KEYS = [SHOP_INVITE_TEMPLATE_KEY, CLINIC_INVITE_TEMPLATE_KEY] as const;
export type BlastTemplateKey = (typeof BLAST_TEMPLATE_KEYS)[number];

export type BlastTemplate = {
  key: BlastTemplateKey;
  name: string;
  subject: string;
  fromDefault: string;
  replyToDefault: string;
  html: () => string;
  text: () => string;
};

export const BLAST_TEMPLATES: Record<BlastTemplateKey, BlastTemplate> = {
  shop_invite: {
    key: SHOP_INVITE_TEMPLATE_KEY,
    name: SHOP_INVITE_TEMPLATE_NAME,
    subject: SHOP_INVITE_SUBJECT,
    fromDefault: SHOP_INVITE_FROM_DEFAULT,
    replyToDefault: SHOP_INVITE_REPLY_TO_DEFAULT,
    html: shopInviteHtml,
    text: shopInviteText,
  },
  clinic_invite: {
    key: CLINIC_INVITE_TEMPLATE_KEY,
    name: CLINIC_INVITE_TEMPLATE_NAME,
    subject: CLINIC_INVITE_SUBJECT,
    fromDefault: CLINIC_INVITE_FROM_DEFAULT,
    replyToDefault: CLINIC_INVITE_REPLY_TO_DEFAULT,
    html: clinicInviteHtml,
    text: clinicInviteText,
  },
};

export function parseBlastTemplateKey(raw?: string | null): BlastTemplateKey | null {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return (BLAST_TEMPLATE_KEYS as readonly string[]).includes(key) ? (key as BlastTemplateKey) : null;
}

export function isValidBlastEmail(value?: string | null): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/** Recipient is org.email first, then assembled admin email. */
export function pickBlastRecipient(org: {
  orgEmail?: string | null;
  email?: string | null;
  adminEmail?: string | null;
}): string {
  for (const value of [org.orgEmail, org.email, org.adminEmail]) {
    const email = String(value || '').trim();
    if (isValidBlastEmail(email)) return email;
  }
  return '';
}

export function blastFromAddress(template: BlastTemplate, env: NodeJS.ProcessEnv = process.env): string {
  return String(env.NOTIFY_FROM_EMAIL || env.RESEND_FROM || template.fromDefault).trim();
}

export function blastReplyTo(template: BlastTemplate, env: NodeJS.ProcessEnv = process.env): string {
  if (template.key === 'clinic_invite') {
    return String(env.NOTIFY_REPLY_TO || template.replyToDefault).trim();
  }
  return String(env.NOTIFY_REPLY_TO || template.replyToDefault).trim();
}

export function clinicInviteSkipReason(org: { type?: string | null }): string | null {
  if (isServiceOrgType(org.type)) {
    return 'clinic_invite excludes service_company';
  }
  return null;
}

export function blastSkipReason(
  templateKey: BlastTemplateKey,
  org: { type?: string | null; orgEmail?: string | null; email?: string | null; adminEmail?: string | null }
): string | null {
  if (templateKey === 'clinic_invite') {
    const clinicSkip = clinicInviteSkipReason(org);
    if (clinicSkip) return clinicSkip;
  }
  if (!pickBlastRecipient(org)) return 'No valid organization email';
  return null;
}

/** laser_clinic rows with a valid org.email — never implied as selected. */
export function clinicInviteAudience(orgs: GodOrgRow[]): GodOrgRow[] {
  return orgs.filter((org) => {
    if (String(org.type).toLowerCase() !== 'laser_clinic') return false;
    if (isServiceOrgType(org.type)) return false;
    return isValidBlastEmail(org.orgEmail);
  });
}

export function dedupeBlastRecipients<T extends { recipient: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = String(row.recipient || '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function selectedWithEmails(orgs: GodOrgRow[]): GodOrgRow[] {
  return orgs.filter((org) => pickBlastRecipient(org));
}
