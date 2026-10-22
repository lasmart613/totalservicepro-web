/**
 * Kill switch for marketplace PART checkout (Stripe Checkout for parts listings).
 *
 * Paused by DEFAULT. Checkout runs only when MARKETPLACE_CHECKOUT_ENABLED is
 * exactly the string 'true'. Any other value, or no value, keeps it paused.
 *
 * Why: the order/stock webhook cannot verify events until STRIPE_WEBHOOK_SECRET
 * is set and the endpoint is registered in Stripe, so a live charge would write
 * no order and leave stock unchanged. Turn this back on only after that is done.
 *
 * Scope: parts checkout only. Premium/subscription billing, Connect onboarding
 * and webhooks do not read this flag.
 */
export const MARKETPLACE_CHECKOUT_PAUSED_MESSAGE =
  'Checkout is temporarily unavailable. Please contact the seller.';

export const MARKETPLACE_CHECKOUT_PAUSED_LABEL = 'Checkout temporarily unavailable, contact seller';

export const MARKETPLACE_CHECKOUT_PAUSED_CODE = 'marketplace_checkout_paused';

export function isMarketplaceCheckoutEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.MARKETPLACE_CHECKOUT_ENABLED === 'true';
}

export function marketplaceCheckoutPausedBody() {
  return {
    error: MARKETPLACE_CHECKOUT_PAUSED_MESSAGE,
    code: MARKETPLACE_CHECKOUT_PAUSED_CODE,
    checkoutEnabled: false,
  };
}

/** Client side: fail closed. Only an explicit `checkoutEnabled: true` enables the button. */
export function parseCheckoutStatus(json: unknown): boolean {
  return !!json && typeof json === 'object' && (json as { checkoutEnabled?: unknown }).checkoutEnabled === true;
}
