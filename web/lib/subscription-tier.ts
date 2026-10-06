/**
 * A missing subscriptions row is the free tier.
 * PostgREST .single() is 406 when zero rows; callers must use .maybeSingle().
 */

export type SubscriptionTierRow = {
  tier?: string | null;
  status?: string | null;
  expires_at?: string | null;
} | null;

export function subscriptionTier(sub: SubscriptionTierRow, now: Date = new Date()): string {
  if (!sub) return 'free';
  const expired = Boolean(sub.expires_at) && new Date(String(sub.expires_at)).getTime() < now.getTime();
  if (expired) return 'free';
  if (sub.status === 'active' && sub.tier) return String(sub.tier);
  return 'free';
}
