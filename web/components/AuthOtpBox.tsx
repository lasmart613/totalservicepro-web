'use client';

import React, { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

type Props = {
  email: string;
  /** Used after signup confirm when verify leaves no session */
  password?: string;
  mode?: 'signup' | 'magic';
  /** Called after a session is established (verify or password sign-in) */
  onVerified?: () => void | Promise<void>;
  emailRedirectTo?: string;
};

/**
 * Enter / resend Supabase email OTP (signup confirmation or magic link).
 * signUp already sends the first confirm email — do not call resend immediately after signUp.
 */
export default function AuthOtpBox({
  email,
  password,
  mode = 'signup',
  onVerified,
  emailRedirectTo,
}: Props) {
  const supabase = getSupabaseClient();
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);

  const cleanEmail = (email || '').trim().toLowerCase();

  function redirectUrl() {
    if (emailRedirectTo) return emailRedirectTo;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
    return `${origin}/auth/callback?next=/onboarding`;
  }

  async function resend() {
    if (!cleanEmail) {
      setMessage('Email is missing.');
      setMessageOk(false);
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: cleanEmail,
          options: { emailRedirectTo: redirectUrl() },
        });
        if (error) {
          const msg = error.message || 'Could not resend.';
          // Rate limit after signUp is normal — first email was already sent
          if (/only request this after|rate|security purposes/i.test(msg)) {
            setMessage(`${msg} Use the code already in your inbox (check spam).`);
            setMessageOk(true);
          } else {
            setMessage(msg);
            setMessageOk(false);
          }
        } else {
          setMessage('Confirmation code re-sent. Check inbox and spam.', true);
          setMessageOk(true);
        }
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email: cleanEmail,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: redirectUrl(),
          },
        });
        if (error) throw error;
        setMessage('Sign-in code re-sent. Check inbox and spam.');
        setMessageOk(true);
      }
    } catch (err: any) {
      setMessage(err?.message || 'Could not resend.');
      setMessageOk(false);
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (!cleanEmail) {
      setMessage('Email is missing.');
      setMessageOk(false);
      return;
    }
    const token = otpCode.replace(/\s/g, '');
    if (!token || token.length < 6) {
      setMessage('Enter the 6–8 digit code from your email.');
      setMessageOk(false);
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const types: Array<'signup' | 'email' | 'magiclink'> =
        mode === 'signup' ? ['signup', 'email', 'magiclink'] : ['email', 'magiclink', 'signup'];
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

      if (!sessionOk && mode === 'signup' && password) {
        // Some confirm flows verify ownership without leaving a session
        const { error: pwErr } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (!pwErr) sessionOk = true;
        else if (pwErr) lastErr = pwErr.message;
      }

      if (!sessionOk) {
        throw new Error(lastErr || 'Invalid or expired code. Request a new one.');
      }

      setMessage('Verified! Continuing…');
      setMessageOk(true);
      if (onVerified) await onVerified();
    } catch (err: any) {
      setMessage(err?.message || 'Verification failed.');
      setMessageOk(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-5 p-4 rounded-lg border border-[var(--gold-border,#FBBF2444)] bg-[var(--surface2)] space-y-3">
      <div className="text-sm font-semibold" style={{ color: 'var(--gold)' }}>
        Enter verification code
      </div>
      <p className="text-xs text-[var(--text3)]">
        Use the 6–8 digit code from your email (same as the mobile app). You can also open the link in the email.
      </p>
      {message && (
        <div
          className={`p-2 rounded text-xs ${
            messageOk || /sent|inbox|Verified|code already/i.test(message)
              ? 'bg-green-900/30 text-green-400'
              : 'bg-red-900/30 text-red-400'
          }`}
        >
          {message}
        </div>
      )}
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
        onClick={verify}
        disabled={loading}
        className="btn btn-primary w-full py-2.5 disabled:opacity-60"
      >
        {loading ? 'Verifying…' : 'Verify & continue'}
      </button>
      <div className="flex justify-between text-xs">
        <button type="button" onClick={resend} disabled={loading} className="text-[var(--gold)] hover:underline">
          Resend code
        </button>
        <span className="text-[var(--text3)]">Sent to {cleanEmail}</span>
      </div>
    </div>
  );
}
