/**
 * AdSense 403s on Netlify deploy-preview / unique-deploy hosts.
 * Keep ads on production (`totalservicepro.netlify.app` without `--`) and custom domains.
 */
export function adsenseAllowedOnHost(hostname: string | null | undefined): boolean {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  if (!host.endsWith('.netlify.app')) return true;
  return !host.includes('--') && !host.startsWith('deploy-preview');
}
