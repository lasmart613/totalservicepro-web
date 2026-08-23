'use client';

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

const ROLES = [
  'fse',
  'dispatcher',
  'company_admin',
  'service_manager',
  'admin',
  'scheduler',
  'technician',
  'viewer',
];

export default function TeamManagement() {
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [newMember, setNewMember] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'fse',
    jobTitle: '',
  });
  const [adding, setAdding] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  const fetchTeam = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      setLoading(false);
      return;
    }

    setOrgId(profile.organization_id);

    let syncedMembers: any[] | null = null;

    // Sync invitations → profiles (fixes invitees missing organization_id)
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const syncRes = await fetch('/api/team/sync', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        });
        if (syncRes.ok) {
          const json = await syncRes.json();
          if (Array.isArray(json.members)) {
            syncedMembers = json.members;
          }
          if (json.linked > 0) {
            toast.success(json.message || `Linked ${json.linked} member(s)`);
          }
        }
      }
    } catch (e) {
      console.warn('team sync', e);
    }

    // Always prefer dedicated list API (full roster via service role)
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const listRes = await fetch('/api/team/list', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (listRes.ok) {
          const json = await listRes.json();
          if (Array.isArray(json.members)) {
            setTeamMembers(json.members);
          }
          if (Array.isArray(json.pendingInvites)) {
            setPendingInvites(json.pendingInvites);
          }
          if (Array.isArray(json.members) || Array.isArray(json.pendingInvites)) {
            setLoading(false);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('team list', e);
    }

    if (syncedMembers) {
      setTeamMembers(syncedMembers);
    } else {
      const { data: members } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email, role, job_title, created_at')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });
      setTeamMembers(members || []);
    }

    const { data: invites } = await supabase
      .from('engineer_invitations')
      .select('id, email, role, first_name, last_name, created_at, accepted')
      .eq('organization_id', profile.organization_id)
      .eq('accepted', false)
      .order('created_at', { ascending: false });

    setPendingInvites(invites || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember.email) {
      toast.error('Email is required');
      return;
    }

    setAdding(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not logged in');

      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: newMember.email,
          role: newMember.role,
          firstName: newMember.firstName,
          lastName: newMember.lastName,
          jobTitle: newMember.jobTitle,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to invite team member');
      }

      const inviteEmail = newMember.email;
      if (json.inviteUrl) {
        setLastInviteUrl(json.inviteUrl);
        setLastInviteEmail(inviteEmail);
      } else {
        setLastInviteUrl(null);
        setLastInviteEmail(null);
      }

      if (json.emailed) {
        toast.success(json.message || `Invite email sent to ${inviteEmail}`, {
          description: json.inviteUrl
            ? 'Also copy the invite link below if email is delayed/spam-filtered.'
            : undefined,
          duration: 10000,
        });
      } else if (json.linked) {
        toast.success(json.message || 'User linked to your organization');
      } else if (json.rateLimited) {
        toast.error(
          json.message ||
            'Invite email could not be sent right now. Copy the invite link and send it yourself.',
          { duration: 15000 }
        );
      } else {
        toast.message(json.message || 'Invitation saved (email may not have been sent)', {
          description: json.warning || undefined,
          duration: 12000,
        });
      }

      if (json.inviteUrl && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(json.inviteUrl);
          toast.message('Invite link copied to clipboard', { duration: 5000 });
        } catch {
          /* ignore */
        }
      }

      setNewMember({
        email: '',
        firstName: '',
        lastName: '',
        role: 'fse',
        jobTitle: '',
      });
      await fetchTeam();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add team member');
    } finally {
      setAdding(false);
    }
  };

  const resendInvite = async (email: string) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not logged in');

      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email, role: 'fse' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Resend failed');
      if (json.inviteUrl) {
        setLastInviteUrl(json.inviteUrl);
        setLastInviteEmail(email);
        try {
          await navigator.clipboard.writeText(json.inviteUrl);
          toast.message('Invite link copied to clipboard');
        } catch {
          /* ignore */
        }
      }
      if (json.emailed) toast.success(`Invite re-sent to ${email}`);
      else if (json.rateLimited) {
        toast.error(
          json.message ||
            'Invite email could not be sent. Use the copied invite link instead.',
          { duration: 12000 }
        );
      } else toast.message(json.message || 'Could not send email', { duration: 8000 });
      await fetchTeam();
    } catch (e: any) {
      toast.error(e.message || 'Resend failed');
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">Team Management</h1>
      <p className="text-[var(--text3)] mb-8">
        Invite FSEs and staff. They get an email to join your organization.
      </p>

      <div className="card p-6 mb-10">
        <h2 className="font-bold text-xl mb-4">Invite Team Member</h2>
        <p className="text-xs text-[var(--text3)] mb-4">
          If the invite email is delayed or doesn&apos;t arrive, copy the invite link and send it to them directly.
        </p>

        {lastInviteUrl && (
          <div className="mb-4 p-3 rounded border border-[var(--gold)] bg-[var(--gold)]/10 text-sm">
            <div className="font-semibold mb-1">
              Invite link for {lastInviteEmail || 'team member'}
            </div>
            <div className="text-xs break-all text-[var(--text2)] mb-2">{lastInviteUrl}</div>
            <button
              type="button"
              className="btn btn-primary text-xs"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(lastInviteUrl);
                  toast.success('Invite link copied');
                } catch {
                  toast.message('Copy failed — select the link manually');
                }
              }}
            >
              Copy invite link
            </button>
          </div>
        )}

        <form onSubmit={handleAddMember} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Email Address *</label>
            <input
              type="email"
              className="input"
              value={newMember.email}
              onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">Role</label>
            <select
              className="select"
              value={newMember.role}
              onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">First Name</label>
            <input
              className="input"
              value={newMember.firstName}
              onChange={(e) => setNewMember({ ...newMember, firstName: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Last Name</label>
            <input
              className="input"
              value={newMember.lastName}
              onChange={(e) => setNewMember({ ...newMember, lastName: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <label className="label">Job Title</label>
            <input
              className="input"
              value={newMember.jobTitle}
              onChange={(e) => setNewMember({ ...newMember, jobTitle: e.target.value })}
              placeholder="e.g. Senior Field Service Engineer"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={adding}
              className="btn btn-primary w-full md:w-auto px-8"
            >
              {adding ? 'Sending invite…' : 'Send Invite Email'}
            </button>
            <p className="text-xs text-[var(--text3)] mt-2">
              Sends a RepairPlanet invite email. After they accept, they join your org automatically.
            </p>
          </div>
        </form>
      </div>

      {pendingInvites.length > 0 && (
        <div className="card p-6 mb-10">
          <h2 className="font-bold text-xl mb-4">Pending Invites ({pendingInvites.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-sm text-[var(--text3)]">
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Invited</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--border)]">
                    <td className="py-3 px-4">
                      {[inv.first_name, inv.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="py-3 px-4 text-sm">{inv.email}</td>
                    <td className="py-3 px-4 capitalize text-sm">{inv.role || 'fse'}</td>
                    <td className="py-3 px-4 text-sm text-[var(--text3)]">
                      {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        className="btn btn-secondary text-xs"
                        onClick={() => resendInvite(inv.email)}
                      >
                        Resend email
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="font-bold text-xl mb-4">Current Team ({teamMembers.length})</h2>

        {loading ? (
          <div className="text-center py-8 text-[var(--text3)]">Loading team...</div>
        ) : teamMembers.length === 0 ? (
          <div className="text-center py-8 text-[var(--text3)]">No team members yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-sm text-[var(--text3)]">
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Job Title</th>
                  <th className="py-3 px-4">Joined</th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b border-[var(--border)] hover:bg-[var(--surface3)]"
                  >
                    <td className="py-3 px-4 font-medium">
                      {member.first_name} {member.last_name}
                    </td>
                    <td className="py-3 px-4 text-sm">{member.email}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 text-xs rounded-full bg-[var(--surface3)] capitalize">
                        {member.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-[var(--text3)]">
                      {member.job_title || '—'}
                    </td>
                    <td className="py-3 px-4 text-sm text-[var(--text3)]">
                      {member.created_at
                        ? new Date(member.created_at).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
