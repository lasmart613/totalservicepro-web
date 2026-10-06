import { invitationIsOpen } from '@/lib/org-membership';

/** Fresh invite and resend both last 7 days. */
export const TEAM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TeamSyncStatus = 'pending' | 'expired' | 'accepted' | 'on team';

export type TeamInviteJoinGate =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 409 | 410;
      code: 'email_mismatch' | 'unconfirmed' | 'accepted' | 'expired';
      error: string;
    };

type InviteRow = {
  accepted?: boolean | null;
  expires_at?: string | null;
  created_at?: string | null;
};

/**
 * Fields written on a new invite and on resend.
 * Clears accepted state so a previously used or expired row can be claimed again.
 */
export function freshTeamInviteFields(now = Date.now()): {
  accepted: false;
  accepted_at: null;
  expires_at: string;
} {
  return {
    accepted: false,
    accepted_at: null,
    expires_at: new Date(now + TEAM_INVITE_TTL_MS).toISOString(),
  };
}

/**
 * Report-only status for the Team page. Never implies a membership write.
 * On team wins over accepted so a current member is not shown as a pending join.
 */
export function teamSyncInviteStatus(
  row: InviteRow & { onTeam?: boolean },
  now = Date.now()
): TeamSyncStatus {
  if (row.onTeam) return 'on team';
  if (row.accepted === true) return 'accepted';
  if (!invitationIsOpen(row, now)) return 'expired';
  return 'pending';
}

/**
 * A membership may be created only for an unaccepted invite whose expires_at
 * is still in the future (NULL expires_at follows invitationIsOpen: open for
 * 14 days after created_at, matching accept_team_invite), whose email is the
 * signed-in login email, and whose Auth user has email_confirmed_at set.
 */
export function teamInviteJoinGate(input: {
  accepted?: boolean | null;
  expires_at?: string | null;
  created_at?: string | null;
  inviteEmail?: string | null;
  callerEmail?: string | null;
  emailConfirmedAt?: string | null;
  now?: number;
}): TeamInviteJoinGate {
  const now = input.now ?? Date.now();
  const row: InviteRow = {
    accepted: input.accepted,
    expires_at: input.expires_at,
    created_at: input.created_at,
  };

  if (row.accepted === true) {
    return {
      ok: false,
      status: 409,
      code: 'accepted',
      error: 'This invitation was already accepted.',
    };
  }

  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : Number.NaN;
  const expiresInFuture = Number.isFinite(expiresAt) && expiresAt > now;
  if (row.expires_at && !expiresInFuture) {
    return {
      ok: false,
      status: 410,
      code: 'expired',
      error: 'This invitation has expired.',
    };
  }
  if (!invitationIsOpen(row, now)) {
    return {
      ok: false,
      status: 410,
      code: 'expired',
      error: 'This invitation has expired.',
    };
  }

  const caller = String(input.callerEmail || '').toLowerCase().trim();
  const invite = String(input.inviteEmail || '').toLowerCase().trim();
  if (!caller || !invite || caller !== invite) {
    return {
      ok: false,
      status: 403,
      code: 'email_mismatch',
      error: 'This invitation is for a different account.',
    };
  }

  if (!input.emailConfirmedAt) {
    return {
      ok: false,
      status: 403,
      code: 'unconfirmed',
      error: 'Confirm your email before joining this team.',
    };
  }

  return { ok: true };
}
