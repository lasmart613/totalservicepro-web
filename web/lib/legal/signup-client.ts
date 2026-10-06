import { getSupabaseClient } from '@/lib/supabase/client';
import { CONSENT_REQUIRED, LEGAL_VERSION } from '@/lib/legal/consent';
import { isGoogleIdentity } from '@/lib/legal/signup-consent';

type SignupSession = { access_token: string; refresh_token: string };

/**
 * Email signup goes through /api/auth/signup so the server can reject a missing
 * consent flag and write legal_consent_at / legal_consent_version.
 */
export async function signUpWithConsent(input: {
  email: string;
  password: string;
  consent: boolean;
  data?: Record<string, unknown>;
  emailRedirectTo?: string;
}): Promise<{
  data: {
    user: { id: string; email?: string | null; identities?: unknown[] | null } | null;
    session: SignupSession | null;
  };
  error: { message: string } | null;
}> {
  let json: {
    error?: string;
    user?: { id: string; email?: string | null; identities?: unknown[] | null } | null;
    session?: SignupSession | null;
  } | null = null;
  let res: Response;
  try {
    res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        consent: input.consent,
        legalVersion: LEGAL_VERSION,
        data: input.data,
        emailRedirectTo: input.emailRedirectTo,
      }),
    });
    json = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sign up failed.';
    return { data: { user: null, session: null }, error: { message } };
  }

  if (!res.ok) {
    const code = json?.error;
    const message =
      code === 'consent_required' ? CONSENT_REQUIRED : typeof code === 'string' ? code : 'Sign up failed.';
    return { data: { user: null, session: null }, error: { message } };
  }

  const session =
    json?.session?.access_token && json.session.refresh_token ? json.session : null;
  if (session) {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) {
      return { data: { user: json?.user ?? null, session: null }, error: { message: error.message } };
    }
  }
  return { data: { user: json?.user ?? null, session }, error: null };
}

/** Asks the server to stamp a brand-new Google account. The route decides. Failures do not block navigation. */
export async function recordGoogleConsentIfNeeded(
  supabase: {
    auth: {
      getSession: () => Promise<{ data: { session: { access_token?: string } | null } }>;
    };
  },
  user: Parameters<typeof isGoogleIdentity>[0],
): Promise<void> {
  if (!isGoogleIdentity(user)) return;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch('/api/auth/consent', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ legalVersion: LEGAL_VERSION }),
    });
    if (!res.ok) console.warn('legal consent', res.status);
  } catch (err) {
    console.warn('legal consent', err);
  }
}
