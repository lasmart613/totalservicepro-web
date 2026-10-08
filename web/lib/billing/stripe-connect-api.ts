/**
 * Stripe Connect Express accounts for service shops and parts suppliers.
 * Server-only. Uses the existing platform secret to create accounts and
 * destination charges. Does not charge the platform when Connect is missing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { getStripeSecret, stripeSecretProblem } from '@/lib/billing/stripe-pay';
import { publicSiteOrigin } from '@/lib/site-origin';
import {
  canStartStripeConnect,
  emptyPayoutAccount,
  normalizeStripeAccountId,
  partnerReferralFromEnv,
  authorizeConnectCallback,
  safeConnectNext,
  sellerConnectPrompt,
  signConnectState,
  verifyConnectState,
  type ConnectCallbackActor,
  type PayoutAccount,
  type StripeConnectPrompt,
} from '@/lib/billing/stripe-connect';

type StripeObject = Record<string, unknown> & {
  id?: string;
  url?: string;
  data?: StripeObject[];
  error?: { message?: string };
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
};

export class StripeConnectApiError extends Error {
  status: number;
  code: string;
  prompt: StripeConnectPrompt | null;
  constructor(message: string, status = 400, code = 'stripe_connect_error', prompt: StripeConnectPrompt | null = null) {
    super(message);
    this.name = 'StripeConnectApiError';
    this.status = status;
    this.code = code;
    this.prompt = prompt;
  }
}

export type LoadedPayoutAccount = {
  account: PayoutAccount;
  schemaReady: boolean;
};

const ORG_STRIPE_SELECT =
  'id, type, name, email, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted';

/** Column missing: Postgres 42703, PostgREST PGRST204, or a schema-cache message. */
export function isMissingStripeColumn(
  error?: { message?: string; code?: string } | string | null
): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    return /column|does not exist|schema cache|PGRST204|42703/i.test(error);
  }
  const code = String(error.code || '').toUpperCase();
  if (code === 'PGRST204' || code === '42703') return true;
  return /column|does not exist|schema cache|PGRST204|42703/i.test(error.message || '');
}

export async function loadSellerPayoutAccount(
  orgId: string | number | null | undefined,
  writer?: SupabaseClient | null
): Promise<LoadedPayoutAccount> {
  const empty = { account: emptyPayoutAccount(), schemaReady: true };
  if (orgId == null || orgId === '') return empty;
  const client = writer || (hasServiceRole() ? getSupabaseAdmin() : null);
  if (!client) return { account: emptyPayoutAccount(), schemaReady: false };
  const { data, error } = await client.from('organizations').select(ORG_STRIPE_SELECT).eq('id', orgId).maybeSingle();
  if (error) {
    if (isMissingStripeColumn(error)) return { account: emptyPayoutAccount(), schemaReady: false };
    console.warn('[stripe-connect] load org', error.message);
    return { account: emptyPayoutAccount(), schemaReady: true };
  }
  return {
    schemaReady: true,
    account: {
      accountId: normalizeStripeAccountId(data?.stripe_account_id),
      chargesEnabled: data?.stripe_charges_enabled === true,
      payoutsEnabled: data?.stripe_payouts_enabled === true,
      detailsSubmitted: data?.stripe_details_submitted === true,
    },
  };
}

async function stripeForm(
  path: string,
  fields: Record<string, string | number | boolean | null | undefined>,
  idempotencyKey?: string
): Promise<StripeObject> {
  const problem = stripeSecretProblem();
  if (problem) throw new StripeConnectApiError(problem, 503, 'stripe_unavailable');
  const secret = getStripeSecret();
  if (!secret) throw new StripeConnectApiError('Stripe is not configured.', 503, 'stripe_unavailable');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 255);
  const res = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers,
    body: params.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as StripeObject;
  if (!res.ok) {
    const msg = data?.error?.message || `Stripe ${path} failed (${res.status})`;
    throw new StripeConnectApiError(msg, res.status >= 500 ? 502 : 400);
  }
  return data;
}

