'use client';
import { useFormatDate } from '@/lib/use-format-date';
import { useSiteLocale, useT } from '@/lib/fa/locale';

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { TestEquipmentRoster } from '@/components/TestEquipmentRoster';
import { canAssignShopTestEquipment, isAdmin } from '@/lib/roles';
import { roleLabel } from '@/lib/labels';
import { teamInviteEmailError, teamInviteSentMessage } from '@/lib/team-invite';
import { invitationIsOpen, INVITABLE_TEAM_ROLES, isPendingTeamInvite, teamMemberRoleChoices } from '@/lib/org-membership';
import { RemoveTeamMemberButton } from '@/components/RemoveTeamMemberButton';

function inviteListStatus(
  inv: {
    id?: number | string;
    accepted?: boolean | null;
    expires_at?: string | null;
    created_at?: string | null;
  },
  byId: Record<string, string>
): string {
  const reported = inv.id != null ? byId[String(inv.id)] : '';
  if (reported === 'expired') return 'Expired';
  if (reported === 'on team') return 'On team';
  if (reported === 'accepted') return 'Accepted';
  if (reported === 'pending') return 'Pending';
  if (inv.accepted === true) return 'Accepted';
  if (!invitationIsOpen(inv)) return 'Expired';
  return 'Pending';
}

