/**
 * Microsoft Graph (Mail.Send + offline_access) and Gmail (gmail.send) OAuth + send.
 * Server-only. Tokens never leave the server and are never logged.
 */
import type { MailboxProvider } from './flags.ts';

type Fetch = typeof fetch;
type Creds = { clientId: string; clientSecret: string; tenant: string };

export const PROVIDER_SCOPES: Record<MailboxProvider, string> = {
  // openid/email/profile/User.Read only to learn which address was connected.
  microsoft: 'offline_access openid email profile https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send',
  google: 'openid email https://www.googleapis.com/auth/gmail.send',
};

export function authorizeUrl(provider: MailboxProvider, creds: Creds, redirectUri: string, state: string, loginHint?: string): string {
  if (provider === 'microsoft') {
    const u = new URL(`https://login.microsoftonline.com/${encodeURIComponent(creds.tenant)}/oauth2/v2.0/authorize`);
    u.searchParams.set('client_id', creds.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_mode', 'query');
    u.searchParams.set('scope', PROVIDER_SCOPES.microsoft);
    u.searchParams.set('state', state);
    u.searchParams.set('prompt', 'select_account');
    if (loginHint) u.searchParams.set('login_hint', loginHint);
    return u.toString();
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', creds.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', PROVIDER_SCOPES.google);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false');
  u.searchParams.set('state', state);
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

function tokenEndpoint(provider: MailboxProvider, creds: Creds): string {
  return provider === 'microsoft'
    ? `https://login.microsoftonline.com/${encodeURIComponent(creds.tenant)}/oauth2/v2.0/token`
    : 'https://oauth2.googleapis.com/token';
}

export type TokenResult = { accessToken: string; refreshToken: string | null; scope: string | null };

async function postToken(provider: MailboxProvider, creds: Creds, form: Record<string, string>, fetchImpl: Fetch): Promise<TokenResult> {
  const body = new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...form });
  const r = await fetchImpl(tokenEndpoint(provider, creds), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || typeof j.access_token !== 'string') {
    // Only the provider's error code, never the body (it can echo tokens).
    throw new Error(`token_${String(j.error || r.status)}`);
  }
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : null,
    scope: typeof j.scope === 'string' ? j.scope : null,
  };
}

export function exchangeCode(provider: MailboxProvider, creds: Creds, code: string, redirectUri: string, fetchImpl: Fetch = fetch) {
  return postToken(provider, creds, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, fetchImpl);
}

export function refreshAccess(provider: MailboxProvider, creds: Creds, refreshToken: string, fetchImpl: Fetch = fetch) {
  const form: Record<string, string> = { grant_type: 'refresh_token', refresh_token: refreshToken };
  if (provider === 'microsoft') form.scope = PROVIDER_SCOPES.microsoft;
  return postToken(provider, creds, form, fetchImpl);
}

/** The mailbox address the user actually connected. */
export async function mailboxAddress(provider: MailboxProvider, accessToken: string, fetchImpl: Fetch = fetch): Promise<string> {
  if (provider === 'microsoft') {
    const r = await fetchImpl('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const j = (await r.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
    if (!r.ok) throw new Error(`profile_${r.status}`);
    return String(j.mail || j.userPrincipalName || '').trim();
  }
  const r = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = (await r.json().catch(() => ({}))) as { emailAddress?: string };
  if (!r.ok) throw new Error(`profile_${r.status}`);
  return String(j.emailAddress || '').trim();
}

/** Google supports token revocation. Microsoft has no per-refresh-token revoke endpoint. */
export async function revokeAtProvider(provider: MailboxProvider, refreshToken: string, fetchImpl: Fetch = fetch): Promise<'revoked' | 'not_supported' | 'failed'> {
  if (provider !== 'google') return 'not_supported';
  try {
    const r = await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    return r.ok ? 'revoked' : 'failed';
  } catch {
    return 'failed';
  }
}

export type OutgoingEmail = { to: string; subject: string; text: string; html: string; replyTo?: string };

function headerSafe(v: string): string {
  return String(v || '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeaderWord(v: string): string {
  const s = headerSafe(v);
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

/** RFC 5322 multipart/alternative message for Gmail users.messages.send. */
export function buildMime(from: string, msg: OutgoingEmail, boundary = `rp_${Date.now().toString(36)}`): string {
  const lines = [
    `From: ${headerSafe(from)}`,
    `To: ${headerSafe(msg.to)}`,
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(msg.text, 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(msg.html, 'utf8').toString('base64'),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

export async function sendViaProvider(
  provider: MailboxProvider,
  accessToken: string,
  fromAddress: string,
  msg: OutgoingEmail,
  fetchImpl: Fetch = fetch
): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  if (provider === 'microsoft') {
    const r = await fetchImpl('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: headerSafe(msg.subject),
          body: { contentType: 'HTML', content: msg.html },
          toRecipients: [{ emailAddress: { address: msg.to } }],
        },
        saveToSentItems: true,
      }),
    });
    // Graph returns 202 with no id.
    return r.ok ? { ok: true, id: r.headers.get('request-id'), error: null } : { ok: false, id: null, error: `graph_${r.status}` };
  }
  const raw = Buffer.from(buildMime(fromAddress, msg), 'utf8').toString('base64url');
  const r = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string };
  return r.ok ? { ok: true, id: j.id || null, error: null } : { ok: false, id: null, error: `gmail_${r.status}` };
}

export async function sendViaResend(
  apiKey: string,
  fromHeader: string,
  replyTo: string,
  msg: OutgoingEmail,
  fetchImpl: Fetch = fetch
): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  const r = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromHeader, to: [msg.to], reply_to: replyTo, subject: headerSafe(msg.subject), html: msg.html, text: msg.text }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string };
  return r.ok ? { ok: true, id: j.id || null, error: null } : { ok: false, id: null, error: `resend_${r.status}` };
}
