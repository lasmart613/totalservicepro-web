import { NextRequest, NextResponse } from 'next/server';
import { loadBillingCaller } from '@/lib/billing/billing-caller';
import {
  connectSiteOrigin,
  connectStatusPayload,
  createOnboardingLink,
  ensureExpressAccount,
  loadConnectCaller,
  saveOrgStripeAccount,
  StripeConnectApiError,
} from '@/lib/billing/stripe-connect-api';
import { canStartStripeConnect, safeConnectNext } from '@/lib/billing/stripe-connect';

export const dynamic = 'force-dynamic';

async function callerFrom(req: NextRequest) {
  const loaded = await loadBillingCaller(req);
  if ('error' in loaded) return loaded;
  const { data: profile } = await loaded.supabase
    .from('user_profiles')
    .select('role, organization_id, active_organization_id')
    .eq('id', loaded.user.id)
    .maybeSingle();
  const caller = await loadConnectCaller({
    userId: loaded.user.id,
    email: loaded.user.email,
    profile,
  });
  return caller;
}

export async function GET(req: NextRequest) {
  try {
    const caller = await callerFrom(req);
    if ('error' in caller && 'status' in caller) {
      return NextResponse.json({ error: caller.error, code: caller.code }, { status: caller.status });
    }
    if ('error' in caller) return caller.error;
    return NextResponse.json(connectStatusPayload(caller));
  } catch (e: unknown) {
    const status = e instanceof StripeConnectApiError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Could not check Stripe';
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await callerFrom(req);
    if ('error' in caller && 'status' in caller) {
      return NextResponse.json({ error: caller.error, code: caller.code }, { status: caller.status });
    }
    if ('error' in caller) return caller.error;
    if (!canStartStripeConnect(caller.role, caller.orgType)) {
      return NextResponse.json(
        {
          error: 'A company admin needs to connect Stripe for this organization.',
          code: 'forbidden',
        },
        { status: 403 }
      );
    }
    if (!caller.schemaReady) {
      return NextResponse.json(
        {
          error:
            'Stripe Connect columns are not on organizations yet. Apply the Stripe Connect migration, then try again.',
          code: 'stripe_connect_schema',
        },
        { status: 503 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const next = safeConnectNext(typeof body?.returnTo === 'string' ? body.returnTo : '/company');
    const account = await ensureExpressAccount({
      orgId: caller.orgId,
      orgName: caller.orgName,
      orgType: caller.orgType,
      email: caller.email || caller.orgEmail,
      existingAccountId: caller.account.accountId,
    });
    const saved = await saveOrgStripeAccount(caller.orgId, account);
    if (!saved.ok) {
      console.error('[stripe/connect] stored account save failed', account.id, saved.message);
      return NextResponse.json({ error: saved.message, code: 'stripe_connect_schema' }, { status: 503 });
    }
    if (account.charges_enabled === true && account.details_submitted === true) {
      return NextResponse.json({
        connected: true,
        accountId: account.id,
        chargesEnabled: true,
        url: null,
      });
    }
    const url = await createOnboardingLink({
      accountId: String(account.id),
      orgId: caller.orgId,
      userId: caller.userId,
      next,
      origin: connectSiteOrigin(req),
    });
    return NextResponse.json({
      url,
      accountId: account.id,
      chargesEnabled: account.charges_enabled === true,
    });
  } catch (e: unknown) {
    const status = e instanceof StripeConnectApiError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Could not start Stripe setup';
    console.error('[stripe/connect]', e);
    return NextResponse.json(
      { error: message, code: e instanceof StripeConnectApiError ? e.code : 'stripe_connect_error' },
      { status }
    );
  }
}
