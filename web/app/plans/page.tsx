'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { LandingShell } from '@/components/landing/LandingShell';
import { getSupabaseClient } from '@/lib/supabase/client';
import { orgIsPaid } from '@/lib/org-plan';
import { PLAN_OFFERS, skuFor, type BillingCycle, type PaidPlanId } from '@/lib/billing/plan-catalog';

type AuthState = 'loading' | 'in' | 'out';

function PublicPlans() {
  return (
    <LandingShell>
      <section className="lp-section" style={{ marginTop: 0, borderTop: 'none' }}>
        <p className="lp-kicker">Total Service Pro</p>
        <h1 className="lp-h2">Free Plan and Premium</h1>
        <p className="lp-lede">
          Register for a Free Plan. Compare Free and Premium, then create your account.
          Signed-in companies upgrade from this page without registering again.
        </p>
        <div className="lp-paths lp-paths-2">
          <article className="lp-path" style={{ cursor: 'default' }}>
            <h3>Free Plan</h3>
            <p className="lp-lede" style={{ margin: '0 0 12px' }}>
              <strong>$0</strong> / month
            </p>
            <ul>
              <li>Register and use Total Service Pro at no charge</li>
              <li>Schedule service calls, post service requests, and list parts</li>
              <li>Ads may appear on the Free Plan</li>
            </ul>
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Register for Total Service Pro
            </Link>
          </article>
          <article className="lp-path" style={{ cursor: 'default' }}>
            <h3>Premium</h3>
            <p className="lp-lede" style={{ margin: '0 0 12px' }}>
              <strong>{PLAN_OFFERS.premium_monthly.displayAmount}</strong>{' '}
              {PLAN_OFFERS.premium_monthly.displayPeriod}
            </p>
            <ul>
              <li>Paid plan for accounts that need more of the app</li>
              <li>AI troubleshooting assistant</li>
              <li>Full manual library</li>
              <li>No advertisements</li>
            </ul>
            <Link href="/signup" className="lp-btn lp-btn-ghost">
              Register for Total Service Pro
            </Link>
          </article>
        </div>
        <div className="lp-actions" style={{ marginTop: 28 }}>
          <Link href="/signup" className="lp-btn lp-btn-primary">
            Register for a Free Plan
          </Link>
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Already registered? Sign in
          </Link>
        </div>
      </section>
    </LandingShell>
  );
}

