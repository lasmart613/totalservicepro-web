'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseClient, claimPendingInvitations } from '@/lib/supabase/client';
import { toast } from 'sonner';

/**
 * Light onboarding for team invitees.
 * Org + role are prefilled from the invite and locked.
 * Member fills personal details only (name, phone, title).
 */
export default function MemberOnboardingPage() {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [role, setRole] = useState('fse');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      // Ensure invite is claimed (creates profile + org link)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch('/api/team/claim', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }).catch(() => {});
      }
      if (user.email) {
        await claimPendingInvitations(supabase, user.id, user.email);
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*, organizations(id, name, type)')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile?.organization_id) {
        setError(
          'Your account is not linked to a company yet. Ask your admin to open Company Profile → Refresh / sync invites, then try again.'
        );
        setLoading(false);
        return;
      }

      if (profile.onboarding_completed) {
        router.replace('/hub');
        return;
      }

      const meta = user.user_metadata || {};
      setEmail(user.email || profile.email || '');
      setRole(profile.role || meta.role || 'fse');
      setFirstName(profile.first_name || meta.first_name || '');
      setLastName(profile.last_name || meta.last_name || '');
      setPhone(profile.phone || '');
      setJobTitle(profile.job_title || meta.job_title || '');
      const org = (profile as any).organizations;
      setOrgName(org?.name || 'Your company');
      setLoading(false);
    })();
  }, [router, supabase]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const { error: upErr } = await supabase
        .from('user_profiles')
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || null,
          job_title: jobTitle.trim() || null,
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (upErr) throw upErr;

      await supabase.auth.updateUser({
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        },
      });

      toast.success('Welcome to the team!');
      router.replace('/hub');
    } catch (err: any) {
      setError(err?.message || 'Could not save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--text3)]">
        Loading your invite…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <Link href="/" className="inline-block">
            <span className="font-extrabold text-2xl" style={{ color: 'var(--gold)' }}>
              Total Service Pro
            </span>
          </Link>
          <p className="text-sm text-[var(--text3)] mt-1">Team member setup</p>
        </div>

        <div className="card p-8">
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--gold)' }}>
            Finish joining your team
          </h1>
          <p className="text-sm text-[var(--text3)] mb-6">
            Your company and role were set by your admin. Confirm your details below.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded text-sm bg-red-900/30 text-red-400">{error}</div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="label">Company</label>
              <input className="input opacity-80" value={orgName} disabled readOnly />
              <p className="text-[10px] text-[var(--text3)] mt-1">Set by your invitation — not editable</p>
            </div>

            <div>
              <label className="label">Role</label>
              <input
                className="input opacity-80 capitalize"
                value={(role || 'fse').replace(/_/g, ' ')}
                disabled
                readOnly
              />
            </div>

            <div>
              <label className="label">Email</label>
              <input className="input opacity-80" value={email} disabled readOnly />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First name *</label>
                <input
                  className="input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">Last name *</label>
                <input
                  className="input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="label">Job title</label>
              <input
                className="input"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Field Service Engineer"
              />
            </div>

            <button type="submit" disabled={saving || !!error} className="btn btn-primary w-full py-3">
              {saving ? 'Saving…' : 'Join team & continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
