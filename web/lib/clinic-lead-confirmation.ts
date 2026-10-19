/**
 * Server-only helpers that keep the find-a-rep confirmation email to one per
 * request. clinic_service_leads.confirmation_key is UNIQUE when set (000930):
 * the first insert for (email, description, UTC day) claims it; a concurrent
 * or repeated submit hits 23505, stores its row without the key, and skips
 * the confirmation. The route releases the claim in a finally block unless
 * the confirmation was really sent. A claim older than
 * CONFIRMATION_CLAIM_STALE_MS that never got confirmation_sent (process
 * killed mid-send, release failed) may be retaken.
 */
import { createHash } from 'node:crypto';

export const CONFIRMATION_CLAIM_STALE_MS = 10 * 60 * 1000;

export function clinicLeadConfirmationKey(
  email: string | null | undefined,
  description: string,
  now: Date = new Date()
): string | null {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return null;
  const d = String(description ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const day = now.toISOString().slice(0, 10);
  return `${createHash('md5').update(`${e}|${d}`).digest('hex')}:${day}`;
}

type DbError = { code?: string; message?: string; details?: string } | null | undefined;

/** True when the insert lost the confirmation claim (unique confirmation_key). */
export function isConfirmationKeyConflict(error: DbError): boolean {
  if (!error || error.code !== '23505') return false;
  return /confirmation_key/i.test(`${error.message || ''} ${error.details || ''}`);
}

/** True when the leads table itself is missing (migration not applied). */
export function isLeadsTableMissing(error: DbError): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /clinic_service_leads/i.test(error.message || '') &&
    /does not exist|schema cache/i.test(error.message || '');
}

/**
 * Only an unknown column (older schema) may take the degraded insert that
 * drops the newer columns. FK / NOT NULL / check errors are real errors.
 */
export function isUnknownColumnError(error: DbError): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204');
}

/** Whether to send the confirmation, given the persist outcome. */
export function shouldSendConfirmation(opts: {
  email: string | null;
  stored: boolean;
  claimedKey: boolean;
  lostClaim: boolean;
}): boolean {
  if (!opts.email) return false;
  if (opts.lostClaim) return false;
  // Stored with the claim, or not stored at all (table missing / degraded):
  // the clinic still deserves one confirmation for a first submit.
  return opts.claimedKey || !opts.stored;
}

/** Rate-limit key: Netlify's client IP, else the last (proxy-appended) XFF hop. */
export function clinicLeadClientIp(get: (name: string) => string | null): string {
  const nf = get('x-nf-client-connection-ip')?.trim();
  if (nf) return nf;
  const hops = (get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  return get('x-real-ip')?.trim() || 'unknown';
}
