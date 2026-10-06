import { LEGAL_CONSENT_STAMP_FROM, LEGAL_VERSION, consentAccepted } from './consent.ts';

/** First Google return only. A later sign-in is not a fresh agreement. */
const GOOGLE_FIRST_SIGN_IN_MS = 15 * 60 * 1000;

export type ConsentWriteOutcome = {
  stored: boolean;
  continued: boolean;
  missingColumn?: boolean;
};

export type SignupUser = {
  id: string;
  email?: string | null;
  identities?: unknown[] | null;
};

export type SignupSession = {
  access_token: string;
  refresh_token: string;
} | null;

export type EmailSignupBody = {
  email?: unknown;
  password?: unknown;
  consent?: unknown;
  legalVersion?: unknown;
  emailRedirectTo?: unknown;
  data?: unknown;
};

type SignUpArgs = {
  email: string;
  password: string;
  options: { data: Record<string, unknown>; emailRedirectTo: string };
};

export type EmailSignupDeps = {
  signUp: (args: SignUpArgs) => Promise<{
    user: SignupUser | null;
    session: SignupSession;
    error: { message: string } | null;
  }>;
  writeConsent: (userId: string) => Promise<ConsentWriteOutcome>;
  redirectTo: (raw: string | undefined) => string;
  log?: (message: string, detail?: unknown) => void;
};

export type EmailSignupResult =
  | { ok: false; status: 400; error: 'consent_required' }
  | { ok: false; status: 400; error: string }
  | {
      ok: true;
      user: SignupUser | null;
      session: SignupSession;
      consent: ConsentWriteOutcome | null;
    };

const PRODUCTION_HOSTS = new Set(['repairplanet.net', 'www.repairplanet.net']);

/**
 * Profile rows are inserted by handle_new_auth_user. That trigger does not
 * write consent columns, so team invites still succeed before this migration
 * is applied. Callers reject a missing flag first, create the auth user, then
 * update legal_consent_at / legal_consent_version.
 */
export async function runEmailSignup(body: EmailSignupBody, deps: EmailSignupDeps): Promise<EmailSignupResult> {
  if (!consentAccepted(body)) {
    return { ok: false, status: 400, error: 'consent_required' };
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return { ok: false, status: 400, error: 'Email and password are required.' };
  }

  const clientData =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : {};
  const signed = await deps.signUp({
    email,
    password,
    options: {
      data: {
        ...clientData,
        legal_consent: true,
        legal_consent_version: LEGAL_VERSION,
      },
      emailRedirectTo: deps.redirectTo(
        typeof body.emailRedirectTo === 'string' ? body.emailRedirectTo : undefined,
      ),
    },
  });
  if (signed.error) {
    return { ok: false, status: 400, error: signed.error.message || 'Sign up failed.' };
  }

  const identities = signed.user?.identities;
  const existingEmail = Array.isArray(identities) && identities.length === 0;
  if (!signed.user?.id || existingEmail) {
    return { ok: true, user: signed.user, session: signed.session, consent: null };
  }

  let consent: ConsentWriteOutcome;
  try {
    consent = await deps.writeConsent(signed.user.id);
  } catch (err) {
    deps.log?.('legal consent write failed; signup continues', err);
    consent = { stored: false, continued: true };
  }
  if (consent.missingColumn) {
    deps.log?.('legal consent columns are not on user_profiles yet; signup continues');
  }
  return { ok: true, user: signed.user, session: signed.session, consent };
}

export function planConsentWrite(nowIso: string, version: string = LEGAL_VERSION) {
  return {
    legal_consent_at: nowIso,
    legal_consent_version: version,
  };
}

/** Postgres 42703 or PostgREST schema-cache miss for the consent columns. */
export function isMissingConsentColumn(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  if (!/legal_consent_at|legal_consent_version/.test(message)) return false;
  if (code === '42703' || code === 'PGRST204') return true;
  return /schema cache|does not exist|undefined column|could not find/i.test(message);
}

