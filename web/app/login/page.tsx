'use client';

import React, { useState, Suspense } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { PublicLink, usePublicHref, useT } from '@/lib/fa/locale';
import { nextPathFromSearchParams } from '@/lib/login-next';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { claimCustomerInvite, clearStaleClaimToken } from '@/lib/customer-invite-client';
import { clearPendingSignup } from '@/lib/pending-signup';
import { prepareFreshSignup, signOutAndClearIdentity } from '@/lib/auth-session';
import { postTeamClaim, routeAfterTeamClaim } from '@/lib/invite-claim';
import { publicAuthMessage } from '@/lib/auth-errors';
import { clientAuthOrigin } from '@/lib/site-origin';
import { loginMagicLinkRedirect, recoveryRedirect } from '@/lib/auth-link-route';

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
  const t = useT();
  const to = usePublicHref();
  const nextPath = nextPathFromSearchParams(searchParams);
  const claimToken = (searchParams.get('claim') || '').trim();
  const supabase = getSupabaseClient();

  async function finishLogin(dest: string) {
    dest = safeRedirectPath(dest, clientAuthOrigin(), '/');
    if (claimToken) {
      const { data: sessionData } = await supabase.auth.getSession();
      let claimedOk = false;
      if (sessionData.session?.access_token) {
        const claimed = await claimCustomerInvite(sessionData.session.access_token, claimToken);
        claimedOk = !!claimed.claimed;
      }
      if (claimedOk) {
        router.push('/company?justSetup=1');
        return;
      }
      await clearStaleClaimToken(supabase);
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.access_token) {
      const claim = await postTeamClaim(sessionData.session.access_token);
      router.push(routeAfterTeamClaim(claim, dest));
      return;
    }
    router.push(dest);
  }

  function isValidEmail(s: string) {
    const e = (s || '').trim();
    if (e.length < 6 || e.length > 254 || /\s/.test(e)) return false;
    return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(e);
  }

  function setMsg(text: string, ok = false) {
    setMessage(text);
    setMessageOk(ok);
  }

  function publicAuthError(raw: unknown): string {
    return publicAuthMessage(raw, 'Something went wrong. Please try again.');
  }

  function authRedirect(path: string) {
    return `${clientAuthOrigin()}${path}`;
  }

  /**
   * Request confirm-signup email. Returns error message if send failed (so UI can show it).
   * Supabase only sends this when "Confirm email" is ON and the user is not already confirmed.
   */
  async function requestSignupConfirmEmail(cleanEmail: string): Promise<string | null> {
    const origin = clientAuthOrigin();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
          safeRedirectPath('/onboarding', origin)
        )}`,
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
        const origin = clientAuthOrigin();
        await prepareFreshSignup(supabase);
        const signupRes = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password,
            firstName,
            lastName,
            emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
              safeRedirectPath(nextPath && nextPath !== '/' ? nextPath : '/onboarding', origin)
            )}`,
          }),
        });
        const signupJson = await signupRes.json().catch(() => ({}));
        if (!signupRes.ok) {
          throw new Error(signupJson.error || 'Could not create account.');
        }

        if (signupJson.session?.access_token && signupJson.session?.refresh_token) {
          const { error: sessionErr } = await supabase.auth.setSession({
            access_token: signupJson.session.access_token,
            refresh_token: signupJson.session.refresh_token,
          });
          if (sessionErr) throw sessionErr;
          setShowOtp(false);
          setMsg(
            'Account created and ready. You are signed in — no confirmation email is required (Confirm email is currently off in project settings).',
            true
          );
          await finishLogin(nextPath && nextPath !== '/' ? nextPath : '/onboarding');
          return;
        }

        setOtpMode('signup');
        setShowOtp(true);
        setOtpCode('');
        setMsg(
          'Account created! Check your email (and spam) for a confirmation code or link. Enter the code below, or open the link, then sign in with your password.',
          true
        );
      } else {
        const {
          data: { user: current },
        } = await supabase.auth.getUser();
        if (current?.email && current.email.toLowerCase() !== cleanEmail) {
          await signOutAndClearIdentity(supabase);
        } else {
          clearPendingSignup();
        }
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
        await finishLogin(nextPath || '/');
      }
    } catch (err: any) {
      const msg = publicAuthError(err.message) || 'Authentication failed';
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
      const origin = clientAuthOrigin();
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: loginMagicLinkRedirect(origin, nextPath || '/hub', claimToken),
        },
      });
      if (error) throw error;
      setOtpMode('magic');
      setShowOtp(true);
      setOtpCode('');
      setMsg('Check your email for a sign-in code (or magic link). Enter the code below.', true);
    } catch (err: any) {
      setMsg(publicAuthError(err?.message) || 'Could not send code.');
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
            await finishLogin(nextPath && nextPath !== '/' ? nextPath : '/onboarding');
            return;
          }
        }
        throw new Error(lastErr || 'Invalid or expired code. Request a new one.');
      }
      setMsg('Verified! Redirecting…', true);
      await finishLogin(
        otpMode === 'signup'
          ? nextPath && nextPath !== '/'
            ? nextPath
            : '/onboarding'
          : nextPath || '/hub'
      );
    } catch (err: any) {
      setMsg(publicAuthError(err?.message) || 'Verification failed.');
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
      setMsg(publicAuthError(err?.message) || 'Could not resend.');
    } finally {
      setLoading(false);
    }
  };

  const forgot = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) return setMsg('Enter a valid email address first.');
    const origin = clientAuthOrigin();
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: recoveryRedirect(origin),
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
      const origin = clientAuthOrigin();
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(
        safeRedirectPath(nextPath || '/', origin)
      )}`;
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
      setMsg(publicAuthError(err?.message) || 'Google sign-in failed.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <PublicLink href="/" className="inline-block">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </PublicLink>
          <p className="text-[var(--text3)] mt-1 text-sm tracking-wide">
            {t('Field service tools for biomedical equipment — lasers, lithotriptors, C-arms, and more.')}
          </p>
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--gold)' }}>
            {isSignUp ? t('Create Account') : t('Sign In')}
          </h1>

          {message && (
            <div
              className={`mb-4 p-3 rounded text-sm ${
                messageOk || /sent|created|Check|Verified|confirmed|code/i.test(message)
                  ? 'bg-green-900/30 text-green-400'
                  : 'bg-red-900/30 text-red-400'
              }`}
            >
              {t(message)}
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
            {t('Continue with Google')}
          </button>

          <div className="flex items-center gap-3 mb-5 text-xs text-[var(--text3)]">
            <div className="flex-1 h-px bg-[var(--border2)]" />
            {t('or with email')}
            <div className="flex-1 h-px bg-[var(--border2)]" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {isSignUp && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('First Name')}</label>
                  <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required autoCapitalize="words" />
                </div>
                <div>
                  <label className="label">{t('Last Name')}</label>
                  <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} required autoCapitalize="words" />
                </div>
              </div>
            )}

            <div>
              <label className="label">{t('Email')}</label>
              <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required autoCapitalize="off" />
            </div>

            <div>
              <label className="label">{t('Password')}</label>
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
                <p className="text-[10px] text-[var(--text3)] mt-1">{t('At least 8 characters')}</p>
              )}
            </div>

            {isSignUp && (
              <div>
                <label className="label">{t('Confirm password')}</label>
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
              {loading ? t('Please wait...') : (isSignUp ? t('Create Account') : t('Sign In'))}
            </button>
          </form>

          {showOtp && (
            <div className="mt-5 p-4 rounded-lg border border-[var(--gold-border,#FBBF2444)] bg-[var(--surface2)] space-y-3">
              <div className="text-sm font-semibold" style={{ color: 'var(--gold)' }}>
                {t('Enter verification code')}
              </div>
              <p className="text-xs text-[var(--text3)]">
                {t('Use the 6–8 digit code from your email (same as the mobile app). You can also open the link in the email.')}
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
                {loading ? t('Verifying…') : t('Verify & continue')}
              </button>
              <div className="flex justify-between text-xs">
                <button type="button" onClick={resendCode} className="text-[var(--gold)] hover:underline">
                  {t('Resend code')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowOtp(false);
                    setOtpCode('');
                  }}
                  className="text-[var(--text3)] hover:underline"
                >
                  {t('Hide')}
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3 text-center text-sm">
            {isSignUp ? (
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(false);
                  setMsg('');
                  setConfirmPassword('');
                  setShowOtp(false);
                  setOtpCode('');
                }}
                className="text-[var(--gold)] hover:underline"
              >
                {t('Already have an account? Sign In')}
              </button>
            ) : (
              <PublicLink href="/signup" className="text-[var(--gold)] hover:underline">
                {t("Don't have an account? Sign Up")}
              </PublicLink>
            )}

            <div>
              <button onClick={sendMagic} className="text-[var(--text3)] hover:text-[var(--gold)] underline">
                {t('Email me a sign-in code')}
              </button>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  if (!isValidEmail(email.trim().toLowerCase())) {
                    router.push(to('/forgot-password'));
                    return;
                  }
                  forgot();
                }}
                className="text-[var(--text3)] hover:text-[var(--gold)] underline"
              >
                {t('Forgot password?')}
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          {t('Web version of Total Service Pro • Shares data with the mobile app via Supabase')}
        </p>

        <div className="mt-8 card p-5 text-sm">
          <div className="font-bold mb-3 text-center" style={{ color: 'var(--gold)' }}>
            {t('Join as a Repair company, Clinic, or Parts seller')}
          </div>
          <p className="text-center text-xs text-[var(--text3)] mb-4">
            {t('BMETs, laser service engineers, and field techs are added by their repair company through Team. There is no individual technician signup.')}
          </p>
          <div className="grid grid-cols-1 gap-2">
            <PublicLink href="/signup/company" className="btn btn-secondary w-full justify-center text-sm py-2">
              {t('Sign up as Repair company')}
            </PublicLink>
            <PublicLink href="/signup/owner" className="btn btn-secondary w-full justify-center text-sm py-2">
              {t('Sign up as Clinic / equipment owner')}
            </PublicLink>
            <PublicLink href="/signup/supplier" className="btn btn-secondary w-full justify-center text-sm py-2">
              {t('Sign up as Parts seller')}
            </PublicLink>
          </div>
          <div className="text-center mt-3">
            <PublicLink href="/signup" className="text-[var(--gold)] text-xs hover:underline">{t('View all options →')}</PublicLink>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginStaticIntro() {
  const t = useT();
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <PublicLink href="/" className="inline-block">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </PublicLink>
          <p className="text-[var(--text3)] mt-1 text-sm tracking-wide">
            {t('Field service tools for biomedical equipment — lasers, lithotriptors, C-arms, and more.')}
          </p>
        </div>
        <div className="card p-8">
          <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--gold)' }}>{t('Sign in')}</h1>
          <p className="text-sm text-[var(--text3)] mb-4">
            {t('Sign in to Total Service Pro on RepairPlanet — shop schedule, directory, and marketplace for biomedical and laser repair companies.')}
          </p>
          <p className="text-[var(--text3)]">{t('Loading…')}</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginStaticIntro />}>
      <LoginInner />
    </Suspense>
  );
}
