'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const supabase = getSupabaseClient();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  function isValidEmail(s: string) {
    const e = (s || '').trim();
    if (e.length < 6 || e.length > 254 || /\s/.test(e)) return false;
    return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(e);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      setOk(false);
      setMessage('Enter a valid email address first.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/auth/set-password')}`,
      });
      setOk(!error);
      setMessage(
        error
          ? error.message
          : 'Password reset link sent! Open it to choose a password (check spam).'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>
              Total Service Pro
            </span>
          </Link>
          <p className="text-[var(--text3)] mt-1 text-sm tracking-wide">
            Professional Laser Service Tools
          </p>
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--gold)' }}>
            Forgot password
          </h1>
          <p className="text-sm text-[var(--text3)] mb-6">
            Enter the email on your account. We will send a link to set a new password.
          </p>

          {message && (
            <div
              className={`mb-4 p-3 rounded text-sm ${
                ok ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
              }`}
            >
              {message}
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoCapitalize="off"
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60"
            >
              {loading ? 'Please wait...' : 'Send reset link'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
