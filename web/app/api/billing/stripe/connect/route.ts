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
import { authorizeConnectOrg, requestedConnectOrgId, safeConnectNext } from '@/lib/billing/stripe-connect';

export const dynamic = 'force-dynamic';

type ConnectUser = { id: string; email?: string | null };

export type StripeConnectDeps = {
  userClient?: {
    auth: {
      getUser: (token?: string) => Promise<{ data: { user: ConnectUser | null }; error: unknown }>;
    };
    from: (table: string) => any;
  };
  adminClient?: { from: (table: string) => any };
  hasServiceRole?: () => boolean;
};

async function callerFrom(req: NextRequest, deps: StripeConnectDeps = {}) {
  if (deps.userClient) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return { error: 'Sign in required', status: 401 as const, code: 'signed_out' };
    const { data, error } = await deps.userClient.auth.getUser(token);
    if (error || !data.user?.id) return { error: 'Invalid session', status: 401 as const, code: 'signed_out' };
    const { data: profile } = await deps.userClient
      .from('user_profiles')
      .select('role, organization_id, active_organization_id')
      .eq('id', data.user.id)
      .maybeSingle();
    return loadConnectCaller({
      userId: data.user.id,
      email: data.user.email,
      profile,
      adminClient: deps.adminClient,
      serviceRoleReady: deps.hasServiceRole ? deps.hasServiceRole() : undefined,
    });
  }
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
  return runStripeConnectGet(req);
}

export async function runStripeConnectGet(req: NextRequest, deps: StripeConnectDeps = {}) {
  try {
    const caller = await callerFrom(req, deps);
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
  return runStripeConnectPost(req);
}

export async function runStripeConnectPost(req: NextRequest, deps: StripeConnectDeps = {}) {
  try {
    const caller = await callerFrom(req, deps);
    if ('error' in caller && 'status' in caller) {
      return NextResponse.json({ error: caller.error, code: caller.code }, { status: caller.status });
    }
    if ('error' in caller) return caller.error;
    const body = await req.json().catch(() => ({}));
    const access = authorizeConnectOrg({
      membershipRole: caller.role,
      orgType: caller.orgType,
      ownOrgId: caller.orgId,
      targetOrgId: requestedConnectOrgId(body),
    });
    if (!access.ok) {
      return NextResponse.json(
        {
          error: 'A company admin needs to connect Stripe for this organization.',
          code: 'forbidden',
        },
        { status: access.status }
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
