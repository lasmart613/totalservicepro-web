/**
 * Server-only helpers that keep the find-a-rep confirmation email to one per
 * request. clinic_service_leads.confirmation_key is UNIQUE when set (000930):
 * the first insert for (email, description, UTC day) claims it; a concurrent
 * or repeated submit hits 23505, stores its row without the key, and skips
 * the confirmation. A failed send clears the key so a retry may confirm.
 */
import { createHash } from 'node:crypto';

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
