import { NextRequest, NextResponse } from 'next/server';
import {
  completeOnboardingReturn,
  readConnectState,
  StripeConnectApiError,
} from '@/lib/billing/stripe-connect-api';
import { connectActorFromRequest } from '@/lib/billing/stripe-connect-actor';
import { authorizeConnectCallback, safeConnectNext } from '@/lib/billing/stripe-connect';

export const dynamic = 'force-dynamic';

function resumeRedirect(origin: string, stateToken: string) {
  const state = readConnectState(stateToken);
  const next = new URL(safeConnectNext(state?.next), origin);
  if (!state) {
    next.searchParams.set('stripe', 'error');
    return NextResponse.redirect(next);
  }
  next.searchParams.set('stripe_connect', 'return');
  next.searchParams.set('state', stateToken);
  return NextResponse.redirect(next);
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin.replace(/\/$/, '');
  const stateToken = req.nextUrl.searchParams.get('state') || '';
  const actor = await connectActorFromRequest(req);
  const state = readConnectState(stateToken);
  if (!actor || !state || !authorizeConnectCallback(state, actor).ok) {
    if (!actor && state) return resumeRedirect(origin, stateToken);
    const back = new URL(safeConnectNext(state?.next), origin);
    back.searchParams.set('stripe', 'error');
    return NextResponse.redirect(back);
  }
  try {
    const done = await completeOnboardingReturn(stateToken, actor);
    const next = new URL(safeConnectNext(done.next), origin);
    next.searchParams.set('stripe', done.connected ? 'connected' : 'pending');
    return NextResponse.redirect(next);
  } catch (e: unknown) {
    const message = e instanceof StripeConnectApiError ? e.message : 'Stripe setup could not be saved.';
    const fallback = new URL(safeConnectNext(state.next), origin);
    fallback.searchParams.set('stripe', 'error');
    fallback.searchParams.set('stripe_error', message.slice(0, 180));
    return NextResponse.redirect(fallback);
  }
}

export async function POST(req: NextRequest) {
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
    const done = await completeOnboardingReturn(stateToken, actor);
    return NextResponse.json(done);
  } catch (e: unknown) {
    const status = e instanceof StripeConnectApiError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Stripe setup could not be saved.';
    return NextResponse.json({ error: message }, { status });
  }
}
