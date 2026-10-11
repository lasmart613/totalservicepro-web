/**
 * Android WebView session helpers.
 * The shell injects TSPAndroid/<version> on the user agent and exposes
 * window.Android.saveSession / getStoredSession / clearSession.
 */

import { PRODUCTION_SITE_ORIGIN } from './site-origin.ts';
import { safeRedirectPath } from './safe-redirect.ts';

export const TSP_ANDROID_UA_RE = /TSPAndroid\//i;
export const ANDROID_AUTH_SCHEME = 'totalservicepro';
export const ANDROID_AUTH_HOST = 'auth-callback';

export function isTspAndroidWebView(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
): boolean {
  return TSP_ANDROID_UA_RE.test(String(userAgent || ''));
}

export type AndroidSessionTokens = {
  access_token: string;
  refresh_token: string;
  expires_at?: string | number | null;
};

export function normalizeAndroidSession(raw: unknown): AndroidSessionTokens | null {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const wrapped = parsed as { currentSession?: unknown; access_token?: unknown; refresh_token?: unknown; expires_at?: unknown };
  const session =
    wrapped.currentSession && typeof wrapped.currentSession === 'object'
      ? (wrapped.currentSession as { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown })
      : wrapped;
  const access = String(session.access_token || '').trim();
  if (!access) return null;
  return {
    access_token: access,
    refresh_token: String(session.refresh_token || ''),
    expires_at: session.expires_at ?? wrapped.expires_at ?? null,
  };
}

/** localStorage shape Supabase persistSession already uses (tsp-auth-token). */
export function persistableAndroidSession(session: AndroidSessionTokens): string {
  return JSON.stringify({
    currentSession: {
      access_token: session.access_token,
      refresh_token: session.refresh_token || '',
      expires_at: session.expires_at,
    },
    expiresAt: session.expires_at,
  });
}

export function safeAndroidNextPath(raw: string | null | undefined): string {
  return safeRedirectPath(raw, PRODUCTION_SITE_ORIGIN, '/');
}

/** Same shape as AuthHandoff.newNonce: 16 bytes, lowercase hex. */
export const TSP_APP_NONCE_RE = /^[0-9a-f]{32}$/;

type PageParamSource = { get(name: string): string | null };

/**
 * Google OAuth return URL. The Android shell also stamps app=1 and tsp_nonce
 * onto redirect_to when it opens the Custom Tab. Login keeps whatever the
 * page already has so Supabase sends them back on the callback query.
 */
export function googleOAuthRedirectTo(
  origin: string,
  nextPath: string,
  pageParams: PageParamSource,
  androidWebView: boolean
): string {
  const params = new URLSearchParams();
  if (androidWebView || pageParams.get('app') === '1') params.set('app', '1');
  const nonce = pageParams.get('tsp_nonce') || '';
  if (TSP_APP_NONCE_RE.test(nonce)) params.set('tsp_nonce', nonce);
  params.set('next', safeRedirectPath(nextPath || '/', origin));
  const base = apexAuthOrigin(String(origin || PRODUCTION_SITE_ORIGIN).replace(/\/$/, ''), androidWebView);
  return `${base}/auth/callback?${params.toString()}`;
}

/** Auth handoff and the Android OAuth return stay on the apex. www 301s. */
function apexAuthOrigin(origin: string, androidWebView: boolean): string {
  if (androidWebView && /^https?:\/\/www\.repairplanet\.net$/i.test(origin)) {
    return PRODUCTION_SITE_ORIGIN;
  }
  return origin;
}

export type AndroidHandoff = {
  httpsUrl: string;
  customSchemeUrl: string;
};

/**
 * App handoff after a sign-in that finished on this page load.
 * An existing session with no fresh code or hash tokens does not qualify.
 * The https URL is the verified App Link. The custom scheme is only a fallback.
 */
export function buildAndroidHandoff(input: {
  completedSignIn: boolean;
  appRequested: boolean;
  nonce: string | null | undefined;
  state?: string | null;
  accessToken: string | null | undefined;
  refreshToken?: string | null;
  dest: string;
  inWebView?: boolean;
}): AndroidHandoff | null {
  if (input.inWebView) return null;
  if (!input.appRequested || !input.completedSignIn) return null;
  const access = String(input.accessToken || '').trim();
  if (!access) return null;
  const nonce = String(input.nonce || '');
  if (!TSP_APP_NONCE_RE.test(nonce)) return null;
  const refresh = String(input.refreshToken || '');
  const dest = input.dest || '/';
  const state = input.state == null ? '' : String(input.state);
  const includeState = state.length > 0 && state.length < 512;
  const hash =
    `access_token=${encodeURIComponent(access)}` +
    `&refresh_token=${encodeURIComponent(refresh)}` +
    `&next=${encodeURIComponent(dest)}` +
    `&tsp_nonce=${encodeURIComponent(nonce)}` +
    (includeState ? `&state=${encodeURIComponent(state)}` : '');
  const query = new URLSearchParams();
  query.set('app', '1');
  query.set('tsp_nonce', nonce);
  return {
    httpsUrl: `${PRODUCTION_SITE_ORIGIN}/auth/callback?${query.toString()}#${hash}`,
    customSchemeUrl: `${ANDROID_AUTH_SCHEME}://${ANDROID_AUTH_HOST}#${hash}`,
  };
}
