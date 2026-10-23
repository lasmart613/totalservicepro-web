/**
 * Server handlers for /api/crm-email/* (CRM > customer > Send email).
 * Every route: bearer-auth (Supabase), CRM_EMAIL_ENABLED, caller's org. The
 * mailbox table and the rate-cap RPCs are service_role only (000940).
 * Tokens and secrets are never returned or logged.
 */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchDirectoryContactSources, hydrateDirectoryContacts, isValidContactEmail } from '../customer-contacts.ts';
import {
  crmEmailEnabled,
  fallbackEnabled,
  fallbackFromAddress,
  fallbackFromHeader,
  mailboxTokenKey,
  MAILBOX_PROVIDERS,
  providerCredentials,
  providerEnabled,
  RATE_CAP_DAY,
  RATE_CAP_HOUR,
  type MailboxProvider,
} from './flags.ts';
import { decryptToken, encryptToken, signState, verifyState } from './token-crypto.ts';
import {
  authorizeUrl,
  exchangeCode,
  mailboxAddress,
  refreshAccess,
  revokeAtProvider,
  sendViaProvider,
  sendViaResend,
} from './providers.ts';
import { fallbackFooter, MAX_BODY, MAX_SUBJECT, parseAudience, textToHtml } from './templates.ts';

export const STATE_COOKIE = 'rp_mbx_state';

export type Json = Record<string, unknown>;
export type Result = { status: number; body: Json; setCookie?: string; redirect?: string };

type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

export type UserCtx = {
  userId: string;
  loginEmail: string;
  profileEmail: string;
  name: string;
  orgId: number;
  orgName: string;
  userDb: Db;
};

export type Deps = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  admin?: () => Db;
  authUser?: (token: string) => Promise<UserCtx | null>;
};

const lc = (s: unknown) => String(s || '').trim().toLowerCase();

export function bearer(h: string | null): string {
  return String(h || '').replace(/^Bearer\s+/i, '').trim();
}

function defaultAdmin(env: Record<string, string | undefined>): Db {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('service role not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function defaultAuthUser(token: string, env: Record<string, string | undefined> = process.env): Promise<UserCtx | null> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !anon || !token) return null;
  const db = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: prof } = await db
    .from('user_profiles')
    .select('organization_id, first_name, last_name, email')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!prof?.organization_id) return null;
  const { data: org } = await db.from('organizations').select('id, name').eq('id', prof.organization_id).maybeSingle();
  return {
    userId: data.user.id,
    loginEmail: String(data.user.email || ''),
    profileEmail: String(prof.email || ''),
    name: [prof.first_name, prof.last_name].filter(Boolean).join(' ').trim(),
    orgId: Number(prof.organization_id),
    orgName: String(org?.name || ''),
    userDb: db,
  };
}

function ctxDeps(deps: Deps) {
  const env = deps.env ?? process.env;
  return {
    env,
    fetchImpl: deps.fetchImpl ?? fetch,
    admin: deps.admin ?? (() => defaultAdmin(env)),
    authUser: deps.authUser ?? ((t: string) => defaultAuthUser(t, env)),
  };
}

/** Business address(es) the user may send as. */
export function ownAddresses(u: Pick<UserCtx, 'loginEmail' | 'profileEmail'>): string[] {
  return [...new Set([lc(u.loginEmail), lc(u.profileEmail)].filter((e) => isValidContactEmail(e)))];
}

/** Emails on file for the customer (office email, CRM role contacts, contact rows). */
export async function customerRecipients(db: Db, customerOrgId: number): Promise<string[]> {
  const src = await fetchDirectoryContactSources(db as unknown as { from: (t: string) => any }, customerOrgId);
  const out = new Set<string>();
  if (isValidContactEmail(src.officeEmail)) out.add(lc(src.officeEmail));
  const state = hydrateDirectoryContacts({ directoryContacts: src.directoryContacts, contactRows: src.contactRows });
  for (const r of Object.values(state.roles)) if (isValidContactEmail(r?.email)) out.add(lc(r.email));
  for (const r of src.contactRows || []) if (isValidContactEmail(r.email)) out.add(lc(r.email));
  return [...out];
}

async function isCustomer(db: Db, serviceOrg: number, customerOrg: number): Promise<boolean> {
  const { data } = await db
    .from('organization_customers')
    .select('customer_organization_id')
    .eq('service_organization_id', serviceOrg)
    .eq('customer_organization_id', customerOrg)
    .maybeSingle();
  return Boolean(data);
}

type Conn = { provider: MailboxProvider; email: string; refresh_token_enc: string };

