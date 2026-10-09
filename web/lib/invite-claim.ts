/**
 * Team-invite claim routing.
 *
 * Invited users who click the email and then use Forgot Password often land
 * in founder onboarding. Completing that wizard used to create a new shop
 * and leave engineer_invitations.accepted = false. These helpers decide
 * when an invite is in play so signup, password reset, and onboarding
 * join the invited org and mark the invite accepted instead.
 */

export type InviteClaimResult = {
  ok: boolean;
  claimed?: boolean;
  skipped?: boolean;
  pendingInvite?: boolean;
  inviteAccepted?: boolean;
  organization_id?: string | number | null;
  role?: string | null;
  needsMemberOnboarding?: boolean;
  moonlight?: boolean;
  error?: string;
  status?: number;
};

/** True when this session should join an invited org rather than create a new one. */
export function inviteInPlay(result: InviteClaimResult | null | undefined): boolean {
  if (!result) return false;
  if (result.pendingInvite) return true;
  if (result.claimed) return true;
  return false;
}

const FOUNDER_ROLES = new Set(['company_admin', 'admin', 'owner', 'parts_supplier', 'supplier']);

/**
 * Team-member setup, not company onboarding.
 * A new service-company admin has an org and onboarding_completed=false, and the
 * claim API reports needsMemberOnboarding for that too. That flag alone must not
 * send them to /onboarding/member. Invited members still do.
 */
export function shouldSendToMemberOnboarding(
  result: InviteClaimResult | null | undefined
): boolean {
  if (!result || result.ok === false) return false;
  const role = String(result.role || '').toLowerCase();
  if (FOUNDER_ROLES.has(role) && !inviteInPlay(result)) return false;
  if (inviteInPlay(result)) return true;
  if (
    result.inviteAccepted &&
    result.organization_id &&
    result.needsMemberOnboarding !== false &&
    !FOUNDER_ROLES.has(role)
  ) {
    return true;
  }
  return false;
}

/**
 * Where to send someone after signup, password reset, or onboarding
 * when a team invite may be in play.
 *
 * Invitees never go to founder `/onboarding` — that path creates a new company.
 */
export function destAfterInviteClaim(
  result: InviteClaimResult | null | undefined,
  fallback: string = '/onboarding'
): string {
  if (inviteInPlay(result)) {
    if (result?.needsMemberOnboarding === false && result.organization_id) return '/hub';
    return '/onboarding/member';
  }
  if (result?.organization_id) {
    const role = String(result.role || '').toLowerCase();
    // A new company admin already has an org and onboarding_completed=false.
    // That is company setup, not team-member setup.
    if (FOUNDER_ROLES.has(role)) {
      return result.needsMemberOnboarding === false ? '/hub' : fallback;
    }
    return result.needsMemberOnboarding === false ? '/hub' : '/onboarding/member';
  }
  return fallback;
}

/**
 * Where login/signup goes after an email-based team claim.
 * No invite token is required. `{ ok:true, claimed:false, pendingInvite:false }`
 * stays on the requested page (founder `/onboarding`). A claimed invite goes to
 * member setup.
 */
export function routeAfterTeamClaim(
  claim: InviteClaimResult | null | undefined,
  requestedDest: string
): string {
  if (!inviteInPlay(claim)) return requestedDest;
  const fallback = requestedDest.startsWith('/onboarding') ? '/onboarding/member' : requestedDest;
  return destAfterInviteClaim(claim, fallback);
}

const CLAIM_STORAGE_PREFIX = 'tsp-team-claim:';

type ClaimCallOptions = {
  /** Skip the sign-in cache and ask the server again (Finish, before creating an org). */
  fresh?: boolean;
  /** Profile id when the access token is not a JWT. */
  userId?: string;
};

const claimInFlight = new Map<string, Promise<InviteClaimResult>>();