async function stripeGet(path: string): Promise<StripeObject> {
  const problem = stripeSecretProblem();
  if (problem) throw new StripeConnectApiError(problem, 503, 'stripe_unavailable');
  const secret = getStripeSecret();
  if (!secret) throw new StripeConnectApiError('Stripe is not configured.', 503, 'stripe_unavailable');
  const res = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, '')}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const data = (await res.json().catch(() => ({}))) as StripeObject;
  if (!res.ok) {
    const msg = data?.error?.message || `Stripe ${path} failed (${res.status})`;
    throw new StripeConnectApiError(msg, res.status >= 500 ? 502 : 400);
  }
  return data;
}

function accountFlags(account: StripeObject) {
  return {
    stripe_account_id: normalizeStripeAccountId(account.id),
    stripe_charges_enabled: account.charges_enabled === true,
    stripe_payouts_enabled: account.payouts_enabled === true,
    stripe_details_submitted: account.details_submitted === true,
  };
}

export async function saveOrgStripeAccount(
  orgId: string | number,
  account: StripeObject,
  writer?: SupabaseClient | null
): Promise<{ ok: true } | { ok: false; message: string; schemaReady: boolean }> {
  const client = writer || getSupabaseAdmin();
  const flags = accountFlags(account);
  if (!flags.stripe_account_id) return { ok: false, message: 'Stripe did not return an account id.', schemaReady: true };
  const { error } = await client.from('organizations').update(flags).eq('id', orgId);
  if (error) {
    return {
      ok: false,
      message: isMissingStripeColumn(error)
        ? 'Stripe Connect columns are not on organizations yet. Apply the Stripe Connect migration, then try again.'
        : error.message,
      schemaReady: !isMissingStripeColumn(error),
    };
  }
  return { ok: true };
}

