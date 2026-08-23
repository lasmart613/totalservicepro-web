/**
 * Pure helpers for signed-in org upgrade Checkout.
 * Checkout must attach to the current org and must not create a second account.
 * Price IDs must already exist on Larry's Stripe account.
 */

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
  'metadata[stripe_price_id]': string;
  'metadata[stripe_product_id]': string;
  'subscription_data[metadata][kind]': typeof UPGRADE_KIND;
  'subscription_data[metadata][organization_id]': string;
  'subscription_data[metadata][user_id]': string;
  'subscription_data[metadata][stripe_price_id]': string;
  customer?: string;
  customer_email?: string;
};

export function normalizeOrgId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const id = String(value).trim();
  return id === '' ? null : id;
}

export function buildUpgradeCheckoutFields(input: {
  priceId: string;
  productId: string;
  owner: UpgradeSessionOwner;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
  customerEmail?: string | null;
}): UpgradeSessionFields {
  const orgId = normalizeOrgId(input.owner.organizationId);
  const userId = String(input.owner.userId || '').trim();
  const priceId = String(input.priceId || '').trim();
  const productId = String(input.productId || '').trim();
  if (!orgId) throw new Error('organization_id is required to start checkout');
  if (!userId) throw new Error('user_id is required to start checkout');
  if (!/^price_/.test(priceId)) throw new Error('An existing Stripe price id is required');

  const fields: UpgradeSessionFields = {
    mode: 'subscription',
    client_reference_id: orgId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    'metadata[kind]': UPGRADE_KIND,
    'metadata[organization_id]': orgId,
    'metadata[user_id]': userId,
    'metadata[stripe_price_id]': priceId,
    'metadata[stripe_product_id]': productId,
    'subscription_data[metadata][kind]': UPGRADE_KIND,
    'subscription_data[metadata][organization_id]': orgId,
    'subscription_data[metadata][user_id]': userId,
    'subscription_data[metadata][stripe_price_id]': priceId,
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
): { ok: true; priceId: string } | { ok: false; reason: string } {
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

  const priceId = String(meta.stripe_price_id || '').trim();
  if (!/^price_/.test(priceId)) return { ok: false, reason: 'missing_price' };
  return { ok: true, priceId };
}

/** Paid flag only. Do not invent a plan enum name. */
export function orgUpgradeFields(): Record<string, unknown> {
  return { is_premium: true };
}
