'use client';

import { useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * Stripe sends the browser back without the localStorage session header.
 * The return and refresh routes redirect here with the signed state and do
 * not write anything. This finishes only after the signed-in admin calls
 * the route with their session.
 */
export function StripeConnectResume() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get('stripe_connect');
    const state = params.get('state');
    if ((kind !== 'return' && kind !== 'refresh') || !state) return;
    let cancelled = false;

    function finishHere(stripe: string) {
      params.delete('stripe_connect');
      params.delete('state');
      params.set('stripe', stripe);
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }

    (async () => {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (!cancelled) finishHere('error');
        return;
      }
      const path =
        kind === 'refresh' ? '/api/billing/stripe/connect/refresh' : '/api/billing/stripe/connect/return';
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ state }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (kind === 'refresh' && res.ok && typeof json.url === 'string') {
          window.location.assign(json.url);
          return;
        }
        finishHere(res.ok ? (json.connected ? 'connected' : 'pending') : 'error');
      } catch {
        if (!cancelled) finishHere('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