async function loadConnections(admin: Db, userId: string): Promise<Conn[]> {
  const { data, error } = await admin
    .from('user_mailbox_connections')
    .select('provider, email, refresh_token_enc')
    .eq('user_id', userId);
  if (error) return [];
  return (data || []) as Conn[];
}

async function requireUser(token: string, d: ReturnType<typeof ctxDeps>): Promise<UserCtx | Result> {
  if (!crmEmailEnabled(d.env)) return { status: 404, body: { error: 'Customer email is not turned on yet.', code: 'disabled' } };
  if (!token) return { status: 401, body: { error: 'Sign in required' } };
  const u = await d.authUser(token);
  if (!u) return { status: 401, body: { error: 'Invalid session or no organization' } };
  return u;
}
const isResult = (x: unknown): x is Result => Boolean(x && typeof x === 'object' && 'status' in (x as Json) && 'body' in (x as Json));

/** GET status: flags, connected mailboxes (provider + address only), usage, recipients for a customer. */
export async function handleStatus(token: string, customerOrgId: number | null, deps: Deps = {}): Promise<Result> {
  const d = ctxDeps(deps);
  const u = await requireUser(token, d);
  if (isResult(u)) return u.body.code === 'disabled' ? { status: 200, body: { enabled: false } } : u;
  const admin = d.admin();
  const conns = await loadConnections(admin, u.userId);
  let recipients: string[] = [];
  if (customerOrgId != null) {
    if (!(await isCustomer(u.userDb, u.orgId, customerOrgId))) return { status: 403, body: { error: 'Customer is not in your directory' } };
    recipients = await customerRecipients(u.userDb, customerOrgId);
  }
  const since = new Date(Date.now() - 86400000).toISOString();
  const { data: recent } = await admin
    .from('customer_email_sends')
    .select('created_at, status')
    .eq('sender_user_id', u.userId)
    .gt('created_at', since);
  const live = ((recent || []) as { created_at: string; status: string }[]).filter((r) => r.status !== 'failed');
  const hourAgo = Date.now() - 3600000;
  return {
    status: 200,
    body: {
      enabled: true,
      providers: MAILBOX_PROVIDERS.filter((p) => providerEnabled(p, d.env)),
      connections: conns.map((c) => ({ provider: c.provider, email: c.email })),
      fallback: fallbackEnabled(d.env),
      senderName: u.name,
      senderEmail: ownAddresses(u)[0] || '',
      recipients,
      usage: {
        hour: live.filter((r) => Date.parse(r.created_at) > hourAgo).length,
        day: live.length,
        hourCap: RATE_CAP_HOUR,
        dayCap: RATE_CAP_DAY,
      },
    },
  };
}

