import { NextRequest, NextResponse } from 'next/server';
import { completeOnboardingReturn, StripeConnectApiError } from '@/lib/billing/stripe-connect-api';
import { safeConnectNext } from '@/lib/billing/stripe-connect';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin.replace(/\/$/, '');
  const fallback = new URL('/company', origin);
  try {
    const done = await completeOnboardingReturn(req.nextUrl.searchParams.get('state') || '');
    const next = new URL(safeConnectNext(done.next), origin);
    next.searchParams.set('stripe', done.connected ? 'connected' : 'pending');
    return NextResponse.redirect(next);
  } catch (e: unknown) {
    const message = e instanceof StripeConnectApiError ? e.message : 'Stripe setup could not be saved.';
    fallback.searchParams.set('stripe', 'error');
    fallback.searchParams.set('stripe_error', message.slice(0, 180));
    return NextResponse.redirect(fallback);
  }
}
