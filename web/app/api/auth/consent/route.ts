import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { isGoogleIdentity, stampGoogleConsent, writeUserLegalConsent } from '@/lib/legal/signup-consent';

/**
 * First Google sign-in. If legal_consent_at is still null, stamp it.
 * A profile that already has consent is left alone (no re-consent wall).
 * Password, invite, and email-confirm users are not stamped here.
 * Missing columns are logged and the callback is allowed to continue.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const userClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  if (!hasServiceRole()) {
    console.warn('legal consent not stored; SUPABASE_SERVICE_ROLE_KEY is missing. Signup continues.');
    return NextResponse.json({ recorded: false, continued: true });
  }

  const admin = getSupabaseAdmin();
  const result = await stampGoogleConsent({
    isGoogle: isGoogleIdentity(user),
    readConsentAt: async () => {
      const read = await admin
        .from('user_profiles')
        .select('legal_consent_at')
        .eq('id', user.id)
        .maybeSingle();
      return {
        at: read.data?.legal_consent_at ?? null,
        error: read.error ? { code: read.error.code, message: read.error.message } : null,
      };
    },
    writeConsent: () =>
      writeUserLegalConsent(admin, user.id, new Date().toISOString(), (message, detail) => {
        console.warn(message, detail);
      }),
    log: (message, detail) => {
      console.warn(message, detail);
    },
  });

  return NextResponse.json(result);
}
