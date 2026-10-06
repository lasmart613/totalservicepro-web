import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { runEmailSignup, safeSignupRedirect, writeUserLegalConsent } from '@/lib/legal/signup-consent';

/**
 * Creates the auth user only after consent is present.
 * handle_new_auth_user inserts user_profiles and ignores unknown metadata.
 * Consent columns are updated here, after that insert. A missing column or a
 * missing service-role key is logged and does not fail the signup response.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'consent_required' }, { status: 400 });
  }

  const result = await runEmailSignup(body && typeof body === 'object' ? body : {}, {
    signUp: async (args) => {
      const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await supabase.auth.signUp({
        email: args.email,
        password: args.password,
        options: args.options,
      });
      return {
        user: data.user
          ? { id: data.user.id, email: data.user.email, identities: data.user.identities }
          : null,
        session: data.session
          ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
          : null,
        error: error ? { message: error.message } : null,
      };
    },
    writeConsent: async (userId) => {
      if (!hasServiceRole()) {
        console.warn('legal consent not stored; SUPABASE_SERVICE_ROLE_KEY is missing. Signup continues.');
        return { stored: false, continued: true };
      }
      return writeUserLegalConsent(getSupabaseAdmin(), userId, new Date().toISOString(), (message, detail) => {
        console.warn(message, detail);
      });
    },
    redirectTo: (raw) => safeSignupRedirect(raw, req.nextUrl.origin),
    log: (message, detail) => {
      console.warn(message, detail);
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    user: result.user,
    session: result.session,
    consent: result.consent,
  });
}
