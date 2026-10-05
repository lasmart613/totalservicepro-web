import { NextRequest, NextResponse } from 'next/server';
import { refreshOnboardingFromState, StripeConnectApiError } from '@/lib/billing/stripe-connect-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin.replace(/\/$/, '');
  try {
    const url = await refreshOnboardingFromState(req.nextUrl.searchParams.get('state') || '', origin);
    return NextResponse.redirect(url);
  } catch (e: unknown) {
    const message = e instanceof StripeConnectApiError ? e.message : 'Stripe setup link expired.';
    const back = new URL('/company', origin);
    back.searchParams.set('stripe', 'error');
    back.searchParams.set('stripe_error', message.slice(0, 180));
    return NextResponse.redirect(back);
  }
}
