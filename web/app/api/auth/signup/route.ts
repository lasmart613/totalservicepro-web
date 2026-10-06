import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { signupAssignsTenant } from '@/lib/tenant-lockdown';
import { publicSiteOrigin } from '@/lib/site-origin';
import { LEGAL_VERSION, consentAccepted } from '@/lib/legal/consent';
import { writeUserLegalConsent } from '@/lib/legal/signup-consent';

/**
 * POST /api/auth/signup
 * { email, password, firstName, lastName, emailRedirectTo?, consent, legalVersion }
 *
 * Creates the Auth user only after consent is present.
 * Profile columns written here are display fields only.
 * organization_id, active_organization_id, and role are rejected.
 * legal_consent_at and legal_consent_version are written with the service role.
 * A missing column or a missing service-role key is logged and does not fail signup.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (signupAssignsTenant(body)) {
      return NextResponse.json(
        { error: 'Signup cannot assign an organization or role.' },
        { status: 400 }
      );
    }
    if (!consentAccepted(body)) {
      return NextResponse.json({ error: 'consent_required' }, { status: 400 });
    }

    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const firstName = String(body.firstName || body.first_name || '').trim();
    const lastName = String(body.lastName || body.last_name || '').trim();
    const emailRedirectTo = String(body.emailRedirectTo || '').trim();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'First and last name required for sign up.' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const supabase = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          legal_consent: true,
          legal_consent_version: LEGAL_VERSION,
        },
        emailRedirectTo:
          emailRedirectTo ||
          `${publicSiteOrigin(req)}/auth/callback?next=${encodeURIComponent('/onboarding')}`,
      },
    });
    if (error) {
      const message = /already|registered|exists/i.test(error.message || '')
        ? 'An account with this email already exists. Use Sign In, or “Forgot password” if you never set a password.'
        : error.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const user = data.user;
    if (user && Array.isArray(user.identities) && user.identities.length === 0) {
      return NextResponse.json(
        {
          error:
            'An account with this email already exists. Use Sign In, or “Forgot password” / “Email me a sign-in code”.',
        },
        { status: 400 }
      );
    }

    if (user?.id && hasServiceRole()) {
      const admin = getSupabaseAdmin();
      const row = {
        id: user.id,
        email,
        first_name: firstName,
        last_name: lastName,
        onboarding_completed: false,
      };
      const { error: profileError } = await admin.from('user_profiles').upsert(row, { onConflict: 'id' });
      if (profileError) {
        console.warn('signup profile', profileError.message);
      }
      const consent = await writeUserLegalConsent(admin, user.id, new Date().toISOString(), (message, detail) => {
        console.warn(message, detail);
      });
      if (consent.missingColumn) {
        console.warn('legal consent columns are not on user_profiles yet; signup continues');
      }
    } else if (user?.id) {
      console.warn('legal consent not stored; SUPABASE_SERVICE_ROLE_KEY is missing. Signup continues.');
    }

    const session = data.session;
    return NextResponse.json({
      ok: true,
      userId: user?.id ?? null,
      user: user
        ? { id: user.id, email: user.email, identities: user.identities }
        : null,
      needsEmailConfirm: !session,
      session: session
        ? { access_token: session.access_token, refresh_token: session.refresh_token }
        : null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Signup failed';
    console.error('auth signup', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
