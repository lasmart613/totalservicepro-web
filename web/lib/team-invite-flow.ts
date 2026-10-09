import { invitationIsOpen } from '@/lib/org-membership';
import type { AuthEmailLookup } from '@/lib/team-profile';
import { teamInviteSentMessage } from '@/lib/team-invite';

export type TeamInviteAudience = 'existing' | 'new' | 'closed';

/**
 * Existing auth users never get a password-setting link from an inviter.
 * A failed or ambiguous lookup fails closed. Unfinished onboarding and a
 * missing last sign-in do not change that.
 */
export function decideTeamInviteAudience(input: {
  auth: AuthEmailLookup;
  profile: 'found' | 'not_found' | 'error';
  onboardingCompleted?: boolean | null;
  lastSignInAt?: string | null;
}): TeamInviteAudience {
  void input.onboardingCompleted;
  void input.lastSignInAt;

  if (input.auth.status === 'ambiguous' || input.auth.status === 'error') return 'closed';
  if (input.auth.status === 'found') return 'existing';
  if (input.profile === 'error') return 'closed';
  if (input.profile === 'found') return 'existing';
  return 'new';
}

/** Only a confirmed new account may have an invite link minted, and only for their email. */
export function teamInviteMayMintActionLink(audience: TeamInviteAudience): boolean {
  return audience === 'new';
}

/**
 * generateLink(invite) fails when the address is already registered.
 * That is an existing account we must not follow with a recovery link.
 */
export function newUserLinkFailureMode(errorMessage: string | null | undefined): 'existing' | 'error' {
  if (
    errorMessage &&
    /already registered|already exists|already been registered/i.test(errorMessage)
  ) {
    return 'existing';
  }
  return 'error';
}

const LEAK =
  /action_link|hashed_token|email_otp|verification_type|\/auth\/v1\/verify|type=recovery|type%3Drecovery|type=magiclink|type%3Dmagiclink|type=invite|type%3Dinvite/i;

const BLOCKED_KEYS = new Set([
  'inviteUrl',
  'action_link',
  'signupUrl',
  'properties',
  'hashed_token',
  'verification_type',
  'email_otp',
  'redirect_to',
]);

/** Drop credential fields and any string that carries an auth action link. */
export function sealInviteResponse(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (typeof value === 'string' && LEAK.test(value)) continue;
    if (value && typeof value === 'object') continue;
    out[key] = value;
  }
  return out;
}

export function teamInvitePublicBody(input: {
  email: string;
  emailed: boolean;
  alreadyRegistered: boolean;
  moonlight?: boolean;
  rateLimited?: boolean;
  warning?: string | null;
}): Record<string, unknown> {
  const message = input.emailed
    ? input.moonlight
      ? teamInviteSentMessage(
          input.email,
          'They already have a company — they join this shop when they sign in and accept.',
        )
      : input.alreadyRegistered
        ? teamInviteSentMessage(input.email, 'They sign in with this email to join.')
        : teamInviteSentMessage(input.email)
    : `Invitation saved for ${input.email}, but the email could not be sent. No link was issued. Try again.`;

  const body: Record<string, unknown> = {
    ok: true,
    emailed: input.emailed,
    linked: false,
    alreadyRegistered: input.alreadyRegistered,
    moonlight: Boolean(input.moonlight),
    message,
  };
  if (input.rateLimited) body.rateLimited = true;
  if (input.warning) body.warning = input.warning;
  return sealInviteResponse(body);
}

export function teamInviteClosedBody(): { status: number; body: Record<string, unknown> } {
  return {
    status: 503,
    body: sealInviteResponse({
      ok: false,
      error:
        'Could not verify whether this email already has an account. No invite link was created. Try again.',
    }),
  };
}

const SETUP_LINK_TYPES = ['invite', 'recovery'] as const;
export type SetupLinkType = (typeof SETUP_LINK_TYPES)[number];

/**
 * Password-setup link types, in the order to try them.
 * Invite first. The next type is only used when invite cannot be issued.
 */
export function nextSetupLinkType(failed: string | null | undefined): SetupLinkType | null {
  if (!failed) return SETUP_LINK_TYPES[0];
  const idx = SETUP_LINK_TYPES.indexOf(failed as SetupLinkType);
  if (idx < 0) return null;
  return SETUP_LINK_TYPES[idx + 1] ?? null;
}

export type SetupResendDecision = 'setup' | 'sign-in' | 'closed';

/**
 * A resend may email a set-password link only when the invite is still
 * pending, the stored auth user id proves this invite created the account,
 * and that account has never signed in. Anything we cannot prove stays on
 * the sign-in email. A failed auth lookup fails closed.
 */
export function decideInviteSetupResend(input: {
  authStatus: AuthEmailLookup['status'];
  lastSignInAt?: string | null;
  authUserId?: string | null;
  invite?: {
    accepted?: boolean | null;
    expires_at?: string | null;
    created_at?: string | null;
    revoked?: boolean | null;
    status?: string | null;
    createdAuthUserId?: string | null;
  } | null;
  now?: number;
}): SetupResendDecision {
  if (input.authStatus === 'error' || input.authStatus === 'ambiguous') return 'closed';
  if (input.authStatus !== 'found') return 'sign-in';

  const invite = input.invite;
  if (!invite) return 'sign-in';
  if (invite.revoked === true) return 'sign-in';
  const status = String(invite.status || '').trim().toLowerCase();
  if (status === 'accepted' || status === 'expired' || status === 'revoked') return 'sign-in';
  if (!invitationIsOpen(invite, input.now ?? Date.now())) return 'sign-in';

  const proof = String(invite.createdAuthUserId || '').trim();
  const authId = String(input.authUserId || '').trim();
  if (!proof || !authId || proof !== authId) return 'sign-in';
  // undefined means the lookup did not say. null or blank means never signed in.
  if (input.lastSignInAt === undefined) return 'sign-in';
  if (input.lastSignInAt == null || !String(input.lastSignInAt).trim()) return 'setup';
  return 'sign-in';
}

/** Existing-user delivery failed. No link. */
export function existingUserInviteDeliveryError(
  email: string,
  reason: 'unconfigured' | 'failed'
): Record<string, unknown> {
  const error =
    reason === 'unconfigured'
      ? `Email delivery is not configured, so no invite was emailed to ${email}. No link was created.`
      : `Could not email the invite to ${email}. No link was created. Try again.`;
  return sealInviteResponse({ ok: false, error });
}
