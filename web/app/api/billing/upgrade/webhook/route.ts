import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { applyPaidCheckoutSession, applyPaidSubscriptionRecord } from '@/lib/billing/apply-org-upgrade';
import {
  isCheckoutSessionCompleted,
  isSubscriptionLifecycle,
  stripeWebhookObject,
  stripeWebhookSecrets,
  verifyStripeWebhookAgainstSecrets,
  type StripeWebhookEventLike,
} from '@/lib/billing/stripe-webhook';
import {
  retrieveCheckoutSession,
  retrieveStripeSubscription,
  StripeSubscriptionError,
  type StripeObject,
} from '@/lib/billing/stripe-subscription';
import { applyInvoiceCheckoutSession } from '@/lib/billing/persist-invoice-payment';
import { applyPartCheckoutSession } from '@/lib/billing/apply-part-order';
import { webhookCheckoutAction } from '@/lib/billing/stripe-connect';
import { syncConnectedAccount } from '@/lib/billing/stripe-connect-api';

export const dynamic = 'force-dynamic';

/**
 * Stripe → org upgrade when success_url is missed.
 * Verifies the webhook signature. Idempotent. Never creates a user or org.
 */
export async function POST(req: NextRequest) {
  const secrets = stripeWebhookSecrets();
  if (secrets.length === 0) {
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
  if (!verifyStripeWebhookAgainstSecrets(rawBody, header, secrets)) {
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
    if (event.type === 'account.updated') {
      const synced = await syncConnectedAccount(writer, stripeWebhookObject(event));
      return NextResponse.json({ ok: true, kind: 'connect_account', ...synced });
    }

    if (isCheckoutSessionCompleted(event.type)) {
      const obj = stripeWebhookObject(event);
      const sessionId = obj && typeof obj.id === 'string' ? obj.id : '';
      if (!sessionId) return NextResponse.json({ ok: true, ignored: 'missing_session_id' });
      const session = await retrieveCheckoutSession(sessionId);
      const action = webhookCheckoutAction(session);
      if (action === 'part') {
        const part = await applyPartCheckoutSession({ writer, session });
        if (!part.ok) {
          if (part.retry) {
            return NextResponse.json({ error: part.reason }, { status: 500 });
          }
          return NextResponse.json({ ok: true, ignored: part.reason, kind: 'part' });
        }
        return NextResponse.json({
          ok: true,
          applied: true,
          kind: 'part',
          orderId: part.applied.orderId,
          listingId: part.applied.listingId,
          payoutStatus: part.applied.payoutStatus,
          alreadyApplied: part.applied.alreadyApplied,
        });
      }
      const invoicePay = await applyInvoiceCheckoutSession({ writer, session });
      if (invoicePay.ok) {
        return NextResponse.json({
          ok: true,
          applied: true,
          kind: 'invoice',
          invoiceId: invoicePay.applied.invoiceId,
          status: invoicePay.applied.status,
          alreadyApplied: invoicePay.applied.alreadyApplied,
        });
      }
      if (invoicePay.reason === 'invoice_void') {
        return NextResponse.json({ ok: true, ignored: 'invoice_void' });
      }
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
