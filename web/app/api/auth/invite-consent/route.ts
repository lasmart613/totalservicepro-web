import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { stampInviteConsent, writeUserLegalConsent } from '@/lib/legal/signup-consent';

/**
 * Invite set-password and member onboarding.
 * Stamps with the service role only when the auth user was created on or after
 * LEGAL_CONSENT_STAMP_FROM, is an invited member, and legal_consent_at is null.
 * Older accounts are left alone. The browser cannot write these columns.
 * Missing columns are logged and the invite step is allowed to continue.
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
  const meta = (user.user_metadata || {}) as { invited_member?: boolean };
  let invited = meta.invited_member === true;
  if (!invited && user.email) {
    const { data: invites } = await admin
      .from('engineer_invitations')
      .select('id')
      .ilike('email', user.email)
      .limit(1);
    invited = Boolean(invites && invites.length);
  }

  const result = await stampInviteConsent({
    invited,
    createdAt: user.created_at,
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
