/**
 * God email blast — locked templates, recipient rules, no auto-select.
 * Soft beta. No Ads. clinic_invite excludes service_company.
 */

import { clinicInviteHtml, clinicInviteText } from './clinic-invite-email.ts';
import {
  CLINIC_INVITE_FROM_DEFAULT,
  CLINIC_INVITE_POSTAL_ADDRESS,
  CLINIC_INVITE_REPLY_TO_DEFAULT,
  CLINIC_INVITE_SUBJECT,
  CLINIC_INVITE_TEMPLATE_KEY,
  CLINIC_INVITE_TEMPLATE_NAME,
  CLINIC_INVITE_UNSUBSCRIBE_URL,
} from './clinic-invite-email.ts';
import { selectedOrgIds, type GodOrgRow } from './god-orgs.ts';
import { isServiceOrgType } from './org-types.ts';
import {
  SHOP_INVITE_SUBJECT,
  SHOP_INVITE_TEMPLATE_KEY,
  shopInviteHtml,
  shopInviteText,
} from './shop-invite-email.ts';

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

export const BLAST_POSTAL_ADDRESS = CLINIC_INVITE_POSTAL_ADDRESS;
export const BLAST_UNSUBSCRIBE_URL = CLINIC_INVITE_UNSUBSCRIBE_URL;
export const BLAST_DRAFT_STORAGE_PREFIX = 'tsp.god-blast-draft.v1.';
export const BLAST_RESUME_STORAGE_KEY = 'tsp.god-blast-resume.v1';

/** Max recipients processed per /api/god/blast/send invocation. Keeps Netlify sync under timeout. */
export const BLAST_SEND_CHUNK_SIZE = 50;
/** Skip Resend if the same template_key + email already landed in god_email_sends. */
export const BLAST_ALREADY_SENT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Next.js / Netlify sync ceiling for the blast route (seconds). */
export const BLAST_SEND_MAX_DURATION_SECONDS = 60;
export const BLAST_ALREADY_SENT_SKIP =
  'Already sent this template to this email in the last 24 hours';

export type BlastDraft = {
  subject: string;
  html: string;
  text: string;
};

export type BlastSendContent = BlastDraft & {
  customized: boolean;
  bodyCustomized: boolean;
};

export type BlastContentOverride = {
  subject?: unknown;
  html?: unknown;
  text?: unknown;
};

export type LockedBlastPreview = {
  ok: true;
  template_key: BlastTemplateKey;
  template_name: string;
  subject: string;
  from: string;
  reply_to: string;
  html: string;
  text: string;
  cta: string;
};

export function blastDraftStorageKey(templateKey: BlastTemplateKey): string {
  return `${BLAST_DRAFT_STORAGE_PREFIX}${templateKey}`;
}

export function parseBlastDraft(raw: unknown): BlastDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.subject !== 'string' || typeof row.html !== 'string' || typeof row.text !== 'string') {
    return null;
  }
  return { subject: row.subject, html: row.html, text: row.text };
}

export function blastDraftDiffersFromLocked(draft: BlastDraft, locked: BlastDraft): boolean {
  return (
    draft.subject !== locked.subject || draft.html !== locked.html || draft.text !== locked.text
  );
}

export function lockedBlastContent(template: BlastTemplate): BlastDraft {
  return {
    subject: template.subject,
    html: template.html(),
    text: template.text(),
  };
}

export function lockedBlastPreview(
  template: BlastTemplate,
  env: NodeJS.ProcessEnv = process.env
): LockedBlastPreview {
  const content = lockedBlastContent(template);
  return {
    ok: true,
    template_key: template.key,
    template_name: template.name,
    subject: content.subject,
    from: blastFromAddress(template, env),
    reply_to: blastReplyTo(template, env),
    html: content.html,
    text: content.text,
    cta: 'https://repairplanet.net/signup',
  };
}

