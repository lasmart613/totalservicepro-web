'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { claimPendingInvitations, getSupabaseClient } from '@/lib/supabase/client';

/**
 * Invited / recovery users land here after the email link establishes a session.
 * They must set a password before normal email+password login works.
 */
function SetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('Checking your invite…');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Prefer code exchange if present (PKCE invite / recovery)
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) console.warn('set-password code exchange:', exErr.message);
        } else {
          // Hash tokens from older email templates
          const hash = window.location.hash.replace(/^#/, '');
          if (hash) {
            const params = new URLSearchParams(hash);
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token') || '';
            if (access_token) {
              await supabase.auth.setSession({ access_token, refresh_token });
            }
          }
        }

        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user) {
          if (!cancelled) {
            setNoSession(true);
            setMessage('');
            setError(
              'This invite link is missing a session (expired, already used, or redirected incorrectly). ' +
                'Use “Forgot password” on the login page with your invite email to set a password, ' +
                'or ask your admin to resend the invite.'
            );
          }
          return;
        }

        if (!cancelled) {
          setEmail(user.email || '');
          setReady(true);
          setMessage('Create a password for your account, then you can sign in anytime.');
        }
      } catch (e: any) {
        if (!cancelled) {
          setNoSession(true);
          setError(e?.message || 'Could not open invite session.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) throw new Error('Session expired. Open a fresh invite or reset link.');

      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw upErr;

      // Profile + claim team invitation (server uses service role so RLS cannot block org assign)
      const meta = user.user_metadata || {};
      await supabase.from('user_profiles').upsert(
        {
          id: user.id,
          email: user.email,
          first_name: meta.first_name || null,
          last_name: meta.last_name || null,
          onboarding_completed: true,
        },
        { onConflict: 'id' }
      );

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const claimRes = await fetch('/api/team/claim', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        });
        if (!claimRes.ok) {
          // Fallback to client claim
          if (user.email) {
            await claimPendingInvitations(supabase, user.id, user.email);
          }
        }
      } else if (user.email) {
        await claimPendingInvitations(supabase, user.id, user.email);
      }

      // Mark onboarding done if org was claimed
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, onboarding_completed')
        .eq('id', user.id)
        .maybeSingle();

      if (prof?.organization_id && !prof.onboarding_completed) {
        await supabase
          .from('user_profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id);
      }

      // Invited members: short onboarding (company/role locked). Full org onboarding only if no org.
      let dest = '/hub';
      if (prof?.organization_id) {
        if (!prof.onboarding_completed) {
          dest = '/onboarding/member';
        }
      } else {
        dest = '/onboarding';
      }

      const next = searchParams.get('next');
      if (
        next &&
        next.startsWith('/') &&
        !next.startsWith('//') &&
        next !== '/auth/set-password' &&
        next !== '/hub'
      ) {
        // keep explicit next only for non-default destinations
        if (next.startsWith('/onboarding')) dest = next;
      }

      setMessage('Password saved! Redirecting…');
      router.replace(dest);
    } catch (err: any) {
      setError(err?.message || 'Could not save password.');
    } finally {
      setSaving(false);
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
          <p className="text-[var(--text3)] mt-1 text-sm">Team invite — set your password</p>
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--gold)' }}>
            Set your password
          </h1>
          {message && !error && (
            <p className="text-sm text-[var(--text2)] mb-4">{message}</p>
          )}
          {error && (
            <div className="mb-4 p-3 rounded text-sm bg-red-900/30 text-red-400">{error}</div>
          )}

          {noSession ? (
            <div className="space-y-3 text-sm">
              <Link href="/login" className="btn btn-primary w-full justify-center">
                Go to login → Forgot password
              </Link>
              <p className="text-xs text-[var(--text3)] text-center">
                Enter the same email from the invite. The reset email lets you choose a password.
              </p>
            </div>
          ) : ready ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={email} disabled readOnly />
              </div>
              <div>
                <label className="label">New password</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Confirm password</label>
                <input
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <button type="submit" disabled={saving} className="btn btn-primary w-full py-3">
                {saving ? 'Saving…' : 'Save password & continue'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-[var(--text3)]">Please wait…</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[var(--text3)]">
          Loading…
        </div>
      }
    >
      <SetPasswordInner />
    </Suspense>
  );
}
