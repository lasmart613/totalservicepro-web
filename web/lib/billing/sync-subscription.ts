/**
 * Pick the latest real complete Stripe org-plan session for this user/org.
 * Does not create Checkout sessions or invent charges.
 */

import {
  evaluateUpgradeSession,
  parsePaidSubscriptionRecord,
  type StripeCheckoutLike,
  type StripeSubscriptionLike,
  type UpgradeSessionOwner,
} from './upgrade-session.ts';

export function pickLatestPaidUpgradeSession(
  sessions: StripeCheckoutLike[],
  owner: UpgradeSessionOwner
): StripeCheckoutLike | null {
  const matches: { session: StripeCheckoutLike; created: number }[] = [];
  for (const session of sessions) {
    const verdict = evaluateUpgradeSession(session, owner, {
      allowMissingUser: true,
      allowMissingOrg: true,
    });
    if (!verdict.ok) continue;
    matches.push({
      session,
      created: typeof session.created === 'number' ? session.created : 0,
    });
  }
  matches.sort((a, b) => b.created - a.created);
  return matches[0]?.session || null;
}

export function pickLatestPaidSubscription(
  subscriptions: StripeSubscriptionLike[],
  owner: UpgradeSessionOwner
): StripeSubscriptionLike | null {
  const expectedOrg = String(owner.organizationId || '').trim();
  const expectedUser = String(owner.userId || '').trim();
  const matches: StripeSubscriptionLike[] = [];
  for (const sub of subscriptions) {
    const parsed = parsePaidSubscriptionRecord(sub);
    if (!parsed.ok) continue;
    if (parsed.organizationId && parsed.organizationId !== expectedOrg) continue;
    if (parsed.userId && parsed.userId !== expectedUser) continue;
    if (!parsed.organizationId && !parsed.userId) continue;
    matches.push(sub);
  }
  return matches[0] || null;
}

export function uniqueStripeObjects<T extends { id?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = String(item?.id || '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(item);
  }
  return out;
}
