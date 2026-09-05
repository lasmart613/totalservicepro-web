/**
 * Android WebView session helpers.
 * The shell injects TSPAndroid/<version> on the user agent and exposes
 * window.Android.saveSession / getStoredSession / clearSession.
 */

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
  const next = String(raw || '').trim();
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}
