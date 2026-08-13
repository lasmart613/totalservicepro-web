'use client';

import React, { useState, Suspense } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function safeNextPath(raw: string | null): string {
  if (!raw) return '/';
  // Only allow internal relative paths
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function LoginInner() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpMode, setOtpMode] = useState<'signup' | 'magic'>('signup');
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'));
  const supabase = getSupabaseClient();

  function isValidEmail(s: string) {
    const e = (s || '').trim();
    if (e.length < 6 || e.length > 254 || /\s/.test(e)) return false;
    return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(e);
  }

  function setMsg(text: string, ok = false) {
    setMessage(text);
    setMessageOk(ok);
  }

  function authRedirect(path: string) {
    if (typeof window === 'undefined') return `https://repairplanet.net${path}`;
    return `${window.location.origin}${path}`;
  }

  /**
   * Request confirm-signup email. Returns error message if send failed (so UI can show it).
   * Supabase only sends this when "Confirm email" is ON and the user is not already confirmed.
   */
  async function requestSignupConfirmEmail(cleanEmail: string): Promise<string | null> {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
      },
    });
    if (error) return error.message || 'Could not send confirmation email.';
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      if (!isValidEmail(cleanEmail)) {
        setMsg('Enter a valid email address (example: you@company.com).');
        setLoading(false);
        return;
      }
      if (isSignUp && password.length < 8) {
        setMsg('Password must be at least 8 characters.');
        setLoading(false);
        return;
      }
      if (isSignUp) {
        if (!firstName || !lastName) {
          setMsg('First and last name required for sign up.');
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setMsg('Passwords do not match. Re-enter and confirm your password.');
          setLoading(false);
          return;
        }
        const origin =
          typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { first_name: firstName, last_name: lastName },
            emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
              nextPath && nextPath !== '/' ? nextPath : '/onboarding'
            )}`,
          },
        });
        if (error) {
          if (/already|registered|exists/i.test(error.message || '')) {
            throw new Error(
              'An account with this email already exists. Use Sign In, or “Forgot password” if you never set a password. You can also use “Email me a sign-in code”.'
            );
          }
          throw error;
        }

        // Fake success / empty identities = email already registered (Supabase privacy behavior)
        if (data.user && Array.isArray((data.user as any).identities) && (data.user as any).identities.length === 0) {
          throw new Error(
            'An account with this email already exists. Use Sign In, or “Forgot password” / “Email me a sign-in code”.'
          );
        }

        if (data.user?.id) {
          await supabase.from('user_profiles').upsert(
            {
              id: data.user.id,
              first_name: firstName,
              last_name: lastName,
              email: cleanEmail,
              onboarding_completed: false,
            },
            { onConflict: 'id' }
          );
        }

        // Session returned = Confirm email is OFF (mailer_autoconfirm) — account is already active.
        // No confirmation email is sent by Supabase in this mode.
        if (data.session) {
          setShowOtp(false);
          setMsg(
            'Account created and ready. You are signed in — no confirmation email is required (Confirm email is currently off in project settings).',
            true
          );
          router.push(nextPath && nextPath !== '/' ? nextPath : '/onboarding');
          return;
        }

        // Confirm email ON: signUp already sent the confirmation email.
        // Do NOT call resend here — it hits "only request this after N seconds" and looks like failure.
        setOtpMode('signup');
        setShowOtp(true);
        setOtpCode('');
        setMsg(
          'Account created! Check your email (and spam) for a confirmation code or link. Enter the code below, or open the link, then sign in with your password.',
          true
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) {
          if (/invalid login credentials|invalid credentials/i.test(error.message || '')) {
            throw new Error(
              'Invalid email or password. If you were invited to a team, use “Forgot password” to set one. If you just signed up, confirm your email first (code in your inbox).'
            );
          }
          if (/email not confirmed|not confirmed/i.test(error.message || '')) {
            setOtpMode('signup');
            setShowOtp(true);
            const resendErr = await requestSignupConfirmEmail(cleanEmail);
            if (resendErr && /only request this after|rate|security purposes/i.test(resendErr)) {
              throw new Error(
                `Email not confirmed yet. ${resendErr} Enter the code from your inbox below, or open the link.`
              );
            }
            if (resendErr) {
              throw new Error(
                `Email not confirmed yet. Could not re-send (${resendErr}). Enter a code you already have, or try Resend in a minute.`
              );
            }
            throw new Error(
              'Email not confirmed yet. We re-sent a code — enter it below, or open the link in your email.'
            );
          }
          throw error;
        }
        router.push(nextPath || '/');
      }
    } catch (err: any) {
      const msg = err.message || 'Authentication failed';
      setMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const sendMagic = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) return setMsg('Enter a valid email address first.');
    setLoading(true);
    setMsg('');
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath || '/hub')}`,
        },
      });
      if (error) throw error;
      setOtpMode('magic');
      setShowOtp(true);
      setOtpCode('');
      setMsg('Check your email for a sign-in code (or magic link). Enter the code below.', true);
    } catch (err: any) {
      setMsg(err?.message || 'Could not send code.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const token = otpCode.replace(/\s/g, '');
    if (!isValidEmail(cleanEmail)) return setMsg('Enter your email above first.');
    if (!token || token.length < 6) return setMsg('Enter the 6–8 digit code from your email.');
    setLoading(true);
    setMsg('');
    try {
      // Try signup confirmation first, then email/magiclink
      const types: Array<'signup' | 'email' | 'magiclink'> =
        otpMode === 'signup' ? ['signup', 'email', 'magiclink'] : ['email', 'magiclink', 'signup'];
      let lastErr: string | null = null;
      let sessionOk = false;
      for (const type of types) {
        const { data, error } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token,
          type,
        });
        if (!error && data?.session) {
          sessionOk = true;
          break;
        }
        if (error) lastErr = error.message;
      }
      if (!sessionOk) {
        // Signup confirm sometimes verifies without leaving a session — try password sign-in
        if (otpMode === 'signup' && password) {
          const { error: pwErr } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
          if (!pwErr) {
            setMsg('Email confirmed! Signing you in…', true);
            router.push(nextPath && nextPath !== '/' ? nextPath : '/onboarding');
            return;
          }
        }
        throw new Error(lastErr || 'Invalid or expired code. Request a new one.');
      }
      setMsg('Verified! Redirecting…', true);
      router.push(
        otpMode === 'signup'
          ? nextPath && nextPath !== '/'
            ? nextPath
            : '/onboarding'
          : nextPath || '/hub'
      );
    } catch (err: any) {
      setMsg(err?.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) return setMsg('Enter your email first.');
    setLoading(true);
    try {
      if (otpMode === 'signup') {
        const err = await requestSignupConfirmEmail(cleanEmail);
        if (err) {
          setMsg(
            `Could not resend confirmation: ${err}. If Confirm email is off in Supabase, no code is sent — just Sign In with your password.`,
            false
          );
        } else {
          setMsg('Confirmation code re-sent. Check inbox and spam.', true);
        }
      } else {
        await sendMagic();
        return;
      }
    } catch (err: any) {
      setMsg(err?.message || 'Could not resend.');
    } finally {
      setLoading(false);
    }
  };

  const forgot = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) return setMsg('Enter a valid email address first.');
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/auth/set-password')}`,
    });
    setMsg(
      error
        ? error.message
        : 'Password reset link sent! Open it to choose a password (check spam).',
      !error
    );
  };

  const signInWithGoogle = async () => {
    setMsg('');
    setLoading(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(nextPath || '/')}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setMsg(err?.message || 'Google sign-in failed. Is Google enabled in Supabase Auth?');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </Link>
          <p className="text-[var(--text3)] mt-1 text-sm tracking-wide">Professional Laser Service Tools</p>
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--gold)' }}>
            {isSignUp ? 'Create Account' : 'Sign In'}
          </h1>

          {message && (
            <div
              className={`mb-4 p-3 rounded text-sm ${
                messageOk || /sent|created|Check|Verified|confirmed|code/i.test(message)
                  ? 'bg-green-900/30 text-green-400'
                  : 'bg-red-900/30 text-red-400'
              }`}
            >
              {message}
            </div>
          )}

          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-lg border border-[var(--border2)] bg-white text-gray-800 font-semibold text-sm hover:bg-gray-50 disabled:opacity-60 mb-5"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 mb-5 text-xs text-[var(--text3)]">
            <div className="flex-1 h-px bg-[var(--border2)]" />
            or with email
            <div className="flex-1 h-px bg-[var(--border2)]" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {isSignUp && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">First Name</label>
                  <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required autoCapitalize="words" />
                </div>
                <div>
                  <label className="label">Last Name</label>
                  <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} required autoCapitalize="words" />
                </div>
              </div>
            )}

            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required autoCapitalize="off" />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={isSignUp ? 8 : 6}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
              />
              {isSignUp && (
                <p className="text-[10px] text-[var(--text3)] mt-1">At least 8 characters</p>
              )}
            </div>

            {isSignUp && (
              <div>
                <label className="label">Confirm password</label>
                <input
                  type="password"
                  className="input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60"
            >
              {loading ? 'Please wait...' : (isSignUp ? 'Create Account' : 'Sign In')}
            </button>
          </form>

          {showOtp && (
            <div className="mt-5 p-4 rounded-lg border border-[var(--gold-border,#FBBF2444)] bg-[var(--surface2)] space-y-3">
              <div className="text-sm font-semibold" style={{ color: 'var(--gold)' }}>
                Enter verification code
              </div>
              <p className="text-xs text-[var(--text3)]">
                Use the 6–8 digit code from your email (same as the mobile app). You can also open the link in the email.
              </p>
              <input
                type="text"
                className="input text-center text-xl tracking-widest font-bold"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                placeholder="123456"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
              <button
                type="button"
                onClick={verifyOtp}
                disabled={loading}
                className="btn btn-primary w-full py-2.5 disabled:opacity-60"
              >
                {loading ? 'Verifying…' : 'Verify & continue'}
              </button>
              <div className="flex justify-between text-xs">
                <button type="button" onClick={resendCode} className="text-[var(--gold)] hover:underline">
                  Resend code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowOtp(false);
                    setOtpCode('');
                  }}
                  className="text-[var(--text3)] hover:underline"
                >
                  Hide
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3 text-center text-sm">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setMsg('');
                setConfirmPassword('');
                setShowOtp(false);
                setOtpCode('');
              }}
              className="text-[var(--gold)] hover:underline"
            >
              {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </button>

            <div>
              <button onClick={sendMagic} className="text-[var(--text3)] hover:text-[var(--gold)] underline">
                Email me a sign-in code
              </button>
            </div>
            <div>
              <button onClick={forgot} className="text-[var(--text3)] hover:text-[var(--gold)] underline">Forgot password?</button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          Web version of Total Service Pro • Shares data with the mobile app via Supabase
        </p>

        <div className="mt-8 card p-5 text-sm">
          <div className="font-bold mb-3 text-center" style={{ color: 'var(--gold)' }}>
            Join as a Service Organization, Laser Clinic, or Parts Supplier
          </div>
          <p className="text-center text-xs text-[var(--text3)] mb-4">
            FSEs are added by Service Organizations through their Team section.
            There is no individual FSE signup.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <Link href="/signup/company" className="btn btn-secondary w-full justify-center text-sm py-2">
              Sign up as Service Organization
            </Link>
            <Link href="/signup/owner" className="btn btn-secondary w-full justify-center text-sm py-2">
              Sign up as Laser Owner / Facility
            </Link>
            <Link href="/signup/supplier" className="btn btn-secondary w-full justify-center text-sm py-2">
              Sign up as Parts Supplier
            </Link>
          </div>
          <div className="text-center mt-3">
            <Link href="/signup" className="text-[var(--gold)] text-xs hover:underline">View all options →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--text3)]">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
