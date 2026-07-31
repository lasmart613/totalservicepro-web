'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { claimPendingInvitations, getSupabaseClient } from '@/lib/supabase/client';

function safeNextPath(raw: string | null): string {
  if (!raw) return '';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  return raw;
}

/**
 * OAuth / magic-link return URL for the web app.
 * Supabase redirects here with ?code= (PKCE) or #access_token= (implicit).
 * Optional ?next=/admin restores the page the user tried to open.
 */
function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseClient();
  const [message, setMessage] = useState('Completing sign-in…');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const err = url.searchParams.get('error_description') || url.searchParams.get('error');
        let next = safeNextPath(searchParams.get('next') || url.searchParams.get('next'));

        // Invite / recovery emails put type in query or hash
        const hash = window.location.hash.replace(/^#/, '');
        const hashParams = hash ? new URLSearchParams(hash) : null;
        const authType = (
          url.searchParams.get('type') ||
          hashParams?.get('type') ||
          ''
        ).toLowerCase();
        const isInviteOrRecovery =
          authType === 'invite' ||
          authType === 'recovery' ||
          authType === 'signup' ||
          next === '/auth/set-password' ||
          next.startsWith('/auth/set-password');

        if (err) {
          setMessage(err);
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          // Implicit / hash tokens — detectSessionInUrl on client may already have run
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            if (hashParams) {
              const access_token = hashParams.get('access_token');
              const refresh_token = hashParams.get('refresh_token') || '';
              if (access_token) {
                const { error: sErr } = await supabase.auth.setSession({
                  access_token,
                  refresh_token,
                });
                if (sErr) throw sErr;
              }
            }
          }
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setMessage(
            isInviteOrRecovery
              ? 'Invite link did not establish a session. Try Resend invite, or use Forgot password on the login page.'
              : 'Signed in, but no user session found. Try again.'
          );
          return;
        }

        // Invited / password-recovery users must set a password (auth user exists, password may not)
        if (isInviteOrRecovery) {
          setMessage('Almost done — set your password…');
          router.replace('/auth/set-password');
          return;
        }

        // Ensure profile row for Google first-time users
        const meta = user.user_metadata || {};
        const full = (meta.full_name || meta.name || '') as string;
        const parts = full.trim().split(/\s+/).filter(Boolean);
        const first = meta.first_name || parts[0] || '';
        const last = meta.last_name || parts.slice(1).join(' ') || '';

        await supabase.from('user_profiles').upsert(
          {
            id: user.id,
            email: user.email,
            first_name: first || null,
            last_name: last || null,
            avatar_url: meta.avatar_url || meta.picture || null,
          },
          { onConflict: 'id' }
        );

        // Auto-assign org/role from pending engineer_invitations (team invites)
        if (user.email) {
          await claimPendingInvitations(supabase, user.id, user.email);
        }

        let { data: prof } = await supabase
          .from('user_profiles')
          .select('onboarding_completed, organization_id, role')
          .eq('id', user.id)
          .maybeSingle();

        if (cancelled) return;

        // Invited team members already have org — skip full org onboarding
        if (prof?.organization_id && !prof?.onboarding_completed) {
          await supabase
            .from('user_profiles')
            .update({ onboarding_completed: true })
            .eq('id', user.id);
          prof = { ...prof, onboarding_completed: true };
        }

        if (!prof?.organization_id && !prof?.onboarding_completed) {
          setMessage('Signed in! Finishing setup…');
          router.replace('/onboarding');
        } else if (next) {
          setMessage('Signed in! Taking you back…');
          router.replace(next);
        } else {
          setMessage('Signed in! Redirecting…');
          router.replace('/');
        }
      } catch (e: any) {
        console.error('auth callback', e);
        if (!cancelled) {
          setMessage(e?.message || 'Sign-in failed. Please try again.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, supabase, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="card p-8 max-w-md w-full text-center">
        <div className="font-extrabold text-2xl mb-2" style={{ color: 'var(--gold)' }}>
          Total Service Pro
        </div>
        <p className="text-sm text-[var(--text2)] mb-6">{message}</p>
        <Link href="/login" className="btn btn-secondary text-sm">
          Back to login
        </Link>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[var(--text3)]">
          Completing sign-in…
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
