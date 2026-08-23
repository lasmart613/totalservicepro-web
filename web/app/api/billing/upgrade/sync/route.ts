import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { applyPaidCheckoutSession, applyPaidSubscriptionRecord } from '@/lib/billing/apply-org-upgrade';
import { loadBillingCaller } from '@/lib/billing/billing-caller';
import { currentOrgPlan, currentOrgPlanLabel, orgIsPaid } from '@/lib/org-plan';
import { loadOrgPlanRow } from '@/lib/org-plan-load';
import { normalizeOrgId } from '@/lib/billing/upgrade-session';
import {
  pickLatestPaidSubscription,
  pickLatestPaidUpgradeSession,
  uniqueStripeObjects,
} from '@/lib/billing/sync-subscription';
import {
  checkoutSessionSearchQuery,
  listActiveSubscriptionsForCustomer,
  listCompleteCheckoutSessionsForCustomer,
  listCustomersByEmail,
  retrieveCheckoutSession,
  searchCheckoutSessions,
  StripeSubscriptionError,
  type StripeObject,
} from '@/lib/billing/stripe-subscription';

export const dynamic = 'force-dynamic';

/**
 * Signed-in recovery: look up this user/org's latest complete Stripe
 * subscription Checkout (or active subscription) and apply it if the org
 * is still free. Does not create Checkout or invent a charge.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await loadBillingCaller(req);
    if (!('user' in caller) || !caller.user) return caller.error;
    const { user, supabase } = caller;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    let orgId = normalizeOrgId(profile?.organization_id);
    const writer = hasServiceRole() ? getSupabaseAdmin() : supabase;
    if (!orgId && hasServiceRole()) {
      const { data: adminProfile } = await writer
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      orgId = normalizeOrgId(adminProfile?.organization_id);
    }
    if (!orgId) {
      return NextResponse.json(
        { error: 'Your account is not linked to an organization.' },
        { status: 409 }
      );
    }

    const owner = { userId: user.id, organizationId: orgId };
    const org = await loadOrgPlanRow(writer, orgId);
    if (orgIsPaid(org)) {
      return NextResponse.json({
        ok: true,
        applied: false,
        alreadyPaid: true,
        organizationId: orgId,
        organizationName: org?.name ? String(org.name) : null,
        plan: currentOrgPlan(org),
        planLabel: currentOrgPlanLabel(org),
        org,
      });
    }

    const customerIds = new Set<string>();
    const { data: stripeRow } = await writer
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (stripeRow?.stripe_customer_id) customerIds.add(String(stripeRow.stripe_customer_id));

    if (user.email) {
      try {
        for (const customer of await listCustomersByEmail(user.email)) {
          if (typeof customer.id === 'string' && customer.id.startsWith('cus_')) {
            customerIds.add(customer.id);
          }
        }
      } catch (emailErr) {
        console.warn('[billing/upgrade/sync] customer email lookup skipped', emailErr);
      }
    }

    const sessions: StripeObject[] = [];
    for (const customerId of customerIds) {
      try {
        sessions.push(...(await listCompleteCheckoutSessionsForCustomer(customerId)));
      } catch (listErr) {
        console.warn('[billing/upgrade/sync] session list skipped', listErr);
      }
    }

    const searchQuery = checkoutSessionSearchQuery({ organizationId: orgId, userId: user.id });
    if (searchQuery) {
      try {
        sessions.push(...(await searchCheckoutSessions(searchQuery)));
      } catch (searchErr) {
        console.warn('[billing/upgrade/sync] session search skipped', searchErr);
      }
    }

    const uniqueSessions = uniqueStripeObjects(sessions);
    const picked = pickLatestPaidUpgradeSession(uniqueSessions, owner);
    if (picked?.id) {
      const session = await retrieveCheckoutSession(String(picked.id));
      const result = await applyPaidCheckoutSession({
        writer,
        session,
        expectedOwner: owner,
        allowMissingUser: true,
        allowMissingOrg: true,
        userEmail: user.email || null,
      });
      if (result.ok) {
        const { data: orgRow } = await writer
          .from('organizations')
          .select('name')
          .eq('id', orgId)
          .maybeSingle();
        return NextResponse.json({
          ok: true,
          applied: true,
          organizationId: result.applied.organizationId,
          organizationName: orgRow?.name ? String(orgRow.name) : null,
          plan: result.applied.plan,
          sku: result.applied.sku,
          org: result.applied.org,
          ...result.applied.receipt,
        });
      }
    }

    const subscriptions: StripeObject[] = [];
    for (const customerId of customerIds) {
      try {
        subscriptions.push(...(await listActiveSubscriptionsForCustomer(customerId)));
      } catch (subErr) {
        console.warn('[billing/upgrade/sync] subscription list skipped', subErr);
      }
    }
    const pickedSub = pickLatestPaidSubscription(uniqueStripeObjects(subscriptions), owner);
    if (pickedSub) {
      const result = await applyPaidSubscriptionRecord({
        writer,
        subscription: pickedSub,
        expectedOwner: owner,
        userEmail: user.email || null,
      });
      if (result.ok) {
        const { data: orgRow } = await writer
          .from('organizations')
          .select('name')
          .eq('id', orgId)
          .maybeSingle();
        return NextResponse.json({
          ok: true,
          applied: true,
          organizationId: result.applied.organizationId,
          organizationName: orgRow?.name ? String(orgRow.name) : null,
          plan: result.applied.plan,
          sku: result.applied.sku,
          org: result.applied.org,
          ...result.applied.receipt,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      applied: false,
      alreadyPaid: false,
      organizationId: orgId,
      organizationName: org?.name ? String(org.name) : null,
      plan: 'free',
      planLabel: 'Free',
      org,
    });
  } catch (e: unknown) {
    const status = e instanceof StripeSubscriptionError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Sync failed';
    console.error('[billing/upgrade/sync]', e);
    return NextResponse.json({ error: message }, { status });
  }
}
