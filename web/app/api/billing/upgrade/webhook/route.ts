import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { applyPaidCheckoutSession, applyPaidSubscriptionRecord } from '@/lib/billing/apply-org-upgrade';
import {
  getStripeWebhookSecret,
  isCheckoutSessionCompleted,
  isSubscriptionLifecycle,
  stripeWebhookObject,
  verifyStripeWebhookSignature,
  type StripeWebhookEventLike,
} from '@/lib/billing/stripe-webhook';
import {
  retrieveCheckoutSession,
  retrieveStripeSubscription,
  StripeSubscriptionError,
  type StripeObject,
} from '@/lib/billing/stripe-subscription';

export const dynamic = 'force-dynamic';

/**
 * Stripe → org upgrade when success_url is missed.
 * Verifies the webhook signature. Idempotent. Never creates a user or org.
 */
export async function POST(req: NextRequest) {
  const secret = getStripeWebhookSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET is not set on the server.' },
      { status: 503 }
    );
  }
  if (!hasServiceRole()) {
    return NextResponse.json(
      { error: 'Service role is required to apply a webhook upgrade.' },
      { status: 503 }
    );
  }

  const rawBody = await req.text();
  const header = req.headers.get('stripe-signature') || '';
  if (!verifyStripeWebhookSignature(rawBody, header, secret)) {
    return NextResponse.json({ error: 'Invalid Stripe signature' }, { status: 400 });
  }

  let event: StripeWebhookEventLike;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEventLike;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const writer = getSupabaseAdmin();

  try {
    if (isCheckoutSessionCompleted(event.type)) {
      const obj = stripeWebhookObject(event);
      const sessionId = obj && typeof obj.id === 'string' ? obj.id : '';
      if (!sessionId) return NextResponse.json({ ok: true, ignored: 'missing_session_id' });
      const session = await retrieveCheckoutSession(sessionId);
      const result = await applyPaidCheckoutSession({
        writer,
        session,
        allowMissingUser: true,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: true, ignored: result.reason });
      }
      return NextResponse.json({
        ok: true,
        applied: true,
        organizationId: result.applied.organizationId,
        plan: result.applied.plan,
      });
    }

    if (isSubscriptionLifecycle(event.type)) {
      const obj = stripeWebhookObject(event) as StripeObject | null;
      const subId = obj && typeof obj.id === 'string' ? obj.id : '';
      if (!subId) return NextResponse.json({ ok: true, ignored: 'missing_subscription_id' });
      const subscription = await retrieveStripeSubscription(subId);
      const result = await applyPaidSubscriptionRecord({
        writer,
        subscription,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: true, ignored: result.reason });
      }
      return NextResponse.json({
        ok: true,
        applied: true,
        organizationId: result.applied.organizationId,
        plan: result.applied.plan,
      });
    }

    return NextResponse.json({ ok: true, ignored: event.type || 'unknown_event' });
  } catch (e: unknown) {
    const status = e instanceof StripeSubscriptionError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Webhook failed';
    console.error('[billing/upgrade/webhook]', e);
    return NextResponse.json({ error: message }, { status });
  }
}