/** POST connect: returns the provider authorize URL and sets a nonce cookie bound to this browser. */
export async function handleConnect(token: string, providerRaw: unknown, origin: string, deps: Deps = {}, returnCustomer: number | null = null): Promise<Result> {
  const d = ctxDeps(deps);
  const u = await requireUser(token, d);
  if (isResult(u)) return u;
  const provider = MAILBOX_PROVIDERS.find((p) => p === providerRaw);
  if (!provider || !providerEnabled(provider, d.env)) return { status: 400, body: { error: 'This mailbox type is not available yet.' } };
  const key = mailboxTokenKey(d.env)!;
  const creds = providerCredentials(provider, d.env)!;
  const nonce = randomBytes(16).toString('base64url');
  const state = signState({ u: u.userId, p: provider, n: nonce, c: returnCustomer, exp: Date.now() + 10 * 60 * 1000 }, key);
  const redirectUri = `${origin.replace(/\/$/, '')}/api/crm-email/oauth/callback`;
  return {
    status: 200,
    body: { url: authorizeUrl(provider, creds, redirectUri, state, ownAddresses(u)[0]) },
    setCookie: `${STATE_COOKIE}=${nonce}; Path=/api/crm-email/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  };
}

/**
 * GET OAuth callback (browser redirect, no bearer). The user comes from the
 * signed state AND the state's nonce must match this browser's cookie, so a
 * forged or replayed callback cannot attach a mailbox to someone else.
 * The connected address must be the user's own business address.
 */
export async function handleCallback(
  params: { code?: string | null; state?: string | null; error?: string | null },
  cookieNonce: string | null,
  origin: string,
  deps: Deps = {}
): Promise<Result> {
  const d = ctxDeps(deps);
  let returnTo = '/customers';
  const back = (code: string) => ({
    status: 302,
    body: {},
    redirect: `${origin.replace(/\/$/, '')}${returnTo}?tab=email&mailbox=${encodeURIComponent(code)}`,
    setCookie: `${STATE_COOKIE}=; Path=/api/crm-email/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  });
  if (!crmEmailEnabled(d.env)) return back('disabled');
  const key = mailboxTokenKey(d.env);
  if (!key) return back('disabled');
    const st = verifyState<{ u: string; p: MailboxProvider; n: string; c?: number | null }>(String(params.state || ''), key);
  if (!st || !cookieNonce || st.n !== cookieNonce) return back('bad_state');
  if (Number.isSafeInteger(st.c) && Number(st.c) > 0) returnTo = `/customers/${Number(st.c)}`;
  if (params.error) return back('denied');
  const provider = st.p;
  const creds = providerCredentials(provider, d.env);
  if (!creds || !params.code) return back('bad_state');
  const redirectUri = `${origin.replace(/\/$/, '')}/api/crm-email/oauth/callback`;
  try {
    const tok = await exchangeCode(provider, creds, params.code, redirectUri, d.fetchImpl);
    if (!tok.refreshToken) return back('no_refresh_token');
    const addr = lc(await mailboxAddress(provider, tok.accessToken, d.fetchImpl));
    const admin = d.admin();
    const { data: prof } = await admin.from('user_profiles').select('email').eq('id', st.u).maybeSingle();
    const { data: authUser } = await (admin as SupabaseClient).auth.admin.getUserById(st.u);
    const own = ownAddresses({ loginEmail: String(authUser?.user?.email || ''), profileEmail: String(prof?.email || '') });
    if (!addr || !own.includes(addr)) {
      await revokeAtProvider(provider, tok.refreshToken, d.fetchImpl);
      return back('wrong_address');
    }
    const { error } = await admin.from('user_mailbox_connections').upsert(
      {
        user_id: st.u,
        provider,
        email: addr,
        refresh_token_enc: encryptToken(tok.refreshToken, key, `${st.u}:${provider}`),
        scopes: tok.scope,
        updated_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: 'user_id,provider' }
    );
    return back(error ? 'save_failed' : 'connected');
  } catch {
    return back('exchange_failed');
  }
}

/** POST disconnect: revoke at the provider where supported, then delete the row. */
export async function handleDisconnect(token: string, providerRaw: unknown, deps: Deps = {}): Promise<Result> {
  const d = ctxDeps(deps);
  const u = await requireUser(token, d);
  if (isResult(u)) return u;
  const provider = MAILBOX_PROVIDERS.find((p) => p === providerRaw);
  if (!provider) return { status: 400, body: { error: 'Unknown mailbox type' } };
  const admin = d.admin();
  const conn = (await loadConnections(admin, u.userId)).find((c) => c.provider === provider);
  if (!conn) return { status: 200, body: { ok: true, revoked: 'none' } };
  let revoked: string = 'not_supported';
  const key = mailboxTokenKey(d.env);
  if (key) {
    try {
      revoked = await revokeAtProvider(provider, decryptToken(conn.refresh_token_enc, key, `${u.userId}:${provider}`), d.fetchImpl);
    } catch {
      revoked = 'failed';
    }
  }
  const { error } = await admin.from('user_mailbox_connections').delete().eq('user_id', u.userId).eq('provider', provider);
  if (error) return { status: 503, body: { error: 'Could not disconnect. Try again.' } };
  return { status: 200, body: { ok: true, revoked } };
}

const RESERVE_ERRORS: Record<string, { status: number; error: string }> = {
  not_member: { status: 403, error: 'You are not a member of this organization.' },
  not_customer: { status: 403, error: 'Customer is not in your directory' },
  rate_limited_hour: { status: 429, error: `You can send ${RATE_CAP_HOUR} customer emails per hour. Try again later.` },
  rate_limited_day: { status: 429, error: `You can send ${RATE_CAP_DAY} customer emails per day. Try again tomorrow.` },
  invalid_request: { status: 400, error: 'Invalid request' },
};

