'use client';

import React, { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { signOutAndClearIdentity } from '@/lib/auth-session';
import {
  pendingLoginEmail,
  profileEmailToSync,
  requestLoginEmailChange,
  type AuthEmailUser,
} from '@/lib/change-email';
import { changePasswordWithReauth } from '@/lib/change-password';
import { useT } from '@/lib/fa/locale';
import { clientAuthOrigin } from '@/lib/site-origin';
import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * One Account and security block: auth email, password, and other sessions.
 * The login email is getUser(), not user_profiles.email. A new address is
 * stored on the profile only after Supabase confirms it.
 */
export function AccountSecurity() {
  const t = useT();
  const supabase = getSupabaseClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState('');
  const [emailReady, setEmailReady] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [draftEmail, setDraftEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailNotice, setEmailNotice] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [othersError, setOthersError] = useState('');
  const [othersOk, setOthersOk] = useState('');
  const [othersBusy, setOthersBusy] = useState(false);

  function applyUser(user: AuthEmailUser | null | undefined, id?: string | null) {
    setEmail(String(user?.email || '').trim());
    setPending(pendingLoginEmail(user));
    if (id) setUserId(id);
    setEmailReady(true);
  }

  async function syncProfileEmail(user: User | null) {
    if (!user?.id) return;
    const { data, error: readError } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('id', user.id)
      .maybeSingle();
    if (readError) {
      console.warn('profile email read', readError.message);
      return;
    }
    const next = profileEmailToSync(user, data?.email ?? null);
    if (!next) return;
    const { error: writeError } = await supabase.from('user_profiles').update({ email: next }).eq('id', user.id);
    if (writeError) console.warn('profile email sync', writeError.message);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      applyUser(user, user?.id ?? null);
      if (user) await syncProfileEmail(user);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'USER_UPDATED' || !session?.user) return;
      applyUser(session.user, session.user.id);
      if (!pendingLoginEmail(session.user)) void syncProfileEmail(session.user);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // syncProfileEmail closes over the stable browser client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError('');
    setEmailNotice('');
    setEmailSaving(true);
    try {
      const result = await requestLoginEmailChange(
        {
          updateUser: (attributes, options) => supabase.auth.updateUser(attributes, options),
        },
        {
          currentEmail: email,
          nextEmail: draftEmail,
          emailRedirectTo: `${clientAuthOrigin()}/profile`,
        },
      );
      if (!result.ok) {
        setEmailError(result.error);
        return;
      }
      setEmail(result.email);
      setPending(result.pending);
      setEditingEmail(false);
      setDraftEmail('');
      if (result.pending) {
        setEmailNotice(
          t('Waiting for confirmation of {email}. Your login email stays the same until you confirm.').replace(
            '{email}',
            result.pending,
          ),
        );
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) await syncProfileEmail(user);
      const msg = t('Login email updated.');
      setEmailNotice(msg);
      toast.success(msg);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setEmailError(message || 'Could not start the email change.');
    } finally {
      setEmailSaving(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const result = await changePasswordWithReauth(
        {
          signInWithPassword: (credentials) => supabase.auth.signInWithPassword(credentials),
          updateUser: (attributes) => supabase.auth.updateUser(attributes),
        },
        {
          email,
          currentPassword,
          nextPassword,
          confirmPassword,
        }
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      toast.success(t('Password updated'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(message || 'Could not change password.');
    } finally {
      setSaving(false);
    }
  }

  async function signOutOthers() {
    setOthersError('');
    setOthersOk('');
    setOthersBusy(true);
    try {
      const revoked = await signOutAndClearIdentity(supabase, { scope: 'others' });
      if (!revoked) {
        setOthersError(t('Could not sign out other devices.'));
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setOthersError(t('Could not sign out other devices.'));
        return;
      }
      const msg = t('Signed out of other devices. This device stays signed in.');
      setOthersOk(msg);
      toast.success(msg);
    } finally {
      setOthersBusy(false);
    }
  }

  const pendingText = pending
    ? t('Waiting for confirmation of {email}. Your login email stays the same until you confirm.').replace(
        '{email}',
        pending,
      )
    : '';

  return (
    <section className="space-y-4" aria-labelledby="account-security-heading">
      <h2 id="account-security-heading" className="text-lg font-bold">
        {t('Account and security')}
      </h2>

      <div>
        <label className="label" htmlFor="sign-in-email">
          {t('Sign-in email')}
        </label>
        <input
          id="sign-in-email"
          className="input"
          type="email"
          value={emailReady ? email : ''}
          placeholder={emailReady ? '' : t('Loading…')}
          readOnly
          disabled
          autoComplete="username"
          aria-readonly="true"
        />
        <p className="text-[10px] text-[var(--text3)] mt-1">
          {t('This is the email you use to sign in.')}
        </p>
        {pendingText && (
          <p className="mt-3 p-3 rounded text-sm bg-amber-900/30 text-amber-200" role="status">
            {pendingText}
          </p>
        )}
        {emailNotice && !pendingText && (
          <p className="mt-3 p-3 rounded text-sm bg-green-900/30 text-green-400" role="status">
            {emailNotice}
          </p>
        )}
        {emailError && (
          <p className="mt-3 p-3 rounded text-sm bg-red-900/30 text-red-400" role="alert">
            {t(emailError)}
          </p>
        )}
        {editingEmail ? (
          <form onSubmit={onEmailSubmit} className="mt-3 space-y-3">
            <div>
              <label className="label" htmlFor="new-login-email">
                {t('New email')}
              </label>
              <input
                id="new-login-email"
                className="input"
                type="email"
                value={draftEmail}
                onChange={(e) => setDraftEmail(e.target.value)}
                autoComplete="email"
                autoCapitalize="off"
                required
                aria-describedby="new-login-email-hint"
              />
              <p id="new-login-email-hint" className="text-[10px] text-[var(--text3)] mt-1">
                {t('A confirmation link will be emailed to the new address.')}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary flex-1" disabled={emailSaving || !emailReady}>
                {emailSaving ? t('Loading…') : t('Send confirmation')}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={emailSaving}
                onClick={() => {
                  setEditingEmail(false);
                  setDraftEmail('');
                  setEmailError('');
                }}
              >
                {t('Cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-secondary mt-3 w-full"
            disabled={!emailReady}
            onClick={() => {
              setEditingEmail(true);
              setEmailError('');
              setEmailNotice('');
            }}
          >
            {t('Change email')}
          </button>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-3 pt-4 border-t border-[var(--border)]">
        <div className="font-semibold">{t('Change password')}</div>
        <p className="text-[10px] text-[var(--text3)]">
          {t('Enter your current password, then choose a new one.')}
        </p>
        {error && (
          <div className="p-3 rounded text-sm bg-red-900/30 text-red-400" role="alert">
            {t(error)}
          </div>
        )}
        <div>
          <label className="label" htmlFor="current-password">
            {t('Current password')}
          </label>
          <input
            id="current-password"
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="new-password">
            {t('New password')}
          </label>
          <input
            id="new-password"
            className="input"
            type="password"
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm-new-password">
            {t('Confirm new password')}
          </label>
          <input
            id="confirm-new-password"
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={saving || !emailReady}>
          {saving ? t('Loading…') : t('Update password')}
        </button>
      </form>

      <div className="pt-4 border-t border-[var(--border)]">
        <div className="font-semibold">{t('Sign out of other devices')}</div>
        <p className="text-[10px] text-[var(--text3)] mt-1 mb-3">
          {t('Ends other sessions. This device stays signed in.')}
        </p>
        {othersError && (
          <p className="mb-3 p-3 rounded text-sm bg-red-900/30 text-red-400" role="alert">
            {othersError}
          </p>
        )}
        {othersOk && (
          <p className="mb-3 p-3 rounded text-sm bg-green-900/30 text-green-400" role="status">
            {othersOk}
          </p>
        )}
        <button
          type="button"
          className="btn btn-secondary w-full"
          disabled={othersBusy || !userId}
          onClick={signOutOthers}
        >
          {othersBusy ? t('Loading…') : t('Sign out of other devices')}
        </button>
      </div>
    </section>
  );
}
