'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useT } from '@/lib/fa/locale';
import { callerMayRemoveTeamMembers, teamMemberRemoveBlocked } from '@/lib/team-remove';

type Props = {
  memberId: string;
  name: string;
  role?: string | null;
  isHome?: boolean | null;
  isFounder?: boolean | null;
  callerId?: string | null;
  callerRole?: string | null;
  organizationId?: number | string | null;
  orgCreatedBy?: string | null;
  onRemoved: () => void | Promise<void>;
};

export function RemoveTeamMemberButton({
  memberId,
  name,
  role,
  isHome,
  isFounder,
  callerId,
  callerRole,
  organizationId,
  orgCreatedBy,
  onRemoved,
}: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const callerIsCreator = !!callerId && !!orgCreatedBy && String(callerId) === String(orgCreatedBy);
  const memberIsCreator = !!orgCreatedBy && String(memberId) === String(orgCreatedBy);
  const visible =
    organizationId != null &&
    organizationId !== '' &&
    callerMayRemoveTeamMembers({
      role: callerRole,
      isOrgCreator: callerIsCreator,
    }) &&
    !teamMemberRemoveBlocked({
      memberId,
      callerId,
      role,
      isHome,
      founder: isFounder === true,
      isOrgCreator: memberIsCreator,
    });
  if (!visible) return null;

  const remove = async () => {
    const label = name.trim() || t('Member');
    if (
      !window.confirm(
        t(
          'Remove {name} from this team? They keep their login and can be invited again. They lose access to this company.'
        ).replace('{name}', label)
      )
    ) {
      return;
    }
    const supabase = getSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error(t('Sign in required.'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/team/members/remove', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: memberId, organizationId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok !== true) {
        if (json.code === 'self') {
          toast.error(t('You cannot remove yourself. Use Leave company instead.'));
        } else {
          toast.error(json.error || t('Could not remove that team member.'));
        }
        return;
      }
      toast.success(
        json.profileStillPointsHere
          ? t('Removed from the team. Their login stays. Their profile still points at this company.')
          : t('Removed from the team. Their login stays.')
      );
      await onRemoved();
    } catch {
      toast.error(t('Could not remove that team member.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="btn btn-secondary text-xs self-start"
      onClick={remove}
      disabled={busy}
    >
      {t('Remove from team')}
    </button>
  );
}