export async function applyConsentUpdate(
  update: (payload: { legal_consent_at: string; legal_consent_version: string }) => Promise<{
    error: { code?: string; message?: string } | null;
  }>,
  nowIso: string,
  log: (message: string, detail?: unknown) => void = () => {},
): Promise<ConsentWriteOutcome> {
  const payload = planConsentWrite(nowIso, LEGAL_VERSION);
  const { error } = await update(payload);
  if (!error) return { stored: true, continued: true };
  if (isMissingConsentColumn(error)) {
    log('legal consent columns are not on user_profiles yet; signup continues', error);
    return { stored: false, continued: true, missingColumn: true };
  }
  log('legal consent write failed; signup continues', error);
  return { stored: false, continued: true };
}

type ConsentUpdater = {
  from: (table: string) => {
    update: (row: { legal_consent_at: string; legal_consent_version: string }) => {
      eq: (column: string, value: string) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
    };
  };
};

export function writeUserLegalConsent(
  admin: ConsentUpdater,
  userId: string,
  nowIso: string,
  log: (message: string, detail?: unknown) => void = () => {},
): Promise<ConsentWriteOutcome> {
  return applyConsentUpdate(
    (payload) => admin.from('user_profiles').update(payload).eq('id', userId),
    nowIso,
    log,
  );
}

export function isGoogleIdentity(
  user:
    | {
        app_metadata?: { provider?: string; providers?: string[] | null } | null;
        identities?: { provider?: string | null }[] | null;
      }
    | null
    | undefined,
): boolean {
  if (!user) return false;
  if (user.app_metadata?.provider === 'google') return true;
  if (user.app_metadata?.providers?.includes('google')) return true;
  return (user.identities || []).some((row) => row.provider === 'google');
}

/**
 * Silent Google stamp only for a brand-new account: created on or after
 * LEGAL_CONSENT_STAMP_FROM, still inside the first 15 minutes, and no stamp yet.
 * Older Google users are left null. A later sign-in does not overwrite.
 */
export function shouldStampOAuthConsent(input: {
  isGoogle: boolean;
  existingConsentAt: string | null | undefined;
  createdAt: string | null | undefined;
  now: string;
}): boolean {
  if (!input.isGoogle || input.existingConsentAt) return false;
  const created = Date.parse(input.createdAt ?? '');
  const now = Date.parse(input.now);
  const from = Date.parse(LEGAL_CONSENT_STAMP_FROM);
  if (!Number.isFinite(created) || !Number.isFinite(now) || !Number.isFinite(from)) return false;
  if (created < from) return false;
  const age = now - created;
  return age >= 0 && age <= GOOGLE_FIRST_SIGN_IN_MS;
}

function isFreshGoogleAccount(input: {
  createdAt: string | null | undefined;
  now: string;
}): boolean {
  return shouldStampOAuthConsent({
    isGoogle: true,
    existingConsentAt: null,
    createdAt: input.createdAt,
    now: input.now,
  });
}

export async function stampGoogleConsent(input: {
  isGoogle: boolean;
  createdAt: string | null | undefined;
  now: string;
  readConsentAt: () => Promise<{
    at: string | null;
    error: { code?: string; message?: string } | null;
  }>;
  writeConsent: () => Promise<ConsentWriteOutcome>;
  log?: (message: string, detail?: unknown) => void;
}): Promise<{
  recorded: boolean;
  reason?: 'not_google' | 'already_recorded' | 'existing_account';
  missingColumn?: boolean;
  continued?: boolean;
}> {
  if (!input.isGoogle) return { recorded: false, reason: 'not_google' };
  if (!isFreshGoogleAccount({ createdAt: input.createdAt, now: input.now })) {
    return { recorded: false, reason: 'existing_account' };
  }
  let existing: string | null = null;
  try {
    const read = await input.readConsentAt();
    if (read.error) {
      if (isMissingConsentColumn(read.error)) {
        input.log?.('legal consent columns are not on user_profiles yet; signup continues', read.error);
        return { recorded: false, missingColumn: true, continued: true };
      }
      input.log?.('legal consent read failed; signup continues', read.error);
      return { recorded: false, continued: true };
    }
    existing = read.at;
  } catch (err) {
    input.log?.('legal consent read failed; signup continues', err);
    return { recorded: false, continued: true };
  }
  if (!shouldStampOAuthConsent({
    isGoogle: true,
    existingConsentAt: existing,
    createdAt: input.createdAt,
    now: input.now,
  })) {
    return { recorded: false, reason: 'already_recorded' };
  }
  try {
    const outcome = await input.writeConsent();
    if (outcome.missingColumn) {
      input.log?.('legal consent columns are not on user_profiles yet; signup continues');
      return { recorded: false, missingColumn: true, continued: true };
    }
    return { recorded: outcome.stored, continued: outcome.continued };
  } catch (err) {
    input.log?.('legal consent write failed; signup continues', err);
    return { recorded: false, continued: true };
  }
}