function readOverride(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

export function htmlToPlainText(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function htmlHasBlastFooter(html: string): boolean {
  return /3349\s+Somis\s+Rd/i.test(html) && /unsubscribe/i.test(html);
}

export function textHasBlastFooter(text: string): boolean {
  return /3349\s+Somis\s+Rd/i.test(text) && /unsubscribe/i.test(text);
}

export function blastComplianceFooterHtml(): string {
  return (
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;">` +
    `<tr><td style="padding:16px 28px 8px;border-top:1px solid #243040;text-align:center;">` +
    `<div style="font-size:12px;line-height:1.6;color:#8b95a5;">` +
    `Total Service Pro / Medical Repair Network / ` +
    `<a href="https://repairplanet.net" style="color:#8b95a5;text-decoration:none;">repairplanet.net</a>` +
    `</div>` +
    `<div style="margin-top:10px;font-size:11px;line-height:1.6;color:#6b7380;">` +
    `<a href="${BLAST_UNSUBSCRIBE_URL}" style="color:#6b7380;text-decoration:underline;">Unsubscribe</a>` +
    `</div>` +
    `<div style="margin-top:10px;font-size:11px;line-height:1.6;color:#6b7380;">` +
    `${BLAST_POSTAL_ADDRESS}` +
    `</div>` +
    `</td></tr></table>`
  );
}

export function blastComplianceFooterText(): string {
  return [
    'Total Service Pro / Medical Repair Network / repairplanet.net',
    '',
    `Unsubscribe: ${BLAST_UNSUBSCRIBE_URL}`,
    '',
    BLAST_POSTAL_ADDRESS,
  ].join('\n');
}

export function ensureBlastHtmlFooter(html: string): string {
  const source = String(html || '');
  if (htmlHasBlastFooter(source)) return source;
  const footer = blastComplianceFooterHtml();
  if (/<\/body>/i.test(source)) {
    return source.replace(/<\/body>/i, `${footer}</body>`);
  }
  return `${source}${footer}`;
}

export function ensureBlastTextFooter(text: string): string {
  const source = String(text || '');
  if (textHasBlastFooter(source)) return source;
  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n\n${blastComplianceFooterText()}` : blastComplianceFooterText();
}

export function resolveBlastSendContent(
  template: BlastTemplate,
  override: BlastContentOverride = {}
): { ok: true; content: BlastSendContent } | { ok: false; error: string } {
  const locked = lockedBlastContent(template);
  const subjectRaw = readOverride(override.subject);
  const htmlRaw = readOverride(override.html);
  const textRaw = readOverride(override.text);

  const subject = (subjectRaw !== undefined ? subjectRaw : locked.subject).trim();
  if (!subject) {
    return { ok: false, error: 'Subject cannot be empty.' };
  }

  let html = htmlRaw !== undefined ? htmlRaw : locked.html;
  let text = textRaw !== undefined ? textRaw : locked.text;

  if (htmlRaw !== undefined && !html.trim()) {
    return { ok: false, error: 'HTML body cannot be empty.' };
  }
  if (!html.trim() && !String(text || '').trim()) {
    return { ok: false, error: 'Email body cannot be empty.' };
  }
  if (textRaw !== undefined && !String(text || '').trim() && !html.trim()) {
    return { ok: false, error: 'Email body cannot be empty.' };
  }

  if (!html.trim() && String(text || '').trim()) {
    html = `<pre style="white-space:pre-wrap;font-family:inherit;color:#e8edf4;">${escapeHtml(text)}</pre>`;
  }
  if (!String(text || '').trim() && html.trim()) {
    text = htmlToPlainText(html);
  }

  const bodyCustomized =
    html.trim() !== locked.html.trim() || String(text).trim() !== locked.text.trim();
  const customized = subject !== locked.subject || bodyCustomized;

  return {
    ok: true,
    content: {
      subject,
      html: ensureBlastHtmlFooter(html),
      text: ensureBlastTextFooter(String(text)),
      customized,
      bodyCustomized,
    },
  };
}

export type BlastRecentSend = {
  template_key?: string | null;
  recipient_email?: string | null;
  subject?: string | null;
  created_at?: string | null;
  organization_id?: number | string | null;
};

export type BlastResumePayload = {
  v: 1;
  blast_id: string;
  template_key: BlastTemplateKey;
  organization_ids: Array<number | string>;
};

export type BlastOrgLike = {
  id: number | string;
  type?: string | null;
  orgEmail?: string | null;
  email?: string | null;
  adminEmail?: string | null;
};

export function blastEmailKey(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function parseOptionalBlastId(raw?: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  return /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : null;
}

export function takeBlastChunk<T>(ids: T[], chunkSize: number = BLAST_SEND_CHUNK_SIZE): T[] {
  const size = Math.min(
    BLAST_SEND_CHUNK_SIZE,
    Math.max(1, Math.floor(Number(chunkSize) || BLAST_SEND_CHUNK_SIZE))
  );
  return ids.slice(0, size);
}

export function blastChunkCount(total: number, chunkSize: number = BLAST_SEND_CHUNK_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / Math.max(1, chunkSize));
}

export function alreadySentBlastRecipient(opts: {
  templateKey: string;
  email?: string | null;
  recentSends: BlastRecentSend[];
  subject?: string | null;
  now?: Date;
  windowMs?: number;
}): boolean {
  const emailKey = blastEmailKey(opts.email);
  if (!emailKey) return false;
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - (opts.windowMs ?? BLAST_ALREADY_SENT_WINDOW_MS);
  const today = now.toISOString().slice(0, 10);
  const subject = opts.subject != null ? String(opts.subject).trim() : '';

  return opts.recentSends.some((row) => {
    if (blastEmailKey(row.recipient_email) !== emailKey) return false;
    if (String(row.template_key || '').toLowerCase() !== String(opts.templateKey).toLowerCase()) {
      return false;
    }
    const at = new Date(row.created_at || 0);
    const atMs = at.getTime();
    if (Number.isFinite(atMs) && atMs >= cutoff) return true;
    if (subject && String(row.subject || '').trim() === subject && Number.isFinite(atMs)) {
      return at.toISOString().slice(0, 10) === today;
    }
    return false;
  });
}

export function isRetryableBlastError(error?: string | null): boolean {
  const text = String(error || '').trim();
  if (!text) return false;
  if (text === BLAST_ALREADY_SENT_SKIP) return false;
  if (/excludes service_company/i.test(text)) return false;
  if (/no valid organization email/i.test(text)) return false;
  if (/unsubscribed/i.test(text)) return false;
  if (/duplicate email/i.test(text)) return false;
  return true;
}

export function eligibleBlastOrganizationIds<T extends BlastOrgLike>(opts: {
  organizationIds: Array<number | string>;
  orgs: T[];
  templateKey: BlastTemplateKey;
  recentSends: BlastRecentSend[];
  subject?: string | null;
  extraSentEmails?: Iterable<string>;
  now?: Date;
}): Array<number | string> {
  const orgById = new Map(opts.orgs.map((org) => [String(org.id), org]));
  const extraSent = new Set(
    [...(opts.extraSentEmails || [])].map((email) => blastEmailKey(email)).filter(Boolean)
  );
  const out: Array<number | string> = [];
  const seen = new Set<string>();

  for (const id of opts.organizationIds) {
    const key = String(id);
    if (seen.has(key)) continue;
    const org = orgById.get(key);
    if (!org) continue;
    if (blastSkipReason(opts.templateKey, org)) continue;
    const email = pickBlastRecipient(org);
    if (extraSent.has(blastEmailKey(email))) continue;
    if (
      alreadySentBlastRecipient({
        templateKey: opts.templateKey,
        email,
        recentSends: opts.recentSends,
        subject: opts.subject,
        now: opts.now,
      })
    ) {
      continue;
    }
    seen.add(key);
    out.push(org.id);
  }
  return out;
}

export function nextBlastChunk<T extends BlastOrgLike>(opts: {
  organizationIds: Array<number | string>;
  orgs: T[];
  templateKey: BlastTemplateKey;
  recentSends: BlastRecentSend[];
  subject?: string | null;
  extraSentEmails?: Iterable<string>;
  chunkSize?: number;
  now?: Date;
}): { chunkOrgs: T[]; remainingIds: Array<number | string> } {
  const orgById = new Map(opts.orgs.map((org) => [String(org.id), org]));
  const eligible = eligibleBlastOrganizationIds(opts);
  const chunkIds = takeBlastChunk(eligible, opts.chunkSize);
  return {
    chunkOrgs: chunkIds
      .map((id) => orgById.get(String(id)))
      .filter((org): org is T => Boolean(org)),
    remainingIds: eligible.slice(chunkIds.length),
  };
}

export function remainingBlastOrganizationIds<T extends BlastOrgLike>(opts: {
  organizationIds: Array<number | string>;
  processedIds?: Iterable<number | string>;
  orgs: T[];
  templateKey: BlastTemplateKey;
  recentSends: BlastRecentSend[];
  extraSentEmails?: Iterable<string>;
  retryableIds?: Iterable<number | string>;
  subject?: string | null;
  now?: Date;
}): Array<number | string> {
  const processed = new Set([...(opts.processedIds || [])].map(String));
  const retryable = new Set([...(opts.retryableIds || [])].map(String));
  return eligibleBlastOrganizationIds({
    organizationIds: opts.organizationIds.filter(
      (id) => !processed.has(String(id)) || retryable.has(String(id))
    ),
    orgs: opts.orgs,
    templateKey: opts.templateKey,
    recentSends: opts.recentSends,
    extraSentEmails: opts.extraSentEmails,
    subject: opts.subject,
    now: opts.now,
  });
}

export function encodeBlastResumeToken(payload: {
  blast_id: string;
  template_key: BlastTemplateKey;
  organization_ids: Array<number | string>;
}): string {
  return JSON.stringify({
    v: 1,
    blast_id: payload.blast_id,
    template_key: payload.template_key,
    organization_ids: payload.organization_ids,
  });
}

export function parseBlastResumeToken(raw: unknown): BlastResumePayload | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const templateKey = parseBlastTemplateKey(
      typeof parsed.template_key === 'string' ? parsed.template_key : null
    );
    const blastId = parseOptionalBlastId(parsed.blast_id);
    const organizationIds = selectedOrgIds(parsed.organization_ids);
    if (!templateKey || !blastId || !organizationIds.length) return null;
    return { v: 1, blast_id: blastId, template_key: templateKey, organization_ids: organizationIds };
  } catch {
    return null;
  }
}

export function parseBlastSendBody(body: unknown):
  | {
      ok: true;
      templateKey: BlastTemplateKey;
      organizationIds: Array<number | string>;
      blastId: string | null;
      content: BlastSendContent;
    }
  | { ok: false; error: string; status: number } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (raw.confirm !== true) {
    return {
      ok: false,
      status: 400,
      error: 'Confirm the send on the God dashboard before mail goes out.',
    };
  }

  const resume = parseBlastResumeToken(raw.resume_token ?? raw.resumeToken);
  const templateKey = parseBlastTemplateKey(
    typeof raw.template_key === 'string'
      ? raw.template_key
      : typeof raw.templateKey === 'string'
        ? raw.templateKey
        : resume?.template_key || null
  );
  if (!templateKey) {
    return {
      ok: false,
      status: 400,
      error: 'Choose a locked template (shop_invite or clinic_invite).',
    };
  }

  const organizationIds = selectedOrgIds(raw.organization_ids ?? raw.organizationIds);
  const ids = organizationIds.length ? organizationIds : resume?.organization_ids || [];
  if (!ids.length) {
    return {
      ok: false,
      status: 400,
      error: 'Select one or more organizations. Nothing is auto-selected.',
    };
  }

  const resolved = resolveBlastSendContent(BLAST_TEMPLATES[templateKey], {
    subject: raw.subject,
    html: raw.html ?? raw.body_html ?? raw.bodyHtml,
    text: raw.text ?? raw.body_text ?? raw.bodyText,
  });
  if (!resolved.ok) {
    return { ok: false, status: 400, error: resolved.error };
  }

  return {
    ok: true,
    templateKey,
    organizationIds: ids,
    blastId: parseOptionalBlastId(raw.blast_id ?? raw.blastId) || resume?.blast_id || null,
    content: resolved.content,
  };
}

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
