/**
 * Medical Repair Network directory sign-ups: admin review helpers (000926).
 *
 * Reviewers are platform admins (lib/god.ts allowlist via requireGodCaller).
 * Approve lists the org and the database issues exactly one invite:
 *   - clinic_owner (laser_clinic, laser_rental): a 000923 clinic owner invite.
 *     Emailed with the existing clinic invite email and /signup/owner claim
 *     link (signCustomerInvite with inv = the invite id), claimed by the
 *     unchanged /api/customers/claim -> claim_clinic_owner_invite.
 *   - listing (service_company, parts_supplier): a directory_listing_invites
 *     row, claimed at /directory-claim -> /api/directory/claim.
 * Reject sends nothing.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DIRECTORY_LISTING_INVITE_TTL_SEC = 60 * 60 * 24 * 30;
export const DIRECTORY_EMAIL_FROM_DEFAULT = 'Medical Repair Network <contact@medicalrepairnetwork.com>';
/** Never send directory mail to Larry's personal admin inbox. */
export const DIRECTORY_FORBIDDEN_RECIPIENTS = ['larrysmart@gmail.com'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bidi overrides/isolates (U+202A-202E, U+2066-2069), LRM/RLM and C0/DEL controls. */
export const BIDI_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

export function stripBidi(s: unknown): string {
  return String(s ?? '').replace(BIDI_CONTROL_RE, '')
}

export function escHtml(s: unknown): string {
  return stripBidi(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isForbiddenDirectoryRecipient(email: string | null | undefined): boolean {
  const e = String(email || '').trim().toLowerCase();
  return DIRECTORY_FORBIDDEN_RECIPIENTS.includes(e);
}

export type ReviewDecision = 'approve' | 'reject';
export function parseReviewDecision(v: unknown): ReviewDecision | null {
  return v === 'approve' || v === 'reject' ? v : null;
}
export function isRegistrationId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

// ---------- listing invite token ----------

type ListingPayload = { inv: string; org: string; email: string; exp: number };

function listingSecret(): string | null {
  return process.env.CUSTOMER_INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sig(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`directory-listing\n${body}`).digest('base64url');
}

export function signDirectoryListingInvite(
  p: { inv: string; org: string | number; email: string },
  nowSec = Math.floor(Date.now() / 1000)
): string {
  const secret = listingSecret();
  if (!secret) throw new Error('Invite signing is not configured');
  if (!UUID_RE.test(p.inv)) throw new Error('Invalid invite id');
  const body: ListingPayload = {
    inv: p.inv.toLowerCase(),
    org: String(p.org),
    email: p.email.trim().toLowerCase(),
    exp: nowSec + DIRECTORY_LISTING_INVITE_TTL_SEC,
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${encoded}.${sig(secret, encoded)}`;
}

export function verifyDirectoryListingInvite(token: unknown, nowSec = Math.floor(Date.now() / 1000)): ListingPayload | null {
  const secret = listingSecret();
  if (!secret || typeof token !== 'string' || token.length > 2000) return null;
  const [encoded, s, extra] = token.split('.');
  if (!encoded || !s || extra !== undefined) return null;
  const want = Buffer.from(sig(secret, encoded));
  const got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ListingPayload;
    if (!p || !UUID_RE.test(String(p.inv)) || typeof p.email !== 'string' || typeof p.exp !== 'number') return null;
    if (p.exp <= nowSec) return null;
    return p;
  } catch {
    return null;
  }
}

export function directoryClaimUrl(origin: string, token: string): string {
  const base = String(origin || 'https://repairplanet.net').replace(/\/$/, '');
  return `${base}/directory-claim?token=${encodeURIComponent(token)}`;
}

// ---------- emails ----------

export const LISTING_INVITE_SUBJECT = 'Your Medical Repair Network listing is live';

export function buildListingInviteEmail(opts: { companyName: string; contactName?: string | null; claimUrl: string }) {
  opts = { ...opts, companyName: stripBidi(opts.companyName), contactName: opts.contactName == null ? opts.contactName : stripBidi(opts.contactName) };
  const company = escHtml(opts.companyName || 'your company');
  const greet = opts.contactName?.trim() ? `Hi ${escHtml(opts.contactName.trim())},` : `Hello ${company} team,`;
  const url = escHtml(opts.claimUrl);
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">` +
    `<p>${greet}</p>` +
    `<p><strong>${company}</strong> is now listed in the Medical Repair Network service directory.</p>` +
    `<p>To manage your listing, sign in with this email address using the link below. It works for 30 days.</p>` +
    `<p><a href="${url}" style="display:inline-block;background:#e0b04a;color:#1a1404;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Manage your listing</a></p>` +
    `<p style="font-size:12px;color:#6b7280">If you didn't register, you can ignore this email.</p></div>`;
  const text =
    `${opts.contactName?.trim() ? `Hi ${opts.contactName.trim()},` : `Hello ${opts.companyName || 'your company'} team,`}\n\n` +
    `${opts.companyName || 'Your company'} is now listed in the Medical Repair Network service directory.\n` +
    `To manage your listing, sign in with this email address here (valid 30 days):\n${opts.claimUrl}\n\n` +
    `If you didn't register, you can ignore this email.\n`;
  return { subject: LISTING_INVITE_SUBJECT, html, text };
}

/** /api/directory/claim refusal codes (claim_directory_listing_invite). */
export const LISTING_CLAIM_REFUSALS: Record<string, { status: number; error: string }> = {
  invite_invalid: { status: 400, error: 'This link is not valid.' },
  invite_revoked: { status: 400, error: 'This link is no longer valid.' },
  invite_used: { status: 400, error: 'This listing has already been claimed.' },
  invite_expired: { status: 400, error: 'This link has expired. Contact us for a new one.' },
  not_listing: { status: 400, error: 'This link is not for a directory listing.' },
  email_mismatch: { status: 403, error: 'Sign in with the email address this link was sent to.' },
  email_unconfirmed: { status: 403, error: 'Confirm your email address first, then open the link again.' },
  inviter: { status: 403, error: 'This link cannot be used by the reviewer who sent it.' },
  owner_exists: { status: 409, error: 'This listing already has an owner account.' },
  other_org: { status: 409, error: 'This account is already linked to another company.' },
};