async function findAccountByOrg(orgId: string | number): Promise<string | null> {
  try {
    const query = `metadata['organization_id']:'${String(orgId).replace(/'/g, '')}'`;
    const found = await stripeGet(`accounts/search?query=${encodeURIComponent(query)}&limit=1`);
    const id = found.data?.[0]?.id;
    return normalizeStripeAccountId(id);
  } catch (e) {
    console.warn('[stripe-connect] account search skipped', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function ensureExpressAccount(input: {
  orgId: string | number;
  orgName?: string | null;
  orgType?: string | null;
  email?: string | null;
  existingAccountId?: string | null;
}): Promise<StripeObject> {
  const existing = normalizeStripeAccountId(input.existingAccountId);
  if (existing) return stripeGet(`accounts/${encodeURIComponent(existing)}`);

  const searched = await findAccountByOrg(input.orgId);
  if (searched) return stripeGet(`accounts/${encodeURIComponent(searched)}`);

  const created = await stripeForm(
    'accounts',
    {
      type: 'express',
      country: 'US',
      email: input.email || undefined,
      'capabilities[card_payments][requested]': 'true',
      'capabilities[transfers][requested]': 'true',
      'business_profile[name]': input.orgName || undefined,
      'metadata[organization_id]': String(input.orgId),
      'metadata[organization_type]': input.orgType || undefined,
      'metadata[source]': 'repairplanet_connect',
    },
    `rp-connect-org-${input.orgId}`
  );
  if (!normalizeStripeAccountId(created.id)) {
    throw new StripeConnectApiError('Stripe did not return a connected account id.', 502);
  }
  return created;
}

/** Same origin checkout uses. Production is repairplanet.net; previews keep DEPLOY_PRIME_URL. */
export function connectSiteOrigin(req?: Parameters<typeof publicSiteOrigin>[0]): string {
  return publicSiteOrigin(req);
}

export function connectLinkUrls(origin: string, state: string): { refresh: string; returnTo: string } {
  const base = (origin || connectSiteOrigin()).replace(/\/$/, '');
  return {
    refresh: `${base}/api/billing/stripe/connect/refresh?state=${encodeURIComponent(state)}`,
    returnTo: `${base}/api/billing/stripe/connect/return?state=${encodeURIComponent(state)}`,
  };
}

export async function createOnboardingLink(input: {
  accountId: string;
  orgId: string | number;
  userId: string;
  next: string;
  origin: string;
}): Promise<string> {
  const secret = getStripeSecret();
  if (!secret) throw new StripeConnectApiError('Stripe is not configured.', 503, 'stripe_unavailable');
  const state = signConnectState(
    {
      orgId: String(input.orgId),
      accountId: input.accountId,
      userId: input.userId,
      next: safeConnectNext(input.next),
    },
    secret
  );
  const urls = connectLinkUrls(input.origin || connectSiteOrigin(), state);
  const link = await stripeForm('account_links', {
    account: input.accountId,
    refresh_url: urls.refresh,
    return_url: urls.returnTo,
    type: 'account_onboarding',
  });
  if (!link.url) throw new StripeConnectApiError('Stripe did not return an onboarding link.', 502);
  return String(link.url);
}

export type ConnectCaller = {
  userId: string;
  email: string | null;
  role: string;
  orgId: string | number;
  orgType: string | null;
  orgName: string | null;
  orgEmail: string | null;
  account: PayoutAccount;
  schemaReady: boolean;
};

export async function loadConnectCaller(input: {
  userId: string;
  email?: string | null;
  profile: {
    role?: string | null;
    organization_id?: string | number | null;
    active_organization_id?: string | number | null;
  } | null;
}): Promise<ConnectCaller | { error: string; status: number; code: string }> {
  const orgId = input.profile?.organization_id ?? input.profile?.active_organization_id ?? null;
  if (orgId == null) {
    return {
      error: 'Finish organization setup before connecting Stripe.',
      status: 400,
      code: 'missing_org',
    };
  }
  if (!hasServiceRole()) {
    return { error: 'Service role is required to check Stripe Connect.', status: 503, code: 'stripe_unavailable' };
  }
  const admin = getSupabaseAdmin();
  let role = String(input.profile?.role || '');
  try {
    const { data: membership } = await admin
      .from('organization_memberships')
      .select('role')
      .eq('user_id', input.userId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (membership?.role) role = String(membership.role);
  } catch {
    /* profile role is enough when memberships are unavailable */
  }
  const { data: org, error } = await admin.from('organizations').select(ORG_STRIPE_SELECT).eq('id', orgId).maybeSingle();
  if (error && isMissingStripeColumn(error)) {
    const { data: basic } = await admin.from('organizations').select('id, type, name, email').eq('id', orgId).maybeSingle();
    return {
      userId: input.userId,
      email: input.email || null,
      role,
      orgId,
      orgType: basic?.type ? String(basic.type) : null,
      orgName: basic?.name ? String(basic.name) : null,
      orgEmail: basic?.email ? String(basic.email) : null,
      account: emptyPayoutAccount(),
      schemaReady: false,
    };
  }
  if (error || !org) {
    return { error: error?.message || 'Organization not found.', status: error ? 500 : 404, code: 'missing_org' };
  }
  return {
    userId: input.userId,
    email: input.email || null,
    role,
    orgId,
    orgType: org.type ? String(org.type) : null,
    orgName: org.name ? String(org.name) : null,
    orgEmail: org.email ? String(org.email) : null,
    account: {
      accountId: normalizeStripeAccountId(org.stripe_account_id),
      chargesEnabled: org.stripe_charges_enabled === true,
      payoutsEnabled: org.stripe_payouts_enabled === true,
      detailsSubmitted: org.stripe_details_submitted === true,
    },
    schemaReady: true,
  };
}

export function connectStatusPayload(caller: ConnectCaller) {
  const canStartRole = canStartStripeConnect(caller.role, caller.orgType);
  const partnerUrl = partnerReferralFromEnv();
  if (!canStartRole) {
    return {
      eligible: false,
      connected: false,
      schemaReady: caller.schemaReady,
      canStart: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      prompt: null as StripeConnectPrompt | null,
    };
  }
  if (!caller.schemaReady) {
    const prompt = sellerConnectPrompt({
      partnerUrl,
      hasAccount: false,
      chargesEnabled: false,
    });
    prompt.title = 'Card payments need a database update';
    prompt.message =
      'Stripe Connect columns are not on organizations yet. Card payments still use the platform Stripe account until Connect is enforced. Apply the migration before starting Connect onboarding.';
    return {
      eligible: true,
      connected: false,
      schemaReady: false,
      canStart: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      hasAccount: false,
      prompt,
    };
  }
  const connected = Boolean(caller.account.accountId && caller.account.chargesEnabled);
  return {
    eligible: true,
    connected,
    schemaReady: true,
    canStart: canStartStripeConnect(caller.role, caller.orgType),
    chargesEnabled: caller.account.chargesEnabled,
    payoutsEnabled: caller.account.payoutsEnabled,
    detailsSubmitted: caller.account.detailsSubmitted,
    hasAccount: Boolean(caller.account.accountId),
    prompt: connected
      ? null
      : sellerConnectPrompt({
          partnerUrl,
          hasAccount: Boolean(caller.account.accountId),
          chargesEnabled: false,
        }),
  };
}

export async function syncConnectedAccount(
  writer: SupabaseClient,
  account: {
    id?: unknown;
    charges_enabled?: unknown;
    payouts_enabled?: unknown;
    details_submitted?: unknown;
  } | null | undefined
): Promise<{ updated: boolean; reason?: string }> {
  const id = normalizeStripeAccountId(account?.id);
  if (!id || !account) return { updated: false, reason: 'missing_account' };
  const flags = accountFlags(account as StripeObject);
  delete (flags as { stripe_account_id?: string | null }).stripe_account_id;
  const { data, error } = await writer
    .from('organizations')
    .update(flags)
    .eq('stripe_account_id', id)
    .select('id');
  if (error) {
    console.warn('[stripe-connect] account.updated', error.message);
    return { updated: false, reason: error.message };
  }
  if (!data?.length) return { updated: false, reason: 'unknown_account' };
  return { updated: true };
}

export function readConnectState(token: string | null | undefined) {
  const secret = getStripeSecret();
  if (!secret) return null;
  return verifyConnectState(String(token || ''), secret);
}

function assertConnectActor(
  state: { orgId: string; userId?: string | null },
  actor: ConnectCallbackActor | null | undefined
) {
  const allowed = authorizeConnectCallback(state, actor);
  if (!allowed.ok) {
    throw new StripeConnectApiError(
      'Sign in as a company admin of this organization to finish Stripe setup.',
      403,
      'forbidden'
    );
  }
}

export async function refreshOnboardingFromState(
  stateToken: string,
  origin: string,
  actor: ConnectCallbackActor | null
): Promise<string> {
  const state = readConnectState(stateToken);
  if (!state) throw new StripeConnectApiError('This Stripe setup link expired. Start again from the app.', 400);
  assertConnectActor(state, actor);
  const loaded = await loadSellerPayoutAccount(state.orgId);
  if (loaded.account.accountId && loaded.account.accountId !== state.accountId) {
    throw new StripeConnectApiError('This Stripe account does not match the organization.', 409);
  }
  return createOnboardingLink({
    accountId: state.accountId,
    orgId: state.orgId,
    userId: state.userId || actor!.userId,
    next: state.next,
    origin,
  });
}

export async function completeOnboardingReturn(
  stateToken: string,
  actor: ConnectCallbackActor | null,
  writer?: SupabaseClient | null
): Promise<{ next: string; connected: boolean }> {
  const state = readConnectState(stateToken);
  if (!state) throw new StripeConnectApiError('This Stripe setup link expired. Start again from the app.', 400);
  assertConnectActor(state, actor);
  const account = await stripeGet(`accounts/${encodeURIComponent(state.accountId)}`);
  const saved = await saveOrgStripeAccount(state.orgId, account, writer);
  if (!saved.ok) throw new StripeConnectApiError(saved.message, saved.schemaReady ? 500 : 503);
  const flags = accountFlags(account);
  return { next: state.next, connected: flags.stripe_charges_enabled === true };
}
