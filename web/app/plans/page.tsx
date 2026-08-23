'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { LandingShell } from '@/components/landing/LandingShell';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  currentOrgPlan,
  currentOrgPlanLabel,
  orgIsPaid,
  orgIsTopPaid,
  orgMayStartPaidPlan,
  type OrgPlanFields,
} from '@/lib/org-plan';
import { loadOrgPlanRow } from '@/lib/org-plan-load';
import { PLAN_OFFERS, skuFor, type BillingCycle, type PaidPlanId } from '@/lib/billing/plan-catalog';
import { startClientUpgradeCheckout } from '@/lib/billing/start-client-checkout';

type AuthState = 'loading' | 'in' | 'out';

/** Shown on the /plans tiles in both signed-in and logged-out views. */
const PREMIUM_MANUALS_LINE = '15 service manuals';
const TEAM_MANUALS_LINE = 'Unlimited service manuals';

function PublicPlans() {
  return (
    <LandingShell>
      <section className="lp-section" style={{ marginTop: 0, borderTop: 'none' }}>
        <p className="lp-kicker">Total Service Pro</p>
        <h1 className="lp-h2">Free Plan, Premium, and Team</h1>
        <p className="lp-lede">
          Register for a Free Plan. Compare Free, Premium, and Team, then create your account.
          Signed-in companies upgrade from this page without registering again.
        </p>
        <div className="lp-paths">
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
              <li>{PREMIUM_MANUALS_LINE}</li>
              <li>No advertisements</li>
            </ul>
            <Link href="/signup" className="lp-btn lp-btn-ghost">
              Register for Total Service Pro
            </Link>
          </article>
          <article className="lp-path" style={{ cursor: 'default' }}>
            <h3>Team</h3>
            <p className="lp-lede" style={{ margin: '0 0 12px' }}>
              <strong>{PLAN_OFFERS.team_monthly.displayAmount}</strong>{' '}
              {PLAN_OFFERS.team_monthly.displayPeriod}
            </p>
            <ul>
              <li>Everything in Premium</li>
              <li>{TEAM_MANUALS_LINE}</li>
              <li>Up to 10 user seats</li>
              <li>Shared service history</li>
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
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [starting, setStarting] = useState<PaidPlanId | null>(null);
  const [org, setOrg] = useState<OrgPlanFields | null>(null);
  const [orgName, setOrgName] = useState<string>('');
  const [orgReady, setOrgReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setOrgReady(true);
        return;
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      const orgId = profile?.organization_id;
      let row: (OrgPlanFields & { name?: string | null }) | null = null;
      if (orgId != null && String(orgId).trim() !== '') {
        row = await loadOrgPlanRow(supabase, orgId);
      }
      if (!cancelled) {
        setOrgName(String(row?.name || ''));
        setOrg(row);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token && !orgIsPaid(row)) {
        try {
          const res = await fetch('/api/billing/upgrade/sync', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          const json = (await res.json().catch(() => ({}))) as {
            org?: OrgPlanFields & { name?: string | null };
            organizationName?: string | null;
          };
          if (!cancelled && res.ok && json?.org) {
            setOrg(json.org);
            if (json.organizationName) setOrgName(String(json.organizationName));
          }
        } catch {
          /* keep the row we already loaded; do not invent a paid plan */
        }
      }
      if (!cancelled) setOrgReady(true);
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
      router.replace(`/checkout/receipt?session_id=${encodeURIComponent(sessionId)}`);
    }
  }, [searchParams, router]);

  const namedPlan = currentOrgPlan(org);
  const planLabel = currentOrgPlanLabel(org);
  const paid = namedPlan !== 'free';
  const topPaid = orgIsTopPaid(org);

  async function startCheckout(plan: PaidPlanId) {
    if (starting || !orgMayStartPaidPlan(org, plan)) return;
    setStarting(plan);
    try {
      const session = await startClientUpgradeCheckout(skuFor(plan, cycle));
      window.location.assign(session.url);
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

        {orgReady ? (
          <div className="mt-6 card p-4 border-[var(--gold-border)] text-sm">
            {orgName ? `${orgName} is on ${planLabel}.` : `Current plan: ${planLabel}.`}
            {namedPlan === 'premium'
              ? ' Upgrade to Team on this same account — you stay signed in.'
              : topPaid
                ? ' Upgrade is hidden.'
                : ' Upgrade from this page without creating a second account.'}
          </div>
        ) : (
          <div className="mt-6 text-sm text-[var(--text3)]">Loading current plan…</div>
        )}

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
              <li>Get started at no charge</li>
            </ul>
            <div className="btn btn-secondary w-full text-center mt-5 pointer-events-none opacity-70">
              {!orgReady ? '…' : namedPlan === 'free' ? 'Current plan' : 'Included'}
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
              <li>{PREMIUM_MANUALS_LINE}</li>
              <li>No advertisements</li>
            </ul>
            <button
              type="button"
              className="btn btn-primary w-full mt-5"
              disabled={!!starting || !orgMayStartPaidPlan(org, 'premium')}
              onClick={() => startCheckout('premium')}
            >
              {starting === 'premium'
                ? 'Starting checkout…'
                : !orgReady
                  ? '…'
                  : namedPlan === 'premium'
                    ? 'Current plan'
                    : paid
                      ? 'Included'
                      : 'Upgrade to Premium'}
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
              <li>{TEAM_MANUALS_LINE}</li>
              <li>Up to 10 user seats</li>
              <li>Shared service history</li>
            </ul>
            <button
              type="button"
              className="btn btn-secondary w-full mt-5"
              disabled={!!starting || !orgMayStartPaidPlan(org, 'team')}
              onClick={() => startCheckout('team')}
            >
              {starting === 'team'
                ? 'Starting checkout…'
                : !orgReady
                  ? '…'
                  : topPaid
                    ? 'Current plan'
                    : 'Upgrade to Team'}
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
