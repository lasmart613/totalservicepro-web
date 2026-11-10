'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { changePasswordWithReauth } from '@/lib/change-password';
import { useT } from '@/lib/fa/locale';
import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * Auth email (read-only) and a password change that re-checks the current
 * password before supabase.auth.updateUser.
 */
export function AccountSecurity() {
  const t = useT();
  const supabase = getSupabaseClient();
  const [email, setEmail] = useState('');
  const [emailReady, setEmailReady] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setEmail(user?.email || '');
      setEmailReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

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

  return (
    <div className="space-y-4">
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
          autoComplete="username"
          aria-readonly="true"
        />
        <p className="text-[10px] text-[var(--text3)] mt-1">
          {t('This is the email you use to sign in. It cannot be changed here.')}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
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
    </div>
  );
}
