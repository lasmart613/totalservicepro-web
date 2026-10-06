import { NextRequest, NextResponse } from 'next/server';
import {
  readConnectState,
  refreshOnboardingFromState,
  StripeConnectApiError,
} from '@/lib/billing/stripe-connect-api';
import { connectActorFromRequest } from '@/lib/billing/stripe-connect-actor';
import { authorizeConnectCallback, safeConnectNext } from '@/lib/billing/stripe-connect';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin.replace(/\/$/, '');
  const stateToken = req.nextUrl.searchParams.get('state') || '';
  const actor = await connectActorFromRequest(req);
  const state = readConnectState(stateToken);
  if (!actor || !state || !authorizeConnectCallback(state, actor).ok) {
    const back = new URL(safeConnectNext(state?.next), origin);
    if (!actor && state) {
      back.searchParams.set('stripe_connect', 'refresh');
      back.searchParams.set('state', stateToken);
      return NextResponse.redirect(back);
    }
    back.searchParams.set('stripe', 'error');
    return NextResponse.redirect(back);
  }
  try {
    const url = await refreshOnboardingFromState(stateToken, origin, actor);
    return NextResponse.redirect(url);
  } catch (e: unknown) {
    const message = e instanceof StripeConnectApiError ? e.message : 'Stripe setup link expired.';
    const back = new URL(safeConnectNext(state.next), origin);
    back.searchParams.set('stripe', 'error');
    back.searchParams.set('stripe_error', message.slice(0, 180));
    return NextResponse.redirect(back);
  }
}

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin.replace(/\/$/, '');
  const actor = await connectActorFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const stateToken = typeof body?.state === 'string' ? body.state : '';
  const state = readConnectState(stateToken);
  if (!actor || !state || !authorizeConnectCallback(state, actor).ok) {
    return NextResponse.json(
      { error: 'Sign in as a company admin of this organization to finish Stripe setup.', code: 'forbidden' },
      { status: 403 }
    );
  }
  try {
    const url = await refreshOnboardingFromState(stateToken, origin, actor);
    return NextResponse.json({ url });
  } catch (e: unknown) {
    const status = e instanceof StripeConnectApiError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Stripe setup link expired.';
    return NextResponse.json({ error: message }, { status });
  }
}
