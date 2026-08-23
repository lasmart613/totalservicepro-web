/**
 * Pure helpers for signed-in org upgrade Checkout.
 * Checkout must attach to the current org and must not create a second account.
 */

import { getPlanOffer, type PlanOffer, type PlanSku } from './plan-catalog.ts';

export const UPGRADE_KIND = 'org_plan';

export type UpgradeSessionOwner = {
  userId: string;
  organizationId: string;
};

export type UpgradeSessionFields = {
  mode: 'subscription';
  client_reference_id: string;
  success_url: string;
  cancel_url: string;
  'line_items[0][price]': string;
  'line_items[0][quantity]': 1;
  'metadata[kind]': typeof UPGRADE_KIND;
  'metadata[organization_id]': string;
  'metadata[user_id]': string;
  'metadata[plan]': string;
  'metadata[sku]': PlanSku;
  'subscription_data[metadata][kind]': typeof UPGRADE_KIND;
  'subscription_data[metadata][organization_id]': string;
  'subscription_data[metadata][user_id]': string;
  'subscription_data[metadata][plan]': string;
  'subscription_data[metadata][sku]': PlanSku;
  customer?: string;
  customer_email?: string;
};

export function normalizeOrgId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const id = String(value).trim();
  return id === '' ? null : id;
}

export function buildUpgradeCheckoutFields(input: {
  offer: PlanOffer;
  priceId: string;
  owner: UpgradeSessionOwner;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
  customerEmail?: string | null;
}): UpgradeSessionFields {
  const orgId = normalizeOrgId(input.owner.organizationId);
  const userId = String(input.owner.userId || '').trim();
  if (!orgId) throw new Error('organization_id is required to start checkout');
  if (!userId) throw new Error('user_id is required to start checkout');

  const fields: UpgradeSessionFields = {
    mode: 'subscription',
    client_reference_id: orgId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': 1,
    'metadata[kind]': UPGRADE_KIND,
    'metadata[organization_id]': orgId,
    'metadata[user_id]': userId,
    'metadata[plan]': input.offer.plan,
    'metadata[sku]': input.offer.sku,
    'subscription_data[metadata][kind]': UPGRADE_KIND,
    'subscription_data[metadata][organization_id]': orgId,
    'subscription_data[metadata][user_id]': userId,
    'subscription_data[metadata][plan]': input.offer.plan,
    'subscription_data[metadata][sku]': input.offer.sku,
  };

  const customerId = String(input.customerId || '').trim();
  const email = String(input.customerEmail || '').trim();
  if (customerId) {
    fields.customer = customerId;
  } else if (email.includes('@')) {
    fields.customer_email = email;
  }
  return fields;
}

export type StripeCheckoutLike = {
  id?: string;
  mode?: string | null;
  status?: string | null;
  payment_status?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string | undefined> | null;
};

export function evaluateUpgradeSession(
  session: StripeCheckoutLike | null | undefined,
  expected: UpgradeSessionOwner
): { ok: true; sku: PlanSku; plan: string } | { ok: false; reason: string } {
  if (!session) return { ok: false, reason: 'missing_session' };
  if (session.mode !== 'subscription') return { ok: false, reason: 'not_subscription' };
  if (session.status !== 'complete') return { ok: false, reason: 'not_complete' };
  const pay = String(session.payment_status || '');
  if (pay && pay !== 'paid' && pay !== 'no_payment_required') {
    return { ok: false, reason: 'not_paid' };
  }

  const meta = session.metadata || {};
  const orgId = normalizeOrgId(meta.organization_id) || normalizeOrgId(session.client_reference_id);
  const userId = String(meta.user_id || '').trim();
  const expectedOrg = normalizeOrgId(expected.organizationId);
  const expectedUser = String(expected.userId || '').trim();
  if (!expectedOrg || !expectedUser) return { ok: false, reason: 'missing_expected_owner' };
  if (orgId !== expectedOrg) return { ok: false, reason: 'org_mismatch' };
  if (userId !== expectedUser) return { ok: false, reason: 'user_mismatch' };
  if (meta.kind && meta.kind !== UPGRADE_KIND) return { ok: false, reason: 'wrong_kind' };

  const sku = String(meta.sku || '');
  const offer = getPlanOffer(sku);
  if (!offer) return { ok: false, reason: 'unknown_sku' };
  return { ok: true, sku: offer.sku, plan: offer.plan };
}

export function orgUpgradeFields(plan: string): Record<string, unknown> {
  const name = String(plan || '').toLowerCase().trim();
  return {
    is_premium: true,
    subscription_tier: name,
    plan: name,
  };
}