function claimSession(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Auth user id from the access token, for the sessionStorage key. */
export function userIdFromAccessToken(token: string): string {
  const parts = String(token || '').split('.');
  if (parts.length >= 2) {
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const payload = JSON.parse(atob(padded)) as { sub?: string };
      if (payload.sub) return String(payload.sub);
    } catch {
      /* not a JWT */
    }
  }
  return `tok:${String(token || '').slice(0, 24)}`;
}

function claimDedupeKey(userId: string, body?: Record<string, unknown>): string {
  const inviteId = body?.inviteId;
  const invite = inviteId == null || String(inviteId) === '' ? 'auto' : `invite:${inviteId}`;
  return `${userId}:${invite}`;
}

function readStoredClaim(key: string): InviteClaimResult | null {
  const store = claimSession();
  if (!store) return null;
  try {
    const raw = store.getItem(CLAIM_STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InviteClaimResult;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredClaim(key: string, result: InviteClaimResult): void {
  const store = claimSession();
  if (!store) return;
  try {
    store.setItem(CLAIM_STORAGE_PREFIX + key, JSON.stringify(result));
  } catch {
    /* private mode */
  }
}

function deleteStoredPrefix(prefix: string): void {
  const store = claimSession();
  if (!store) return;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const storageKey = store.key(i);
    if (storageKey && storageKey.startsWith(prefix)) keys.push(storageKey);
  }
  for (const storageKey of keys) store.removeItem(storageKey);
}

/** Drop every cached team claim. Call on sign-out so the next sign-in can join a fresh invite. */
export function clearTeamClaimDedupe(): void {
  claimInFlight.clear();
  deleteStoredPrefix(CLAIM_STORAGE_PREFIX);
}

/**
 * Forget this sign-in's cached auto-claim before login, the auth callback,
 * or set-password runs. Home and onboarding then share the one new result.
 * An explicit inviteId accept is not stored under the auto key.
 */
export function resetTeamClaimDedupeForSignIn(accessToken: string, userId?: string): void {
  const id = userId || userIdFromAccessToken(accessToken);
  const autoKey = `${id}:auto`;
  claimInFlight.delete(autoKey);
  const store = claimSession();
  try {
    store?.removeItem(CLAIM_STORAGE_PREFIX + autoKey);
  } catch {
    /* ignore */
  }
}

async function postTeamClaimRequest(
  accessToken: string,
  body?: Record<string, unknown>
): Promise<InviteClaimResult> {
  const res = await fetch('/api/team/claim', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const json = (await res.json().catch(() => ({}))) as InviteClaimResult;
  return {
    ...json,
    ok: res.ok && json.ok !== false,
    status: res.status,
  };
}

/**
 * POST /api/team/claim.
 * Automatic sign-in calls (no inviteId) share one in-flight promise.
 * Only an ok:true result is written to sessionStorage as
 * tsp-team-claim:<userId>:auto, so login, home, and onboarding share that
 * success. A failure (for example a transient 503) is not stored; the next
 * call retries. Concurrent callers still share the in-flight promise.
 * A body.inviteId is a fresh invite accept and is not served from that auto cache.
 */
export async function postTeamClaim(
  accessToken: string,
  body?: Record<string, unknown>,
  opts?: ClaimCallOptions
): Promise<InviteClaimResult> {
  const userId = opts?.userId || userIdFromAccessToken(accessToken);
  const key = claimDedupeKey(userId, body);
  const explicitInvite = key.endsWith(':auto') === false;

  if (!opts?.fresh && !explicitInvite) {
    const stored = readStoredClaim(key);
    if (stored?.ok === true) return stored;
    if (stored) {
      try {
        claimSession()?.removeItem(CLAIM_STORAGE_PREFIX + key);
      } catch {
        /* ignore */
      }
    }
  }

  const existing = claimInFlight.get(key);
  if (existing && !opts?.fresh) return existing;

  const promise = postTeamClaimRequest(accessToken, body)
    .then((result) => {
      if (!explicitInvite && result.ok === true) writeStoredClaim(key, result);
      return result;
    })
    .finally(() => {
      if (claimInFlight.get(key) === promise) claimInFlight.delete(key);
    });

  claimInFlight.set(key, promise);
  return promise;
}
