'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import { isPlanSku, type PlanSku } from './plan-catalog';

export class ClientCheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientCheckoutError';
  }
}

/**
 * Start Stripe Checkout for the signed-in org. Does not create an account
 * or sign the user out. Caller should assign window.location to the URL.
 */
export async function startClientUpgradeCheckout(sku: PlanSku): Promise<{
  url: string;
  sessionId: string;
  livemode: boolean | null;
}> {
  if (!isPlanSku(sku)) {
    throw new ClientCheckoutError('Unknown plan');
  }

  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw new ClientCheckoutError('You are still signed in? Refresh and try Upgrade again.');
  }

  const res = await fetch('/api/billing/upgrade/checkout', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sku }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    url?: string;
    sessionId?: string;
    livemode?: boolean | null;
    error?: string;
  };
  if (!res.ok || !json?.url) {
    throw new ClientCheckoutError(json?.error || 'Could not start Stripe Checkout');
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const prodHost = host === 'repairplanet.net' || host.endsWith('.repairplanet.net');
    const testSession = json.livemode === false || String(json.sessionId || '').startsWith('cs_test_');
    if (prodHost && testSession) {
      throw new ClientCheckoutError(
        'Production Stripe is still test/sandbox. Set Netlify STRIPE_SECRET_KEY to the live invoice secret and redeploy.'
      );
    }
  }

  return {
    url: json.url,
    sessionId: String(json.sessionId || ''),
    livemode: json.livemode ?? null,
  };
}
