/**
 * Platform God access — Larry only. Not a Stripe plan, not a /plans SKU.
 * Server-side allowlist. Do not import secrets into client components.
 *
 * Existing admin identity in this repo is larrysmart@gmail.com
 * (README + DEPLOY.md Netlify login). Env can extend or replace that list.
 */

export const GOD_DEFAULT_EMAILS = ['larrysmart@gmail.com'] as const;

export function normalizeGodEmail(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function isValidGodEmail(value?: string | null): boolean {
  const email = normalizeGodEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function splitEnvList(raw?: string | null): string[] {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Emails that may open God. GOD_ADMIN_EMAILS (comma/space separated) replaces
 * the default when set; otherwise Larry's existing admin email is used.
 */
export function godAllowlistEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = splitEnvList(env.GOD_ADMIN_EMAILS)
    .map(normalizeGodEmail)
    .filter(isValidGodEmail);
  if (fromEnv.length) return [...new Set(fromEnv)];
  return [...GOD_DEFAULT_EMAILS];
}

export function godAllowlistUserIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set(splitEnvList(env.GOD_ADMIN_USER_IDS).map((id) => id.trim()).filter(Boolean))];
}

export type GodIdentity = {
  id?: string | null;
  email?: string | null;
  profileEmail?: string | null;
};

export function isGodIdentity(
  identity: GodIdentity | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!identity) return false;
  const ids = godAllowlistUserIds(env);
  const userId = String(identity.id || '').trim();
  if (userId && ids.includes(userId)) return true;

  const emails = godAllowlistEmails(env);
  const candidates = [identity.email, identity.profileEmail].map(normalizeGodEmail).filter(Boolean);
  return candidates.some((email) => emails.includes(email));
}

/** Never treat God as a subscription / Stripe SKU. */
export function isGodPlanName(value?: string | null): boolean {
  const raw = String(value || '')
    .toLowerCase()
    .trim();
  return raw === 'god' || raw === 'god_admin' || raw === 'superuser' || raw === 'super_admin';
}
