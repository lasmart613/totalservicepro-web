/** Shared product version for Settings / About.
 *  0.3.x-alpha — feature build, internal
 *  0.4.x-beta  — live-customer beta (real invoices, estimates, tickets)
 *  1.0.0       — generally available (later)
 */
export const APP_VERSION = '0.4.0-beta';
export const APP_CHANNEL = 'beta';

export function gitShortSha(): string {
  const sha = process.env.NEXT_PUBLIC_GIT_SHA || '';
  return sha ? sha.slice(0, 7) : '';
}

export function versionLabel(): string {
  return APP_VERSION;
}

export function buildLabel(): string {
  const sha = gitShortSha();
  return sha ? `web ${sha}` : 'web';
}