export default function TeamManagement() {
  const t = useT();
  const locale = useSiteLocale();
  const { format } = useFormatDate();
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [orgCreatedBy, setOrgCreatedBy] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState('');
  const [newMember, setNewMember] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'fse',
    jobTitle: '',
  });
  const [adding, setAdding] = useState(false);
  const [inviteStatusById, setInviteStatusById] = useState<Record<string, string>>({});
  const supabase = getSupabaseClient();

  const fetchTeam = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setUserId(user.id);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    setUserRole(String(profile?.role || ''));

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
          if (Array.isArray(json.invites)) {
            const map: Record<string, string> = {};
            for (const inv of json.invites) {
              if (inv?.id != null && inv.status) map[String(inv.id)] = String(inv.status);
            }
            setInviteStatusById(map);
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
          setOrgCreatedBy(json.organizationCreatedBy ? String(json.organizationCreatedBy) : null);
          if (Array.isArray(json.pendingInvites)) {
            setPendingInvites(json.pendingInvites.filter((inv) => isPendingTeamInvite(inv)));
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
        .select('id, first_name, last_name, email, role, job_title, created_at, onboarding_completed')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });
      setTeamMembers(members || []);
    }

    const { data: invites } = await supabase
      .from('engineer_invitations')
      .select('id, email, role, first_name, last_name, created_at, expires_at, accepted')
      .eq('organization_id', profile.organization_id)
      .eq('accepted', false)
      .order('created_at', { ascending: false });

    setPendingInvites((invites || []).filter((inv) => isPendingTeamInvite(inv)));
    setLoading(false);
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailError = teamInviteEmailError(newMember.email);
    if (emailError) {
      toast.error(emailError, { duration: 15000 });
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
      const inviteEmail = newMember.email;
      if (!res.ok || json.ok === false || !json.emailed) {
        throw new Error(
          json.error ||
            json.message ||
            `Could not email the invite to ${inviteEmail}. No link was created. Try again.`
        );
      }

      toast.success(json.message || teamInviteSentMessage(inviteEmail), { duration: 15000 });

      setNewMember({
        email: '',
        firstName: '',
        lastName: '',
        role: 'fse',
        jobTitle: '',
      });
      await fetchTeam();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add team member', { duration: 15000 });
    } finally {
      setAdding(false);
    }
  };

  const changeMemberRole = async (memberId: string, role: string) => {
    if (!orgId || !memberId) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      toast.error(t('Sign in required.'));
      return;
    }
    const { postMemberRole } = await import('@/lib/org-founder-client');
    const result = await postMemberRole(token, {
      userId: memberId,
      organizationId: orgId,
      role,
    });
    if (!result.ok) {
      toast.error(result.error || t('Could not change that role.'));
      return;
    }
    setTeamMembers((prev) =>
      prev.map((row) => (row.id === memberId ? { ...row, role: result.role || role } : row))
    );
    toast.success(t('Role updated'));
  };

  const resendInvite = async (email: string, role?: string) => {
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
        body: JSON.stringify({ email, role: role || 'fse', resend: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false || !json.emailed) {
        throw new Error(
          json.error || json.message || `Could not email the invite to ${email}. No link was created. Try again.`
        );
      }
      toast.success(json.message || teamInviteSentMessage(email), { duration: 15000 });
      await fetchTeam();
    } catch (e: any) {
      toast.error(e.message || 'Resend failed', { duration: 15000 });
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">{t('Team Management')}</h1>
      <p className="text-[var(--text3)] mb-8" dir="auto">
        <bdi>
          {t('Invite FSEs and staff. An email that already owns another shop is valid — they keep their home org and join this company only after they accept.')}
        </bdi>
      </p>

      <div className="card p-6 mb-10">
        <h2 className="font-bold text-xl mb-4">{t('Invite Team Member')}</h2>
        <p className="text-xs text-[var(--text3)] mb-4">
          {t('The invite is emailed to them. They sign in with that address to join.')}
        </p>

        <form
          onSubmit={handleAddMember}
          noValidate
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div>
            <label className="label">{t('Email Address *')}</label>
            <input
              type="email"
              className="input"
              value={newMember.email}
              onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">{t('Role')}</label>
            <select
              className="select"
              value={newMember.role}
              onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}
            >
              {INVITABLE_TEAM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role, locale)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">{t('First Name')}</label>
            <input
              className="input"
              value={newMember.firstName}
              onChange={(e) => setNewMember({ ...newMember, firstName: e.target.value })}
            />
          </div>

          <div>
            <label className="label">{t('Last Name')}</label>
            <input
              className="input"
              value={newMember.lastName}
              onChange={(e) => setNewMember({ ...newMember, lastName: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <label className="label">{t('Job Title')}</label>
            <input
              className="input"
              value={newMember.jobTitle}
              onChange={(e) => setNewMember({ ...newMember, jobTitle: e.target.value })}
              placeholder={t('e.g. Senior Field Service Engineer')}
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={adding}
              className="btn btn-primary w-full md:w-auto px-8"
            >
              {adding ? t('Sending invite…') : t('Send Invite Email')}
            </button>
            <p className="text-xs text-[var(--text3)] mt-2" dir="auto">
              <bdi>
                {t('Sends a RepairPlanet invite email. Existing users (including shop owners) join when they sign in and accept — default FSE — and keep their home shop. New users set a password from the email.')}
              </bdi>
            </p>
          </div>
        </form>
      </div>

      {pendingInvites.length > 0 && (
        <div className="card p-6 mb-10">
          <h2 className="font-bold text-xl mb-4">{t('Pending Invites ({count})').replace('{count}', String(pendingInvites.length))}</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-sm text-[var(--text3)]">
                  <th className="py-3 px-4">{t('Name')}</th>
                  <th className="py-3 px-4">{t('Email')}</th>
                  <th className="py-3 px-4">{t('Role')}</th>
                  <th className="py-3 px-4">{t('Invited')}</th>
                  <th className="py-3 px-4">{t('Status')}</th>
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
                    <td className="py-3 px-4 text-sm">{roleLabel(inv.role || 'fse', locale)}</td>
                    <td className="py-3 px-4 text-sm text-[var(--text3)]">
                      {inv.created_at ? format(inv.created_at) : '—'}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {t(inviteListStatus(inv, inviteStatusById))}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        className="btn btn-secondary text-xs"
                        onClick={() => resendInvite(inv.email, inv.role)}
                      >
                        {t('Resend email')}
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
        <h2 className="font-bold text-xl mb-4">{t('Current Team ({count})').replace('{count}', String(teamMembers.length))}</h2>

        {loading ? (
          <div className="text-center py-8 text-[var(--text3)]">{t('Loading team...')}</div>
        ) : teamMembers.length === 0 ? (
          <div className="text-center py-8 text-[var(--text3)]">{t('No team members yet.')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-sm text-[var(--text3)]">
                  <th className="py-3 px-4">{t('Name')}</th>
                  <th className="py-3 px-4">{t('Email')}</th>
                  <th className="py-3 px-4">{t('Role')}</th>
                  <th className="py-3 px-4">{t('Job Title')}</th>
                  <th className="py-3 px-4">{t('Joined')}</th>
                  <th className="py-3 px-4"></th>
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
                      {member.onboarding_completed !== true && (
                        <div className="text-[10px] font-normal text-[var(--text3)] mt-0.5">{t('Setup not finished')}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm">{member.email}</td>
                    <td className="py-3 px-4">
                      {(isAdmin(userRole) || userRole === 'owner') && member.id !== userId && member.role !== 'owner' && member.role !== 'admin' ? (
                        <select
                          className="select text-xs"
                          aria-label={t('Role for {name}').replace('{name}', member.email || member.first_name || t('Member'))}
                          value={member.role || 'fse'}
                          onChange={(e) => changeMemberRole(String(member.id), e.target.value)}
                        >
                          {teamMemberRoleChoices(member.role).map((role) => (
                            <option key={role} value={role}>
                              {roleLabel(role, locale)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded-full bg-[var(--surface3)]">
                          {roleLabel(member.role, locale)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-[var(--text3)]">
                      {member.job_title || '—'}
                    </td>
                    <td className="py-3 px-4 text-sm text-[var(--text3)]">
                      {member.created_at
                        ? format(member.created_at)
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {member.onboarding_completed !== true && member.email ? (
                          <button
                            type="button"
                            className="btn btn-secondary text-xs"
                            onClick={() => resendInvite(member.email, member.role)}
                          >{t('Resend invite email')}</button>
                        ) : null}
                        {member.id ? (
                          <RemoveTeamMemberButton
                            memberId={String(member.id)}
                            name={[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || ''}
                            role={member.role}
                            isFounder={member.is_founder === true || member.founder === true}
                            callerId={userId}
                            callerRole={
                              teamMembers.find((row) => row.id && String(row.id) === String(userId))?.role ?? null
                            }
                            organizationId={orgId}
                            orgCreatedBy={orgCreatedBy}
                            onRemoved={fetchTeam}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TestEquipmentRoster
        orgId={orgId}
        userId={userId}
        members={teamMembers.map((m) => ({
          id: String(m.id),
          name:
            [m.first_name, m.last_name].filter(Boolean).join(' ') ||
            m.email ||
            'Team member',
          role: m.role,
        }))}
        canAssign={canAssignShopTestEquipment(userRole)}
      />
    </div>
  );
}