/** POST send. */
export async function handleSend(token: string, body: Json, deps: Deps = {}): Promise<Result> {
  const d = ctxDeps(deps);
  const u = await requireUser(token, d);
  if (isResult(u)) return u;
  const customerOrg = Number(body.customer_organization_id);
  const to = lc(body.to);
  const subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').trim();
  const text = String(body.body || '').trim();
  const audience = parseAudience(body.audience) ?? 'custom';
  if (!Number.isSafeInteger(customerOrg) || customerOrg <= 0) return { status: 400, body: { error: 'customer_organization_id is required' } };
  if (!subject || subject.length > MAX_SUBJECT) return { status: 400, body: { error: 'Subject is required (200 characters max).' } };
  if (!text || text.length > MAX_BODY) return { status: 400, body: { error: 'Message is required (10,000 characters max).' } };
  if (!(await isCustomer(u.userDb, u.orgId, customerOrg))) return { status: 403, body: { error: 'Customer is not in your directory' } };
  const allowed = await customerRecipients(u.userDb, customerOrg);
  if (!isValidContactEmail(to) || !allowed.includes(to)) {
    return { status: 400, body: { error: 'Pick an email address on file for this customer.', code: 'recipient_not_on_file' } };
  }
  const own = ownAddresses(u);
  const senderEmail = own[0] || '';
  if (!senderEmail) return { status: 400, body: { error: 'Add your email to your profile first.' } };

  const admin = d.admin();
  const key = mailboxTokenKey(d.env);
  const conns = (await loadConnections(admin, u.userId)).filter((c) => providerEnabled(c.provider, d.env) && own.includes(lc(c.email)));
  const conn = conns.find((c) => c.provider === 'microsoft') || conns.find((c) => c.provider === 'google') || null;
  const transport: MailboxProvider | 'resend' = conn ? conn.provider : 'resend';
  if (!conn && !fallbackEnabled(d.env)) {
    return { status: 409, body: { error: 'Connect your mailbox to send.', code: 'no_transport' } };
  }

  const { data: res, error: resErr } = await admin.rpc('customer_email_reserve_send', {
    p_sender: u.userId,
    p_service_org: u.orgId,
    p_customer_org: customerOrg,
    p_recipient: to,
    p_subject: subject,
    p_audience: audience,
    p_transport: transport,
    p_sender_name: u.name,
    p_sender_email: conn ? lc(conn.email) : senderEmail,
  });
  if (resErr) return { status: 503, body: { error: 'Email is not available right now. Nothing was sent.' } };
  const r = (res || {}) as { ok?: boolean; code?: string; id?: number };
  if (r.ok !== true || !r.id) {
    const e = RESERVE_ERRORS[String(r.code)] ?? { status: 403, error: 'Email was not sent.' };
    return { status: e.status, body: { error: e.error, code: r.code } };
  }

  let sent: { ok: boolean; id: string | null; error: string | null };
  try {
    if (conn && key) {
      const creds = providerCredentials(conn.provider, d.env)!;
      const refresh = decryptToken(conn.refresh_token_enc, key, `${u.userId}:${conn.provider}`);
      const tok = await refreshAccess(conn.provider, creds, refresh, d.fetchImpl);
      if (tok.refreshToken && tok.refreshToken !== refresh) {
        await admin
          .from('user_mailbox_connections')
          .update({ refresh_token_enc: encryptToken(tok.refreshToken, key, `${u.userId}:${conn.provider}`), updated_at: new Date().toISOString() })
          .eq('user_id', u.userId)
          .eq('provider', conn.provider);
      }
      sent = await sendViaProvider(conn.provider, tok.accessToken, conn.email, { to, subject, text, html: textToHtml(text) }, d.fetchImpl);
      await admin
        .from('user_mailbox_connections')
        .update(sent.ok ? { last_used_at: new Date().toISOString(), last_error: null } : { last_error: sent.error })
        .eq('user_id', u.userId)
        .eq('provider', conn.provider);
    } else {
      const footer = fallbackFooter(u.name, senderEmail);
      sent = await sendViaResend(
        String(d.env.RESEND_API_KEY || ''),
        fallbackFromHeader(u.name, fallbackFromAddress(d.env)),
        senderEmail,
        { to, subject, text: `${text}\n\n--\n${footer}`, html: textToHtml(text, footer) },
        d.fetchImpl
      );
    }
  } catch (e) {
    sent = { ok: false, id: null, error: String((e as Error)?.message || 'send_failed').slice(0, 80) };
  }
  await admin.rpc('customer_email_finish_send', {
    p_id: r.id,
    p_status: sent.ok ? 'sent' : 'failed',
    p_provider_message_id: sent.id,
    p_error: sent.error,
  });
  if (!sent.ok) {
    return { status: 502, body: { error: 'The email could not be sent. Check your mailbox connection and try again.', code: sent.error, transport } };
  }
  return { status: 200, body: { ok: true, transport, id: r.id, from: transport === 'resend' ? `${u.name} via RepairPlanet` : conn!.email, replyTo: senderEmail } };
}
