import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  buildUpgradeReceipt,
  evaluateUpgradeSession,
  normalizeOrgId,
  orgUpgradeFields,
} from '@/lib/billing/upgrade-session';
import { getPlanOffer } from '@/lib/billing/plan-catalog';
import {
  cancelStripeSubscription,
  retrieveCheckoutSession,
  retrieveStripeInvoice,
  stripeCustomerIdFromSession,
  stripeSubscriptionIdFromSession,
  StripeSubscriptionError,
} from '@/lib/billing/stripe-subscription';

export const dynamic = 'force-dynamic';

function missingColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

async function loadCaller(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { error: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }) };
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) };
  }
  return { user, supabase };
}

async function writeOrgUpgrade(client: SupabaseClient, orgId: string, plan: string) {
  const payload: Record<string, unknown> = {
    ...orgUpgradeFields(plan),
    updated_at: new Date().toISOString(),
  };
  let lastError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await client
      .from('organizations')
      .update(payload)
      .eq('id', orgId)
      .select('id')
      .maybeSingle();
    if (!error && data?.id != null) return { ...data, ...payload };
    lastError = error;
    const col = missingColumn(error?.message);
    if (col && col in payload) {
      delete payload[col];
      continue;
    }
    break;
  }
  throw new Error(lastError?.message || 'Could not update the organization plan');
}

/**
 * After Stripe success_url, verify the paid session and upgrade THIS org.
 * Unpaid / canceled sessions are rejected. No invite email is sent.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await loadCaller(req);
    if (!('user' in caller) || !caller.user) return caller.error;
    const { user, supabase } = caller;

    const body = (await req.json().catch(() => ({}))) as { session_id?: string; sessionId?: string };
    const sessionId = String(body.session_id || body.sessionId || '').trim();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

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

    const session = await retrieveCheckoutSession(sessionId);
    if (typeof session.invoice === 'string' && String(session.invoice).startsWith('in_')) {
      try {
        session.invoice = await retrieveStripeInvoice(String(session.invoice));
      } catch (invoiceErr) {
        console.warn('[billing/upgrade/confirm] invoice expand skipped', invoiceErr);
      }
    }
    const verdict = evaluateUpgradeSession(session, {
      userId: user.id,
      organizationId: orgId,
    });
    if (!verdict.ok) {
      return NextResponse.json(
        { error: 'Checkout was not completed. You were not charged.', reason: verdict.reason },
        { status: 409 }
      );
    }

    const { data: priorSub } = await writer
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const priorSubscriptionId =
      priorSub?.stripe_subscription_id != null ? String(priorSub.stripe_subscription_id) : null;

    const org = await writeOrgUpgrade(writer, orgId, verdict.plan);
    const { data: orgRow } = await writer
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();
    const customerId = stripeCustomerIdFromSession(session);
    const subscriptionId = stripeSubscriptionIdFromSession(session);

    try {
      if (customerId) {
        const { data: existing } = await writer
          .from('stripe_customers')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (existing?.id) {
          await writer
            .from('stripe_customers')
            .update({ stripe_customer_id: customerId, email: user.email || null })
            .eq('id', existing.id);
        } else {
          await writer.from('stripe_customers').insert({
            user_id: user.id,
            stripe_customer_id: customerId,
            email: user.email || null,
          });
        }
      }

      const subRow: Record<string, unknown> = {
        user_id: user.id,
        organization_id: Number.isFinite(Number(orgId)) ? Number(orgId) : orgId,
        tier: verdict.plan,
        status: 'active',
        sku: verdict.sku,
        platform: 'stripe',
        subscription_type: 'stripe',
        package_name: verdict.plan,
        stripe_subscription_id: subscriptionId,
        updated_at: new Date().toISOString(),
      };
      const { data: existingSub } = await writer
        .from('subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (existingSub?.id) {
        await writer.from('subscriptions').update(subRow).eq('id', existingSub.id);
      } else {
        await writer.from('subscriptions').insert(subRow);
      }
    } catch (recordErr) {
      console.warn('[billing/upgrade/confirm] org upgraded; ledger write skipped', recordErr);
    }

    if (
      verdict.plan === 'team' &&
      priorSubscriptionId &&
      subscriptionId &&
      priorSubscriptionId !== subscriptionId
    ) {
      try {
        await cancelStripeSubscription(priorSubscriptionId);
      } catch (cancelErr) {
        console.warn('[billing/upgrade/confirm] prior subscription cancel skipped', cancelErr);
      }
    }

    const offer = getPlanOffer(verdict.sku);
    const fallbackAmountLabel = offer
      ? `${offer.displayAmount} ${offer.displayPeriod}`.replace(/\s+/g, ' ').trim()
      : null;
    const receipt = buildUpgradeReceipt({
      plan: verdict.plan,
      sku: verdict.sku,
      session,
      fallbackAmountLabel,
    });

    return NextResponse.json({
      ok: true,
      organizationId: orgId,
      organizationName: orgRow?.name ? String(orgRow.name) : null,
      plan: verdict.plan,
      sku: verdict.sku,
      org,
      ...receipt,
    });
  } catch (e: unknown) {
    const status = e instanceof StripeSubscriptionError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Confirm failed';
    console.error('[billing/upgrade/confirm]', e);
    return NextResponse.json({ error: message }, { status });
  }
}
