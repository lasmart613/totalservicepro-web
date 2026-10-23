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
import {
  canManageDomain,
  domainsApiKey,
  loadOrgDomain,
  ownDomainEnabled,
  ownDomainSender,
  POLL_MIN_SECONDS,
  publicDomain,
  resendDomains,
  validateSendingDomain,
  type OrgDomainRow,
} from './domains.ts';
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
  const orgDomain = ownDomainEnabled(d.env) ? await loadOrgDomain(admin, u.orgId) : null;
  const ownDomainInfo = orgDomain
    ? { domain: orgDomain.domain_name, status: orgDomain.status, sendsAs: ownDomainSender(ownAddresses(u), orgDomain) || null }
    : null;
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
      ownDomain: ownDomainInfo,
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
  const orgDomain = !conn && ownDomainEnabled(d.env) && String(d.env.RESEND_API_KEY || '').trim() ? await loadOrgDomain(admin, u.orgId) : null;
  const domainFrom = conn ? '' : ownDomainSender(own, orgDomain);
  const transport: MailboxProvider | 'resend' | 'resend_domain' = conn ? conn.provider : domainFrom ? 'resend_domain' : 'resend';
  if (!conn && !domainFrom && !fallbackEnabled(d.env)) {
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
    p_sender_email: conn ? lc(conn.email) : domainFrom || senderEmail,
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
    } else if (domainFrom) {
      sent = await sendViaResend(
        String(d.env.RESEND_API_KEY || ''),
        ownDomainFromHeader(u.name, domainFrom),
        domainFrom,
        { to, subject, text, html: textToHtml(text) },
        d.fetchImpl
      );
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
  return { status: 200, body: { ok: true, transport, id: r.id, from: transport === 'resend' ? `${u.name} via RepairPlanet` : transport === 'resend_domain' ? domainFrom : conn!.email, replyTo: domainFrom || senderEmail } };
}

