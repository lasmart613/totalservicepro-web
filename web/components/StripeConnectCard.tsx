'use client';

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Prompt = {
  title?: string;
  message?: string;
  partnerUrl?: string | null;
  partnerMissingMessage?: string | null;
};

type Status = {
  eligible?: boolean;
  connected?: boolean;
  canStart?: boolean;
  schemaReady?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  hasAccount?: boolean;
  prompt?: Prompt | null;
  error?: string;
};

/**
 * In-app Stripe Connect prompt for service shops and parts suppliers.
 * Hides itself for clinics and signed-out visitors. Never invents a partner URL.
 */
export function StripeConnectCard({ returnTo = '/company' }: { returnTo?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const res = await fetch('/api/billing/stripe/connect', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const json = (await res.json().catch(() => ({}))) as Status;
        if (!cancelled) setStatus(res.ok ? json : { eligible: false, error: json.error || 'Could not check Stripe payout setup.' });
      } catch {
        if (!cancelled) setStatus({ eligible: false, error: 'Could not check Stripe payout setup.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.eligible === false) return null;

  async function startConnect() {
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error('Sign in to connect Stripe.');
        return;
      }
      const res = await fetch('/api/billing/stripe/connect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ returnTo }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.connected && !json?.url) {
        toast.success('Card payments go to your connected Stripe account.');
        setStatus((current) => ({
          ...(current || {}),
          eligible: true,
          connected: true,
          chargesEnabled: true,
          prompt: null,
        }));
        return;
      }
      if (!res.ok || !json?.url) {
        toast.error(json?.error || 'Could not start Stripe setup');
        return;
      }
      window.location.assign(json.url);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not start Stripe setup');
    } finally {
      setBusy(false);
    }
  }

  if (status.connected) {
    return (
      <div className="card p-4 border border-green-700/40 text-left">
        <h3 className="font-bold mb-1">Card payments</h3>
        <p className="text-sm text-[var(--text2)]">
          {status.payoutsEnabled
            ? 'Card payments go to your connected Stripe account.'
            : 'Card payments go to your connected Stripe account. Bank payouts are still finishing in Stripe, so paid orders stay recorded as held until Stripe can pay your bank.'}
        </p>
      </div>
    );
  }

  const prompt = status.prompt;
  const title = prompt?.title || 'Connect Stripe to take card payments';
  const message =
    status.error ||
    prompt?.message ||
    'Connect Stripe before you take a card payment. We will not charge the platform account.';

  return (
    <div className="card p-4 border border-[var(--gold)] text-left">
      <h3 className="font-bold mb-1">{title}</h3>
      <p className="text-sm text-[var(--text2)] mb-3">{message}</p>
      {status.canStart ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={startConnect}>
          {busy ? 'Opening Stripe…' : status.hasAccount ? 'Finish Stripe setup' : 'Connect Stripe'}
        </button>
      ) : status.schemaReady === false ? null : (
        <p className="text-sm">A company admin needs to connect Stripe for this organization.</p>
      )}
      {prompt?.partnerUrl ? (
        <a
          href={prompt.partnerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--gold)] hover:underline block mt-3"
        >
          Create a Stripe account with our partner link
        </a>
      ) : (
        <p className="text-sm text-[var(--text3)] mt-3">
          {prompt?.partnerMissingMessage || 'Ask your platform admin for the Stripe partner signup link.'}
        </p>
      )}
    </div>
  );
}
