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