/** From header for a verified own domain: "<Name>" <user@theirdomain>. */
export function ownDomainFromHeader(userName: string, address: string): string {
  const name = String(userName || '').replace(/["<>\r\n\\]/g, '').trim().slice(0, 80);
  return name ? `"${name}" <${address}>` : address;
}

// ---- Send from your own domain (000941) ----

async function requireDomainManager(token: string, d: ReturnType<typeof ctxDeps>, manage: boolean): Promise<{ u: UserCtx; admin: Db; canManage: boolean } | Result> {
  const u = await requireUser(token, d);
  if (isResult(u)) return u;
  if (!ownDomainEnabled(d.env)) return { status: 404, body: { error: 'Sending from your own domain is not turned on yet.', code: 'domain_disabled' } };
  const admin = d.admin();
  const canManage = await canManageDomain(admin, u.userId, u.orgId);
  if (manage && !canManage) return { status: 403, body: { error: 'Only an owner or admin can manage the sending domain.', code: 'not_admin' } };
  return { u, admin, canManage };
}

function domainBody(row: OrgDomainRow | null, canManage: boolean, u: UserCtx, extra: Json = {}): Json {
  return { enabled: true, canManage, domain: publicDomain(row), sendsAs: ownDomainSender(ownAddresses(u), row) || null, ...extra };
}

async function saveRemote(admin: Db, orgId: number, remote: { status: string; records: unknown[]; region: string | null }): Promise<void> {
  await admin
    .from('org_sending_domains')
    .update({ status: remote.status, records: remote.records, region: remote.region, checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('organization_id', orgId);
}

/** GET domain status. refresh=true polls Resend (GET /domains/{id}) at most once per POLL_MIN_SECONDS per org. */
export async function handleDomainStatus(token: string, refresh: boolean, deps: Deps = {}): Promise<Result> {
  const d = ctxDeps(deps);
  const g = await requireDomainManager(token, d, false);
  if (isResult(g)) return g.body.code === 'domain_disabled' || g.body.code === 'disabled' ? { status: 200, body: { enabled: false } } : g;
  let row = await loadOrgDomain(g.admin, g.u.orgId);
  if (row && refresh && row.status !== 'verified') {
    const age = row.checked_at ? (Date.now() - Date.parse(row.checked_at)) / 1000 : Infinity;
    if (age >= POLL_MIN_SECONDS) {
      const r = await resendDomains.get(domainsApiKey(d.env), row.resend_domain_id, d.fetchImpl);
      if (r.ok) {
        await saveRemote(g.admin, g.u.orgId, r.data);
        row = { ...row, status: r.data.status, records: r.data.records, region: r.data.region, checked_at: new Date().toISOString() };
      }
    }
  }
  return { status: 200, body: domainBody(row, g.canManage, g.u) };
}

/** POST create: { domain }. One domain per org; owner/company_admin/admin only. */
export async function handleDomainCreate(token: string, body: Json, deps: Deps = {}): Promise<Result> {
  const d = ctxDeps(deps);
  const g = await requireDomainManager(token, d, true);
  if (isResult(g)) return g;
  const v = validateSendingDomain(body.domain, g.u.orgId, d.env);
  if (!v.ok) return { status: 400, body: { error: v.error, code: v.code } };
  if (await loadOrgDomain(g.admin, g.u.orgId)) {
    return { status: 409, body: { error: 'Your organization already has a sending domain. Remove it first.', code: 'domain_exists' } };
  }
  const { data: taken } = await g.admin.from('org_sending_domains').select('organization_id').eq('domain_name', v.domain).maybeSingle();
  if (taken) return { status: 409, body: { error: 'This domain is already set up by another organization.', code: 'domain_taken' } };
  const key = domainsApiKey(d.env);
  const r = await resendDomains.create(key, v.domain, d.fetchImpl);
  if (!r.ok || !r.data.id) {
    const code = r.ok ? 'resend_bad_response' : r.status === 403 || r.status === 422 || r.status === 409 ? 'resend_refused' : 'resend_unavailable';
    return { status: r.ok ? 502 : r.status === 0 || r.status >= 500 ? 503 : 400, body: { error: 'The domain could not be added. Check the name and try again.', code } };
  }
  const row = {
    organization_id: g.u.orgId,
    resend_domain_id: r.data.id,
    domain_name: v.domain,
    status: r.data.status,
    region: r.data.region,
    records: r.data.records,
    created_by: g.u.userId,
    checked_at: new Date().toISOString(),
  };
  const { error } = await g.admin.from('org_sending_domains').insert(row);
  if (error) {
    // Do not leave an orphan in the Resend account.
    await resendDomains.remove(key, r.data.id, d.fetchImpl);
    return { status: 503, body: { error: 'The domain could not be saved. Nothing was added.', code: 'save_failed' } };
  }
  return { status: 200, body: domainBody({ ...row, records: r.data.records } as OrgDomainRow, true, g.u) };
}

/** POST verify: DB rate limit (1/30s, 10/hour per org), then POST /domains/{id}/verify and GET /domains/{id}. */
export async function handleDomainVerify(token: string, deps: Deps = {}): Promise<Result> {
  const d = ctxDeps(deps);
  const g = await requireDomainManager(token, d, true);
  if (isResult(g)) return g;
  const { data: claim, error } = await g.admin.rpc('org_sending_domain_claim_verify', { p_org: g.u.orgId });
  if (error) return { status: 503, body: { error: 'Verify is not available right now.', code: 'unavailable' } };
  const c = (claim || {}) as { ok?: boolean; code?: string; retry_after?: number; resend_domain_id?: string };
  if (c.ok !== true || !c.resend_domain_id) {
    if (c.code === 'not_found') return { status: 404, body: { error: 'Add a domain first.', code: 'not_found' } };
    return { status: 429, body: { error: 'Please wait before checking again.', code: c.code || 'rate_limited', retryAfter: c.retry_after ?? 30 } };
  }
  const key = domainsApiKey(d.env);
  const v = await resendDomains.verify(key, c.resend_domain_id, d.fetchImpl);
  if (!v.ok) return { status: v.status === 0 || v.status >= 500 ? 503 : 400, body: { error: 'Resend could not start verification. Try again shortly.', code: 'resend_verify_failed' } };
  let row = await loadOrgDomain(g.admin, g.u.orgId);
  const r = await resendDomains.get(key, c.resend_domain_id, d.fetchImpl);
  if (r.ok && row) {
    await saveRemote(g.admin, g.u.orgId, r.data);
    row = { ...row, status: r.data.status, records: r.data.records, region: r.data.region, checked_at: new Date().toISOString() };
  }
  return { status: 200, body: domainBody(row, true, g.u, { verifyStarted: true }) };
}

/** DELETE: removes the domain from Resend (DELETE /domains/{id}) and the org row. */
export async function handleDomainRemove(token: string, deps: Deps = {}): Promise<Result> {
  const d = ctxDeps(deps);
  const g = await requireDomainManager(token, d, true);
  if (isResult(g)) return g;
  const row = await loadOrgDomain(g.admin, g.u.orgId);
  if (!row) return { status: 200, body: domainBody(null, true, g.u, { removed: 'none' }) };
  const r = await resendDomains.remove(domainsApiKey(d.env), row.resend_domain_id, d.fetchImpl);
  if (!r.ok && r.status !== 404) return { status: 503, body: { error: 'Could not remove the domain from Resend. Try again.', code: 'resend_delete_failed' } };
  const { error } = await g.admin.from('org_sending_domains').delete().eq('organization_id', g.u.orgId);
  if (error) return { status: 503, body: { error: 'Could not remove the domain. Try again.', code: 'save_failed' } };
  return { status: 200, body: domainBody(null, true, g.u, { removed: 'ok' }) };
}
