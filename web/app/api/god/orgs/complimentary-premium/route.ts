import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { selectedOrgIds } from '@/lib/god-orgs';
import {
  clampComplimentaryDays,
  complimentaryGrantSkipMessage,
  complimentaryGrantSkipReason,
  complimentaryPremiumGrantFields,
  isActivePaidStripeSubscription,
  missingComplimentaryColumn,
  type ComplimentaryGrantSkip,
  type PaidStripeSubRow,
} from '@/lib/complimentary-premium';

export const dynamic = 'force-dynamic';

const ORG_SELECTS = [
  'id, name, type, is_premium, subscription_tier, plan, premium_until, premium_grant',
  'id, name, type, is_premium, subscription_tier, plan',
  'id, name, type, is_premium',
] as const;

/**
 * POST /api/god/orgs/complimentary-premium
 * God-only. Grant ~60 days complimentary Premium to selected service_company orgs.
 * No Stripe. No card. Skips paid Stripe and legacy is_premium without expiry.
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

  const ids = selectedOrgIds(body?.organization_ids);
  if (!ids.length) {
    return NextResponse.json({ error: 'Select at least one organization.' }, { status: 400 });
  }

  const days = clampComplimentaryDays(body?.days);
  const now = new Date();
  const admin = getSupabaseAdmin();

  let orgs: Array<Record<string, unknown>> = [];
  let orgError: { message?: string } | null = null;
  for (const cols of ORG_SELECTS) {
    const { data, error } = await admin.from('organizations').select(cols).in('id', ids);
    orgError = error;
    if (!error) {
      orgs = (data as Array<Record<string, unknown>>) || [];
      break;
    }
    if (error && !/column|schema cache|does not exist/i.test(error.message || '')) break;
  }
  if (orgError && !orgs.length) {
    return NextResponse.json({ error: orgError.message || 'Could not load organizations' }, { status: 500 });
  }

  const paidIds = new Set<string>();
  try {
    const { data: subs } = await admin
      .from('subscriptions')
      .select('organization_id, stripe_subscription_id, status')
      .in('organization_id', ids);
    for (const row of (subs as PaidStripeSubRow[] | null) || []) {
      if (isActivePaidStripeSubscription(row) && row.organization_id != null) {
        paidIds.add(String(row.organization_id));
      }
    }
  } catch {
    /* subscriptions table may be missing — still protect legacy_paid via is_premium */
  }

  const granted: Array<{ id: string | number; name: string; premium_until: string }> = [];
  const skipped: Array<{ id: string | number; reason: ComplimentaryGrantSkip; error: string }> = [];
  const seen = new Set(orgs.map((row) => String(row.id)));

  for (const id of ids) {
    if (!seen.has(String(id))) {
      skipped.push({ id, reason: 'missing_org', error: complimentaryGrantSkipMessage('missing_org') });
    }
  }

  for (const org of orgs) {
    const reason = complimentaryGrantSkipReason(
      {
        type: org.type as string | null,
        is_premium: org.is_premium as boolean | null,
        premium_until: (org.premium_until as string | null) ?? null,
        premium_grant: (org.premium_grant as string | null) ?? null,
        subscription_tier: (org.subscription_tier as string | null) ?? null,
        plan: (org.plan as string | null) ?? null,
      },
      { paidStripe: paidIds.has(String(org.id)) }
    );
    if (reason) {
      skipped.push({
        id: org.id as string | number,
        reason,
        error: complimentaryGrantSkipMessage(reason),
      });
      continue;
    }

    const fields = complimentaryPremiumGrantFields({ source: 'god', now, days });
    const { data, error } = await admin
      .from('organizations')
      .update({ ...fields, updated_at: now.toISOString() })
      .eq('id', org.id)
      .select('id, name, premium_until')
      .maybeSingle();
    if (error || data?.id == null) {
      if (missingComplimentaryColumn(error?.message)) {
        return NextResponse.json(
          { error: 'complimentary Premium columns are not applied yet (premium_until). Run the migration.' },
          { status: 500 }
        );
      }
      skipped.push({
        id: org.id as string | number,
        reason: 'missing_org',
        error: error?.message || 'Could not update organization',
      });
      continue;
    }
    granted.push({
      id: data.id,
      name: String(data.name || org.name || ''),
      premium_until: String(data.premium_until || fields.premium_until),
    });
  }

  return NextResponse.json({
    ok: true,
    god: true,
    days,
    granted,
    skipped,
    grantedCount: granted.length,
    skippedCount: skipped.length,
  });
}