function SignedInPlans() {
  const searchParams = useSearchParams();
  const supabase = getSupabaseClient();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [starting, setStarting] = useState<PaidPlanId | null>(null);
  const [paid, setPaid] = useState(false);
  const [orgName, setOrgName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id, organizations(name, is_premium, subscription_tier, plan)')
        .eq('id', user.id)
        .maybeSingle();
      const org = (profile as { organizations?: Record<string, unknown> | Record<string, unknown>[] | null })
        ?.organizations;
      const row = Array.isArray(org) ? org[0] : org;
      if (!cancelled) {
        setOrgName(String(row?.name || ''));
        setPaid(orgIsPaid(row || null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    const paidFlag = searchParams.get('paid');
    const upgraded = searchParams.get('upgraded');
    const sessionId = searchParams.get('session_id');

    if (paidFlag === '0' && !sessionId) {
      toast.message('Checkout canceled. You were not charged.');
      return;
    }

    if ((upgraded === '1' || paidFlag === '1') && sessionId) {
      let cancelled = false;
      (async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          toast.error('Still signed in? Refresh and open Plans again to finish the upgrade.');
          return;
        }
        const res = await fetch('/api/billing/upgrade/confirm', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast.error(json?.error || 'Checkout was not completed. You were not charged.');
          return;
        }
        setPaid(true);
        toast.success('Your organization is now on the paid plan.');
      })();
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [searchParams, supabase]);

  async function startCheckout(plan: PaidPlanId) {
    if (starting || paid) return;
    setStarting(plan);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error('You are still signed in? Refresh and try Upgrade again.');
        return;
      }
      const sku = skuFor(plan, cycle);
      const res = await fetch('/api/billing/upgrade/checkout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sku }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) {
        toast.error(json?.error || 'Could not start Stripe Checkout');
        return;
      }
      const host = window.location.hostname;
      const prodHost = host === 'repairplanet.net' || host.endsWith('.repairplanet.net');
      const testSession = json.livemode === false || String(json.sessionId || '').startsWith('cs_test_');
      if (prodHost && testSession) {
        toast.error(
          'Production Stripe is still test/sandbox. Set Netlify STRIPE_SECRET_KEY to the live invoice secret and redeploy.'
        );
        return;
      }
      window.location.assign(json.url);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not start checkout');
    } finally {
      setStarting(null);
    }
  }

  const premium = PLAN_OFFERS[skuFor('premium', cycle)];
  const team = PLAN_OFFERS[skuFor('team', cycle)];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <p className="text-xs uppercase tracking-wide text-[var(--gold)] font-semibold mb-2">Upgrade</p>
        <h1 className="text-3xl font-extrabold tracking-tight">Plans and prices</h1>
        <p className="text-[var(--text3)] mt-2 max-w-2xl">
          Stay signed in. Choose a paid plan for{orgName ? ` ${orgName}` : ' your current organization'}.
          Stripe Checkout attaches to this account — it does not create a second one. Cancel anytime
          before paying; you will not be charged.
        </p>

        {paid ? (
          <div className="mt-6 card p-4 border-[var(--gold-border)] text-sm">
            This organization is already on a paid plan.
          </div>
        ) : null}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            className={`btn text-sm ${cycle === 'monthly' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCycle('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            className={`btn text-sm ${cycle === 'annual' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCycle('annual')}
          >
            Annual · save 33%
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <article className="card p-6 flex flex-col">
            <h2 className="text-xl font-bold">Free</h2>
            <p className="text-3xl font-extrabold text-[var(--gold)] mt-2">
              $0 <span className="text-sm font-semibold text-[var(--text3)]">/ month</span>
            </p>
            <ul className="text-sm text-[var(--text2)] mt-4 space-y-1.5 flex-1">
              <li>Schedule, requests, and parts listings</li>
              <li>Ads may appear</li>
              <li>Current plan for unpaid orgs</li>
            </ul>
            <div className="btn btn-secondary w-full text-center mt-5 pointer-events-none opacity-70">
              Current plan
            </div>
          </article>

          <article className="card p-6 flex flex-col border-[var(--gold-border)]">
            <h2 className="text-xl font-bold">Premium</h2>
            <p className="text-3xl font-extrabold text-[var(--gold)] mt-2">
              {premium.displayAmount}{' '}
              <span className="text-sm font-semibold text-[var(--text3)]">{premium.displayPeriod}</span>
            </p>
            {premium.displayOrig ? (
              <p className="text-xs text-[var(--text3)] line-through">{premium.displayOrig} / year list</p>
            ) : null}
            <ul className="text-sm text-[var(--text2)] mt-4 space-y-1.5 flex-1">
              <li>AI troubleshooting assistant</li>
              <li>Full manual library</li>
              <li>No advertisements</li>
            </ul>
            <button
              type="button"
              className="btn btn-primary w-full mt-5"
              disabled={!!starting || paid}
              onClick={() => startCheckout('premium')}
            >
              {starting === 'premium' ? 'Starting checkout…' : 'Upgrade to Premium'}
            </button>
          </article>

          <article className="card p-6 flex flex-col">
            <h2 className="text-xl font-bold">Team</h2>
            <p className="text-3xl font-extrabold text-[var(--gold)] mt-2">
              {team.displayAmount}{' '}
              <span className="text-sm font-semibold text-[var(--text3)]">{team.displayPeriod}</span>
            </p>
            {team.displayOrig ? (
              <p className="text-xs text-[var(--text3)] line-through">{team.displayOrig} / year list</p>
            ) : null}
            <ul className="text-sm text-[var(--text2)] mt-4 space-y-1.5 flex-1">
              <li>Everything in Premium</li>
              <li>Up to 10 user seats</li>
              <li>Shared service history</li>
            </ul>
            <button
              type="button"
              className="btn btn-secondary w-full mt-5"
              disabled={!!starting || paid}
              onClick={() => startCheckout('team')}
            >
              {starting === 'team' ? 'Starting checkout…' : 'Upgrade to Team'}
            </button>
          </article>
        </div>

        <p className="text-xs text-[var(--text3)] mt-6">
          Enterprise (custom pricing):{' '}
          <a className="text-[var(--gold)] hover:underline" href="mailto:enterprise@totalservicepro.com">
            enterprise@totalservicepro.com
          </a>
        </p>
      </div>
    </div>
  );
}

function PlansGate() {
  const [auth, setAuth] = useState<AuthState>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
        } = await getSupabaseClient().auth.getUser();
        if (!cancelled) setAuth(user ? 'in' : 'out');
      } catch {
        if (!cancelled) setAuth('out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (auth === 'loading') {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-5xl mx-auto w-full px-4 py-10 text-[var(--text3)]">Loading plans…</div>
      </div>
    );
  }
  if (auth === 'in') {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex flex-col">
            <Header />
            <div className="max-w-5xl mx-auto w-full px-4 py-10 text-[var(--text3)]">Loading plans…</div>
          </div>
        }
      >
        <SignedInPlans />
      </Suspense>
    );
  }
  return <PublicPlans />;
}

export default function PlansPage() {
  return <PlansGate />;
}