/** True when auth.users.created_at is on or after the deploy cutoff. */
export function accountCreatedOnOrAfterLegalStamp(createdAt: string | null | undefined): boolean {
  const created = Date.parse(createdAt ?? '');
  const from = Date.parse(LEGAL_CONSENT_STAMP_FROM);
  return Number.isFinite(created) && Number.isFinite(from) && created >= from;
}

/**
 * Invite set-password / member onboarding. New accounts only.
 * No 15-minute window: the invite email can be opened later.
 * An existing stamp is left alone.
 */
export function shouldStampInviteConsent(input: {
  invited: boolean;
  createdAt: string | null | undefined;
  existingConsentAt: string | null | undefined;
}): boolean {
  if (!input.invited || input.existingConsentAt) return false;
  return accountCreatedOnOrAfterLegalStamp(input.createdAt);
}

export async function stampInviteConsent(input: {
  invited: boolean;
  createdAt: string | null | undefined;
  readConsentAt: () => Promise<{
    at: string | null;
    error: { code?: string; message?: string } | null;
  }>;
  writeConsent: () => Promise<ConsentWriteOutcome>;
  log?: (message: string, detail?: unknown) => void;
}): Promise<{
  recorded: boolean;
  reason?: 'not_invite' | 'existing_account' | 'already_recorded';
  missingColumn?: boolean;
  continued?: boolean;
}> {
  if (!input.invited) return { recorded: false, reason: 'not_invite' };
  if (!accountCreatedOnOrAfterLegalStamp(input.createdAt)) {
    return { recorded: false, reason: 'existing_account' };
  }
  let existing: string | null = null;
  try {
    const read = await input.readConsentAt();
    if (read.error) {
      if (isMissingConsentColumn(read.error)) {
        input.log?.('legal consent columns are not on user_profiles yet; signup continues', read.error);
        return { recorded: false, missingColumn: true, continued: true };
      }
      input.log?.('legal consent read failed; signup continues', read.error);
      return { recorded: false, continued: true };
    }
    existing = read.at;
  } catch (err) {
    input.log?.('legal consent read failed; signup continues', err);
    return { recorded: false, continued: true };
  }
  if (!shouldStampInviteConsent({
    invited: true,
    createdAt: input.createdAt,
    existingConsentAt: existing,
  })) {
    return { recorded: false, reason: 'already_recorded' };
  }
  try {
    const outcome = await input.writeConsent();
    if (outcome.missingColumn) {
      input.log?.('legal consent columns are not on user_profiles yet; signup continues');
      return { recorded: false, missingColumn: true, continued: true };
    }
    return { recorded: outcome.stored, continued: outcome.continued };
  } catch (err) {
    input.log?.('legal consent write failed; signup continues', err);
    return { recorded: false, continued: true };
  }
}

export function safeSignupRedirect(raw: string | undefined, requestOrigin: string): string {
  const fallbackOrigin = 'https://repairplanet.net';
  let origin: URL;
  try {
    origin = new URL(requestOrigin);
  } catch {
    origin = new URL(fallbackOrigin);
  }
  const fallback = `${origin.protocol}//${origin.host}/auth/callback?next=/onboarding`;
  if (!raw) return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  const hostOk = url.host === origin.host || PRODUCTION_HOSTS.has(url.host);
  const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  const protoOk = url.protocol === 'https:' || localHttp;
  if (!hostOk || !protoOk || url.pathname !== '/auth/callback') return fallback;
  return url.toString();
}
