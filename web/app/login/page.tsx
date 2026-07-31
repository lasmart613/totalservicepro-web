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
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'));
  const supabase = getSupabaseClient();

  function isValidEmail(s: string) {
    const e = (s || '').trim();
    if (e.length < 6 || e.length > 254 || /\s/.test(e)) return false;
    return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(e);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      if (!isValidEmail(cleanEmail)) {
        setMessage('Enter a valid email address (example: you@company.com).');
        setLoading(false);
        return;
      }
      if (isSignUp && password.length < 8) {
        setMessage('Password must be at least 8 characters.');
        setLoading(false);
        return;
      }
      if (isSignUp) {
        if (!firstName || !lastName) {
          setMessage('First and last name required for sign up.');
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setMessage('Passwords do not match. Re-enter and confirm your password.');
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
            // Verification link lands here after user proves email ownership
            emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
              nextPath && nextPath !== '/' ? nextPath : '/onboarding'
            )}`,
          },
        });
        if (error) {
          if (/already|registered|exists/i.test(error.message || '')) {
            throw new Error(
              'An account with this email already exists (team invites create the account before the first login). Use Sign In, or “Forgot password” if you never set a password.'
            );
          }
          throw error;
        }

        // Always create/update profile row when we have a user id
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

        // Prefer verified email before app use:
        // - If Supabase "Confirm email" is ON → no session until they click the email link
        // - If Confirm email is OFF → session is returned immediately; we still sign out
        //   so users must verify ownership via the confirmation / magic link when possible
        if (data.session) {
          try {
            await supabase.auth.resend({
              type: 'signup',
              email: cleanEmail,
              options: {
                emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
              },
            });
          } catch {
            /* ignore resend failures */
          }
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            /* ignore */
          }
        }

        setMessage(
          'Account created! Check your email (and spam) for a confirmation link to verify you own this address, then sign in.'
        );
        setIsSignUp(false);
        setConfirmPassword('');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) {
          // Invited users exist in Auth but have no password until they complete set-password
          if (/invalid login credentials|invalid credentials/i.test(error.message || '')) {
            throw new Error(
              'Invalid email or password. If you were invited to a team, you may not have set a password yet — use “Forgot password” below (same invite email) to create one. Signup will say “user already exists” because the invite already created your account.'
            );
          }
          throw error;
        }
        router.push(nextPath || '/');
      }
    } catch (err: any) {
      const msg = err.message || 'Authentication failed';
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const sendMagic = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) return setMessage('Enter a valid email address first.');
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
    const { error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: { emailRedirectTo: `${origin}/auth/callback?next=/hub` },
    });
    setMessage(error ? error.message : 'Check your email for a magic link or sign-in code.');
  };

  const forgot = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) return setMessage('Enter a valid email address first.');
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
    // Same set-password page used by team invites
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/auth/set-password')}`,
    });
    setMessage(
      error
        ? error.message
        : 'Password reset link sent! Open it to choose a password (check spam).'
    );
  };

  const signInWithGoogle = async () => {
    setMessage('');
    setLoading(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
      // Pass next destination through callback so Admin Portal (etc.) is restored after Google OAuth
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
      // Browser navigates to Google — no further action
    } catch (err: any) {
      setMessage(err?.message || 'Google sign-in failed. Is Google enabled in Supabase Auth?');
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
            <div className={`mb-4 p-3 rounded text-sm ${message.includes('sent') || message.includes('created') || message.includes('Check') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
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
                  <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required />
                </div>
                <div>
                  <label className="label">Last Name</label>
                  <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} required />
                </div>
              </div>
            )}

            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required />
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

          <div className="mt-6 space-y-3 text-center text-sm">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setMessage('');
                setConfirmPassword('');
              }}
              className="text-[var(--gold)] hover:underline"
            >
              {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </button>

            <div>
              <button onClick={sendMagic} className="text-[var(--text3)] hover:text-[var(--gold)] underline">Sign in with Magic Link</button>
            </div>
            <div>
              <button onClick={forgot} className="text-[var(--text3)] hover:text-[var(--gold)] underline">Forgot password?</button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          Web version of Total Service Pro • Shares data with the mobile app via Supabase
        </p>

        {/* Cleaned up signup options - No FSE self-signup */}
        <div className="mt-8 card p-5 text-sm">
          <div className="font-bold mb-3 text-center" style={{ color: 'var(--gold)' }}>
            Join as a Service Organization, Laser Clinic, or Parts Supplier
          </div>
          <p className="text-center text-xs text-[var(--text3)] mb-4">
            FSEs are added by Service Organizations through their Team section. 
            There is no individual FSE signup.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <Link href="/company" className="btn btn-secondary w-full justify-center text-sm py-2">
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
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[var(--text3)]">
          Loading…
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}