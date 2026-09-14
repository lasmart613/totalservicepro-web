import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import {
  complimentaryPremiumExpiryFields,
  isActivePaidStripeSubscription,
  missingComplimentaryColumn,
  shouldExpireComplimentaryPremium,
  type PaidStripeSubRow,
} from '@/lib/complimentary-premium';

export const dynamic = 'force-dynamic';

const ORG_SELECTS = [
  'id, name, type, is_premium, subscription_tier, plan, premium_until, premium_grant',
  'id, name, type, is_premium, premium_until, premium_grant',
] as const;

/**
 * POST /api/god/premium/expire
 * God-only expiry job. Selects only orgs with premium_until in the past.
 * Never touches orgs without premium_until (Larry / live paid).
 * Never drops an org that has an active paid Stripe subscription row.
 */
export async function POST(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'confirm: true is required' }, { status: 400 });
  }

  const now = new Date();
  const admin = getSupabaseAdmin();

  let candidates: Array<Record<string, unknown>> = [];
  let loadError: { message?: string } | null = null;
  for (const cols of ORG_SELECTS) {
    const { data, error } = await admin
      .from('organizations')
      .select(cols)
      .not('premium_until', 'is', null)
      .lte('premium_until', now.toISOString());
    loadError = error;
    if (!error) {
      candidates = (data as Array<Record<string, unknown>>) || [];
      break;
    }
    if (error && /column|schema cache|does not exist/i.test(error.message || '')) {
      if (missingComplimentaryColumn(error.message)) {
        return NextResponse.json({
          ok: true,
          god: true,
          expired: [],
          skipped: [],
          expiredCount: 0,
          skippedCount: 0,
          note: 'premium_until column not applied yet — nothing to expire.',
        });
      }
      continue;
    }
    break;
  }
  if (loadError && !candidates.length && !missingComplimentaryColumn(loadError.message)) {
    return NextResponse.json({ error: loadError.message || 'Could not load organizations' }, { status: 500 });
  }

  const orgIds = candidates.map((row) => row.id).filter((id) => id != null);
  const paidIds = new Set<string>();
  if (orgIds.length) {
    try {
      const { data: subs } = await admin
        .from('subscriptions')
        .select('organization_id, stripe_subscription_id, status')
        .in('organization_id', orgIds);
      for (const row of (subs as PaidStripeSubRow[] | null) || []) {
        if (isActivePaidStripeSubscription(row) && row.organization_id != null) {
          paidIds.add(String(row.organization_id));
        }
      }
    } catch {
      /* missing subscriptions table — still skip named paid plans */
    }
  }

  const expired: Array<{ id: string | number; name: string }> = [];
  const skipped: Array<{ id: string | number; reason: string }> = [];
  const fields = complimentaryPremiumExpiryFields();

  for (const org of candidates) {
    const paidStripe = paidIds.has(String(org.id));
    if (
      !shouldExpireComplimentaryPremium(
        {
          is_premium: org.is_premium as boolean | null,
          premium_until: (org.premium_until as string | null) ?? null,
          premium_grant: (org.premium_grant as string | null) ?? null,
          subscription_tier: (org.subscription_tier as string | null) ?? null,
          plan: (org.plan as string | null) ?? null,
        },
        { paidStripe, now }
      )
    ) {
      skipped.push({
        id: org.id as string | number,
        reason: paidStripe ? 'paid_stripe' : 'protected_paid',
      });
      continue;
    }

    const { error } = await admin
      .from('organizations')
      .update({ ...fields, updated_at: now.toISOString() })
      .eq('id', org.id);
    if (error) {
      skipped.push({ id: org.id as string | number, reason: error.message || 'update_failed' });
      continue;
    }
    expired.push({ id: org.id as string | number, name: String(org.name || '') });
  }

  return NextResponse.json({
    ok: true,
    god: true,
    expired,
    skipped,
    expiredCount: expired.length,
    skippedCount: skipped.length,
  });
}
