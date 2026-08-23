/**
 * Write paid flags onto an EXISTING organization. Never inserts an org or user.
 * Idempotent: re-applying the same plan updates the same row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { orgUpgradeFields } from './upgrade-session.ts';

export function missingOrgColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

export async function writeOrgUpgrade(
  client: SupabaseClient,
  orgId: string,
  plan: string
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    ...orgUpgradeFields(plan),
    updated_at: new Date().toISOString(),
  };
  let lastError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await client
      .from('organizations')
      .update(payload)
      .eq('id', orgId)
      .select('id')
      .maybeSingle();
    if (!error && data?.id != null) return { ...data, ...payload };
    lastError = error;
    const col = missingOrgColumn(error?.message);
    if (col && col in payload) {
      delete payload[col];
      continue;
    }
    break;
  }
  throw new Error(lastError?.message || 'Could not update the organization plan');
}

export async function persistPaidOrgUpgrade(input: {
  writer: SupabaseClient;
  organizationId: string;
  userId?: string | null;
  userEmail?: string | null;
  plan: string;
  sku?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}): Promise<{ org: Record<string, unknown>; priorSubscriptionId: string | null }> {
  const orgId = String(input.organizationId || '').trim();
  if (!orgId) throw new Error('organization_id is required');

  let priorSubscriptionId: string | null = null;
  const userId = String(input.userId || '').trim() || null;
  if (userId) {
    const { data: priorSub } = await input.writer
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', userId)
      .maybeSingle();
    priorSubscriptionId =
      priorSub?.stripe_subscription_id != null ? String(priorSub.stripe_subscription_id) : null;
  }

  const org = await writeOrgUpgrade(input.writer, orgId, input.plan);

  try {
    if (userId && input.customerId) {
      const { data: existing } = await input.writer
        .from('stripe_customers')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      if (existing?.id) {
        await input.writer
          .from('stripe_customers')
          .update({ stripe_customer_id: input.customerId, email: input.userEmail || null })
          .eq('id', existing.id);
      } else {
        await input.writer.from('stripe_customers').insert({
          user_id: userId,
          stripe_customer_id: input.customerId,
          email: input.userEmail || null,
        });
      }
    }

    if (userId) {
      const subRow: Record<string, unknown> = {
        user_id: userId,
        organization_id: Number.isFinite(Number(orgId)) ? Number(orgId) : orgId,
        tier: input.plan,
        status: 'active',
        sku: input.sku || null,
        platform: 'stripe',
        subscription_type: 'stripe',
        package_name: input.plan,
        stripe_subscription_id: input.subscriptionId || null,
        updated_at: new Date().toISOString(),
      };
      const { data: existingSub } = await input.writer
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      if (existingSub?.id) {
        await input.writer.from('subscriptions').update(subRow).eq('id', existingSub.id);
      } else {
        await input.writer.from('subscriptions').insert(subRow);
      }
    }
  } catch (recordErr) {
    console.warn('[billing] org upgraded; ledger write skipped', recordErr);
  }

  return { org, priorSubscriptionId };
}
