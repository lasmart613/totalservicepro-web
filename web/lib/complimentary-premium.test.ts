import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPLIMENTARY_PREMIUM_DAYS,
  COMPLIMENTARY_PREMIUM_GRANT_GOD,
  COMPLIMENTARY_PREMIUM_GRANT_SIGNUP,
  applyComplimentarySignupFields,
  clampComplimentaryDays,
  complimentaryGrantSkipReason,
  complimentaryPremiumExpiryFields,
  complimentaryPremiumGrantFields,
  complimentaryPremiumUntil,
  isActivePaidStripeSubscription,
  paidStripeOrganizationIds,
  shouldExpireComplimentaryPremium,
  stripUnbackedComplimentaryPremium,
} from './complimentary-premium.ts';

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date('2026-09-14T12:00:00.000Z');

test('signup grant is 60 days and always pairs is_premium with premium_until', () => {
  assert.equal(COMPLIMENTARY_PREMIUM_DAYS, 60);
  const fields = complimentaryPremiumGrantFields({ source: 'signup', now });
  assert.equal(fields.is_premium, true);
  assert.equal(fields.premium_grant, COMPLIMENTARY_PREMIUM_GRANT_SIGNUP);
  assert.equal(fields.premium_until, complimentaryPremiumUntil(now, 60));
  assert.equal(new Date(fields.premium_until).getTime() - now.getTime(), 60 * 24 * 60 * 60 * 1000);
  assert.equal('subscription_tier' in fields, false);
  assert.equal('plan' in fields, false);
});

test('new service_company insert gets complimentary Premium; clinics do not', () => {
  const shop = applyComplimentarySignupFields(
    { name: 'Glow Repair', type: 'service_company', is_premium: false },
    'service_company',
    now
  );
  assert.equal(shop.is_premium, true);
  assert.equal(shop.premium_until, complimentaryPremiumUntil(now, 60));
  assert.equal(shop.premium_grant, COMPLIMENTARY_PREMIUM_GRANT_SIGNUP);

  const clinic = applyComplimentarySignupFields(
    { name: 'Lakeview', type: 'customer', is_premium: false },
    'customer',
    now
  );
  assert.equal(clinic.is_premium, false);
  assert.equal(clinic.premium_until, undefined);
});

test('missing premium_until column never leaves a permanent is_premium flip', () => {
  const row = applyComplimentarySignupFields({ type: 'service_company' }, 'service_company', now);
  assert.equal(row.is_premium, true);
  stripUnbackedComplimentaryPremium(row);
  assert.equal(row.is_premium, false);
  assert.equal(row.premium_until, undefined);
});

test('God grant skips non-shops, paid Stripe, and legacy Premium without expiry', () => {
  assert.equal(complimentaryGrantSkipReason(null), 'missing_org');
  assert.equal(
    complimentaryGrantSkipReason({ type: 'customer', is_premium: false }),
    'not_service_company'
  );
  assert.equal(
    complimentaryGrantSkipReason({ type: 'service_company', is_premium: false }, { paidStripe: true }),
    'paid_stripe'
  );
  assert.equal(
    complimentaryGrantSkipReason({ type: 'service_company', is_premium: true }),
    'legacy_paid'
  );
  assert.equal(
    complimentaryGrantSkipReason({
      type: 'service_company',
      is_premium: true,
      premium_until: '2026-11-01T00:00:00.000Z',
    }),
    null
  );
  assert.equal(
    complimentaryGrantSkipReason({ type: 'service_company', is_premium: false }),
    null
  );
});

test('expiry never touches paid Stripe or orgs without premium_until', () => {
  const expired = {
    is_premium: true,
    premium_until: '2026-01-01T00:00:00.000Z',
    premium_grant: COMPLIMENTARY_PREMIUM_GRANT_SIGNUP,
  };
  assert.equal(shouldExpireComplimentaryPremium(expired, { now }), true);
  assert.equal(shouldExpireComplimentaryPremium(expired, { now, paidStripe: true }), false);
  assert.equal(shouldExpireComplimentaryPremium({ is_premium: true }, { now }), false);
  assert.equal(
    shouldExpireComplimentaryPremium(
      { is_premium: true, premium_until: '2026-01-01T00:00:00.000Z', plan: 'premium' },
      { now }
    ),
    false
  );
  assert.deepEqual(complimentaryPremiumExpiryFields(), {
    is_premium: false,
    premium_until: null,
    premium_grant: null,
  });
});

test('active Stripe subscription rows are detected only with a real sub_ id', () => {
  assert.equal(
    isActivePaidStripeSubscription({
      stripe_subscription_id: 'sub_live_larry',
      status: 'active',
      organization_id: 7,
    }),
    true
  );
  assert.equal(
    isActivePaidStripeSubscription({
      stripe_subscription_id: 'sub_live_larry',
      status: 'canceled',
      organization_id: 7,
    }),
    false
  );
  assert.equal(
    isActivePaidStripeSubscription({ stripe_subscription_id: null, status: 'active' }),
    false
  );
  const paid = paidStripeOrganizationIds([
    { organization_id: 7, stripe_subscription_id: 'sub_live_larry', status: 'active' },
    { organization_id: 99, stripe_subscription_id: 'sub_x', status: 'canceled' },
  ]);
  assert.deepEqual([...paid], ['7']);
});

test('God grant / expire APIs stay behind requireGodCaller and do not call Stripe', () => {
  const grant = readFileSync(join(here, '../app/api/god/orgs/complimentary-premium/route.ts'), 'utf8');
  const expire = readFileSync(join(here, '../app/api/god/premium/expire/route.ts'), 'utf8');
  const persist = readFileSync(join(here, './billing/upgrade-session.ts'), 'utf8');
  const checkout = readFileSync(join(here, './billing/stripe-subscription.ts'), 'utf8');
  assert.match(grant, /requireGodCaller/);
  assert.match(expire, /requireGodCaller/);
  assert.match(grant, /complimentaryPremiumGrantFields/);
  assert.match(grant, /notifyComplimentaryPremiumGrants/);
  assert.match(expire, /shouldExpireComplimentaryPremium/);
  assert.match(expire, /\.not\('premium_until', 'is', null\)/);
  assert.doesNotMatch(grant, /checkout\/sessions|trial_period|coupons/);
  assert.doesNotMatch(expire, /checkout\/sessions|trial_period|coupons/);
  assert.match(persist, /premium_until: null/);
  assert.doesNotMatch(checkout, /trial_period_days/);
});

test('shop-invite promise is wired on company signup', () => {
  const signup = readFileSync(join(here, '../app/signup/company/page.tsx'), 'utf8');
  const pending = readFileSync(join(here, './pending-signup.ts'), 'utf8');
  const onboard = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  const dashboard = readFileSync(join(here, '../app/admin/god/page.tsx'), 'utf8');
  assert.match(signup, /two months of Premium on us/i);
  assert.match(pending, /applyComplimentarySignupFields/);
  assert.match(onboard, /applyComplimentarySignupFields/);
  assert.match(dashboard, /GodComplimentaryPremium/);
  assert.equal(clampComplimentaryDays(120), 90);
  assert.equal(clampComplimentaryDays('nope'), 60);
  assert.equal(COMPLIMENTARY_PREMIUM_GRANT_GOD, 'complimentary_god');
});
