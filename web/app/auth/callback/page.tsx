'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { claimPendingInvitations, getSupabaseClient } from '@/lib/supabase/client';
import { applyPendingSignup, resolvePendingSignup } from '@/lib/pending-signup';
import { claimCustomerInvite } from '@/lib/customer-invite-client';
import { destAfterInviteClaim, inviteInPlay, type InviteClaimResult } from '@/lib/invite-claim';

function safeNextPath(raw: string | null): string {
  if (!raw) return '';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  return raw;
}

/** Never dump Supabase project URLs, JWTs, or keys into the UI. */
function publicAuthMessage(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return 'Sign-in failed. Please try again.';
  if (
    /supabase\.co|yljztfaj|anon key|service_role|jwt|apikey|NEXT_PUBLIC_|eyJ[A-Za-z0-9_-]{20,}/i.test(
      s
    )
  ) {
    return 'Sign-in failed. Please try again or use the login page.';
  }
  return s;
}

function isInviteAuthType(authType: string): boolean {
  return authType === 'invite' || authType === 'recovery' || authType === 'magiclink';
}

/**
 * OAuth / magic-link / email-confirm return URL.
 * type=signup is email confirm for a user who already chose a password — never a team invite.
 */
function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseClient();
  const [message, setMessage] = useState('Completing sign-in…');
  const [appHandoff, setAppHandoff] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const err = url.searchParams.get('error_description') || url.searchParams.get('error');
        let next = safeNextPath(searchParams.get('next') || url.searchParams.get('next'));
        const wantApp =
          url.searchParams.get('app') === '1' || searchParams.get('app') === '1';

        const hash = window.location.hash.replace(/^#/, '');
        const hashParams = hash ? new URLSearchParams(hash) : null;
        const authType = (
          url.searchParams.get('type') ||
          hashParams?.get('type') ||
          ''
        ).toLowerCase();

        // Confirm-signup emails set type=signup. That is NOT an invite, even if
        // a stale next=/auth/set-password is present.
        const isSignupConfirm = authType === 'signup';
        const isPasswordResetDest =
          next === '/auth/set-password' ||
          next.startsWith('/auth/set-password') ||
          next === '/reset-password' ||
          next.startsWith('/reset-password');

        const isInviteOrRecovery =
          !isSignupConfirm &&
          (isInviteAuthType(authType) || isPasswordResetDest);

        if (isSignupConfirm && isPasswordResetDest) {
          next = '/onboarding';
        }

        if (err) {
          setMessage(publicAuthMessage(err));
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
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

        const meta = user.user_metadata || {};
        const invitedMember = !!(meta as any).invited_member || authType === 'invite';

        // Claim before routing. Invite + Forgot password used to skip this and
        // send people through founder onboarding with the invite still pending.
        let claimResult: InviteClaimResult | null = null;
        if (user.email && !isSignupConfirm) {
          claimResult = await claimPendingInvitations(supabase, user.id, user.email);
        }

        // Invited / password-recovery users must set a password.
        // type=signup never belongs here — they already chose a password at signup.
        if (isInviteOrRecovery || (invitedMember && !isSignupConfirm && !meta.role?.includes('admin') && meta.role !== 'owner' && meta.role !== 'parts_supplier')) {
          if (isInviteOrRecovery || invitedMember) {
            setMessage('Almost done — set your password…');
            router.replace('/auth/set-password');
            return;
          }
        }

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

        // Clinic Directory invite — claim existing customer org before creating a new one.
        const claimToken =
          searchParams.get('claim') ||
          url.searchParams.get('claim') ||
          String((meta as { claim_token?: string }).claim_token || '');
        if (claimToken) {
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData.session?.access_token) {
            const claimed = await claimCustomerInvite(sessionData.session.access_token, claimToken);
            if (claimed.claimed) {
              if (cancelled) return;
              setMessage('Clinic profile claimed. Continuing…');
              router.replace('/company?justSetup=1');
              return;
            }
          }
        }

        // Finish org creation from localStorage OR user_metadata (new-tab Gmail confirm).
        // Never create a new shop when a team invite is in play.
        const pending = inviteInPlay(claimResult) ? null : resolvePendingSignup(user);
        if (pending && pending.email?.toLowerCase() === (user.email || '').toLowerCase() && pending.email) {
          try {
            setMessage('Creating your organization…');
            const applied = await applyPendingSignup(supabase, user.id, pending);
            if (cancelled) return;
            const dest = applied.dest || '/onboarding';
            if (wantApp) {
              await maybeHandoffToAndroid(supabase, dest, setAppHandoff, setMessage);
              if (cancelled) return;
            }
            setMessage('Signed in! Continuing setup…');
            router.replace(dest);
            return;
          } catch (setupErr: any) {
            console.warn('pending signup apply', setupErr);
            setMessage(
              publicAuthMessage(setupErr?.message) ||
                'Could not finish organization setup. Continue onboarding.'
            );
          }
        }

        // Auto-assign org/role from pending engineer_invitations (team invites only)
        if (!claimResult && user.email && !isSignupConfirm) {
          claimResult = await claimPendingInvitations(supabase, user.id, user.email);
        }

        let { data: prof } = await supabase
          .from('user_profiles')
          .select('onboarding_completed, organization_id, role, first_name, last_name')
          .eq('id', user.id)
          .maybeSingle();

        if (cancelled) return;

        const founderRoles = new Set(['company_admin', 'admin', 'owner', 'parts_supplier']);
        const metaRole = String(meta.role || '').toLowerCase();
        const isFounder =
          founderRoles.has(String(prof?.role || '').toLowerCase()) ||
          founderRoles.has(metaRole) ||
          meta.organization_type === 'service_company';

        // If trigger defaulted them to fse but metadata says they are a founder, restore role
        if (
          isFounder &&
          prof &&
          (!prof.role || String(prof.role).toLowerCase() === 'fse') &&
          metaRole &&
          founderRoles.has(metaRole)
        ) {
          await supabase.from('user_profiles').update({ role: metaRole }).eq('id', user.id);
          prof = { ...prof, role: metaRole };
        }

        // Only auto-complete for invitees — founders still need the wizard
        if (prof?.organization_id && !prof?.onboarding_completed && invitedMember && !isFounder) {
          await supabase
            .from('user_profiles')
            .update({ onboarding_completed: true })
            .eq('id', user.id);
          prof = { ...prof, onboarding_completed: true };
        }

        let dest = '/';
        if (inviteInPlay(claimResult)) {
          dest = destAfterInviteClaim(claimResult, '/onboarding/member');
        } else if (!prof?.organization_id || (isFounder && !prof?.onboarding_completed)) {
          dest = '/onboarding';
        } else if (next && next !== '/auth/set-password') {
          dest = next;
        }

        if (wantApp) {
          await maybeHandoffToAndroid(supabase, dest, setAppHandoff, setMessage);
          if (cancelled) return;
        }

        setMessage(dest.startsWith('/onboarding') ? 'Signed in! Finishing setup…' : 'Signed in! Redirecting…');
        router.replace(dest);
      } catch (e: any) {
        console.error('auth callback', e);
        if (!cancelled) {
          setMessage(publicAuthMessage(e?.message) || 'Sign-in failed. Please try again.');
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
        {appHandoff && (
          <a href={appHandoff} className="btn btn-primary text-sm mb-3 inline-flex">
            Open in the Total Service Pro app
          </a>
        )}
        <Link href="/login" className="btn btn-secondary text-sm">
          Back to login
        </Link>
      </div>
    </div>
  );
}

async function maybeHandoffToAndroid(
  supabase: ReturnType<typeof getSupabaseClient>,
  dest: string,
  setAppHandoff: (v: string) => void,
  setMessage: (v: string) => void
) {
  try {
    const { data } = await supabase.auth.getSession();
    const access = data.session?.access_token;
    const refresh = data.session?.refresh_token || '';
    if (!access) return;
    const deep =
      `totalservicepro://auth-callback#access_token=${encodeURIComponent(access)}` +
      `&refresh_token=${encodeURIComponent(refresh)}&next=${encodeURIComponent(dest)}&type=signup`;
    setAppHandoff(deep);
    setMessage('Opening the Total Service Pro app… If nothing happens, tap the button below.');
    window.location.href = deep;
    await new Promise((r) => setTimeout(r, 900));
  } catch {
    /* stay on web */
  }
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
