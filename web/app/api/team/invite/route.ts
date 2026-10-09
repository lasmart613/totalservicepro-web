import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { findAuthUserByEmail, type AuthEmailLookup } from '@/lib/team-profile';
import { DEFAULT_STAFF_ROLE, isInvitableTeamRole, normalizeRole, teamRoleForInvite } from '@/lib/org-membership';
import { freshTeamInviteFields } from '@/lib/team-invite-guard';
import { decideMemberRoleChange } from '@/lib/tenant-lockdown';
import {
  decideInviteSetupResend,
  decideTeamInviteAudience,
  existingUserInviteDeliveryError,
  newUserLinkFailureMode,
  nextSetupLinkType,
  sealInviteResponse,
  teamInviteClosedBody,
  teamInviteMayMintActionLink,
  teamInvitePublicBody,
} from '@/lib/team-invite-flow';
import {
  buildTeamInviteHtml,
  buildTeamInviteText,
  teamInviteEmailError,
  teamInviteLoginUrl,
  teamInviteRoleLabel,
  teamInviteSubject,
} from '@/lib/team-invite';
import { publicSiteOrigin } from '@/lib/site-origin';

const ADMIN_ROLES = new Set([
  'admin',
  'company_admin',
  'service_manager',
  'owner',
]);

type InviteBody = {
  email?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  /** UI Resend — same send path as a fresh invite. */
  resend?: boolean;
};

type InviteProfileLookup = {
  status: 'found' | 'not_found' | 'error';
  moonlight: boolean;
  memberHere: boolean;
  firstName: string | null;
  onboardingCompleted: boolean | null;
};

function isRateLimitError(msg: string): boolean {
  return /rate.?limit|too many|429|email.*limit/i.test(msg || '');
}

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(sealInviteResponse(body), { status });
}

/**
 * Invite a team member:
 * 1) Verify caller is authenticated admin of an org
 * 2) Write only the engineer_invitations row (accepted false, expires_at now+7 days).
 *    An existing profile does not get a membership here — they join via
 *    POST /api/team/claim after the invite is open and their email is confirmed.
 *    Never reject just because they already have another company (moonlight).
 * 3) Existing auth user → branded sign-in email to that mailbox. No password
 *    link is minted, and nothing that signs in as them is returned.
 *    Exception: a still-pending invite whose created_auth_user_id matches this
 *    account, and the account has never signed in, gets a fresh set-password
 *    link emailed only to that mailbox. The link is not returned or logged.
 * 4) Confirmed new user → generateLink type invite, emailed to them via Resend.
 *    The action link is not included in this response. The created auth user id
 *    is stored on the invite row when the column exists.
 * 5) If the email lookup errors or is ambiguous, fail closed: no link.
 * 6) An existing user whose email cannot be sent (no Resend key, or the send
 *    fails) gets 503. No link in the body.
 *
 * Does not send the generic Auth invite mail (avoids double send with Resend).
 */
type InviteUserClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown
      ) => {
        maybeSingle: () => Promise<{
          data: { organization_id?: unknown; role?: string | null } | null;
          error: unknown;
        }>;
      };
    };
  };
};

type InviteSendInput = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  from: string;
};

type InviteDeps = {
  createUserClient?: (url: string, anonKey: string, accessToken: string) => InviteUserClient;
  hasServiceRole?: () => boolean;
  getAdmin?: () => ReturnType<typeof getSupabaseAdmin>;
  findAuthUser?: (
    admin: ReturnType<typeof getSupabaseAdmin>,
    email: string
  ) => Promise<Awaited<ReturnType<typeof findAuthUserByEmail>>>;
  sendEmail?: (input: InviteSendInput) => Promise<{ ok: boolean; status?: number; message?: string }>;
  /** undefined reads RESEND_API_KEY. Null or empty means delivery is not configured. */
  resendKey?: string | null;
};

export async function POST(req: NextRequest) {
  return runTeamInvite(req);
}

export async function runTeamInvite(req: NextRequest, deps: InviteDeps = {}) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return respond({ error: 'Not signed in' }, 401);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return respond({ error: 'Server misconfigured (Supabase env)' }, 500);
    }

    const createUserClient =
      deps.createUserClient ??
      ((supabaseUrl, anonKey, accessToken) =>
        createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
          auth: { autoRefreshToken: false, persistSession: false },
        }) as InviteUserClient);
    const userClient = createUserClient(url, anon, token);

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return respond({ error: 'Invalid session' }, 401);
    }

    const { data: profile } = await userClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.organization_id) {
      return respond({ error: 'You are not linked to an organization' }, 403);
    }

    const role = (profile.role || '').toLowerCase();
    if (!ADMIN_ROLES.has(role)) {
      return respond({ error: 'Only admins can invite team members' }, 403);
    }

    const body = (await req.json()) as InviteBody;
    const email = (body.email || '').toLowerCase().trim();
    const emailError = teamInviteEmailError(email);
    if (emailError) {
      return respond({ error: emailError }, 400);
    }

    const requestedRole = teamRoleForInvite(body.role ?? DEFAULT_STAFF_ROLE);
    if (!isInvitableTeamRole(requestedRole)) {
      return respond({ error: rejectedInviteRoleMessage(requestedRole) }, 400);
    }
    const roleGate = decideMemberRoleChange({
      callerRole: role,
      targetRole: requestedRole,
      sameOrganization: true,
      allowServiceManager: true,
    });
    if (!roleGate.ok) {
      return respond({ error: roleGate.error }, roleGate.status);
    }
    const inviteRole = roleGate.role;
    const firstName = (body.firstName || '').trim() || null;
    const lastName = (body.lastName || '').trim() || null;
    const jobTitle = (body.jobTitle || '').trim() || null;
    const orgId = profile.organization_id;
    const base = publicSiteOrigin(req);
    const redirectTo = `${base}/auth/callback?next=${encodeURIComponent('/auth/set-password')}`;
    const roleLabel = teamInviteRoleLabel(inviteRole);

    const serviceRoleReady = deps.hasServiceRole ?? hasServiceRole;
    if (!serviceRoleReady()) {
      return respond(
        { error: 'Server cannot create team invites (missing service role).' },
        503
      );
    }

    const admin = (deps.getAdmin ?? getSupabaseAdmin)();
    const resendKey = deps.resendKey === undefined ? process.env.RESEND_API_KEY : deps.resendKey || '';
    const findUser = deps.findAuthUser ?? findAuthUserByEmail;

    const { data: orgRow } = await admin
      .from('organizations')
      .select('id, name, type, services_offered')
      .eq('id', orgId)
      .maybeSingle();
    const organizationName = (orgRow?.name || 'your service organization').trim();
    const orgType = orgRow?.type || 'service_company';
    const servicesOffered = (orgRow as { services_offered?: unknown } | null)?.services_offered || null;

    const inviteMeta = {
      first_name: firstName,
      last_name: lastName,
      full_name: [firstName, lastName].filter(Boolean).join(' ') || null,
      role: inviteRole,
      role_label: roleLabel,
      organization_id: orgId,
      organization_name: organizationName,
      organization_type: orgType,
      services_offered: servicesOffered,
      job_title: jobTitle,
      invited_member: true,
      app_name: 'Total Service Pro',
      site_url: base,
    };

    const loginUrl = teamInviteLoginUrl(base);
    const subject = teamInviteSubject(organizationName);

    const deliverBrandedInvite = async (opts: {
      alreadyRegistered: boolean;
      acceptUrl?: string | null;
      greetName?: string | null;
      moonlight?: boolean;
      failIfNotEmailed?: boolean;
    }) => {
      // Sign-in mail never includes a setup URL. A setup URL is placed only in
      // the email body, and only when alreadyRegistered is false. respond()
      // never receives it.
      const setupUrl = opts.alreadyRegistered ? undefined : opts.acceptUrl || undefined;
      const html = buildTeamInviteHtml({
        organizationName,
        firstName: opts.greetName ?? firstName,
        roleLabel,
        acceptUrl: setupUrl,
        loginUrl,
        alreadyRegistered: opts.alreadyRegistered,
      });
      const text = buildTeamInviteText({
        organizationName,
        firstName: opts.greetName ?? firstName,
        roleLabel,
        acceptUrl: setupUrl,
        loginUrl,
        alreadyRegistered: opts.alreadyRegistered,
      });
      const from =
        process.env.NOTIFY_FROM_EMAIL ||
        process.env.RESEND_FROM ||
        'Total Service Pro <contact@medicalrepairnetwork.com>';

      const payload = (emailed: boolean, extra?: { rateLimited?: boolean; warning?: string }) =>
        teamInvitePublicBody({
          email,
          emailed,
          alreadyRegistered: opts.alreadyRegistered,
          moonlight: opts.moonlight,
          rateLimited: extra?.rateLimited,
          warning: extra?.warning,
        });

      const mustEmail = opts.alreadyRegistered || opts.failIfNotEmailed;
      if (!resendKey) {
        if (mustEmail) return respond(existingUserInviteDeliveryError(email, 'unconfigured'), 503);
        return respond(payload(false));
      }

      const sendInviteEmail = async () => {
        if (deps.sendEmail) {
          return deps.sendEmail({ to: [email], subject, html, text, from });
        }
        const rr = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [email],
            subject,
            html,
            text,
          }),
        });
        const result = await rr.json().catch(() => ({}));
        return {
          ok: rr.ok,
          status: rr.status,
          message: result?.message || (rr.ok ? '' : `Email provider error (${rr.status})`),
        };
      };

      try {
        const sent = await sendInviteEmail();
        if (sent.ok) return respond(payload(true));
        const sendMsg = sent.message || `Email provider error (${sent.status ?? 'unknown'})`;
        const logged = /\/auth\/v1\/verify|action_link|hashed_token/i.test(sendMsg) ? 'provider error' : sendMsg;
        console.error('Resend team invite failed', sent.status, logged);
        if (mustEmail) return respond(existingUserInviteDeliveryError(email, 'failed'), 503);
        if (isRateLimitError(sendMsg)) {
          return respond(payload(false, { rateLimited: true }));
        }
        return respond(payload(false, { warning: sendMsg }));
      } catch (sendErr: unknown) {
        const sendMessage = sendErr instanceof Error ? sendErr.message : 'send failed';
        const logged = /\/auth\/v1\/verify|action_link|hashed_token/i.test(sendMessage) ? 'send failed' : sendMessage;
        console.error('Resend team invite exception', logged);
        if (mustEmail) return respond(existingUserInviteDeliveryError(email, 'failed'), 503);
        return respond(payload(false, { warning: sendMessage }));
      }
    };

    // Set before recordInvitation() runs. A current member's row is restored to
    // accepted. An accepted invite for someone who left is reopened as pending.
    let preserveInviteRow = false;

    const recordInvitation = async (): Promise<string | number | null> => {
      const fresh = freshTeamInviteFields();
      const { data: existingInv } = await admin
        .from('engineer_invitations')
        .select('id, first_name, last_name, accepted, accepted_at')
        .eq('email', email)
        .eq('organization_id', orgId)
        .maybeSingle();
      const names = {
        first_name: firstName || (existingInv as { first_name?: string | null } | null)?.first_name || null,
        last_name: lastName || (existingInv as { last_name?: string | null } | null)?.last_name || null,
      };
      if (!existingInv) {
        if (preserveInviteRow) return null;
        const inserted = await admin
          .from('engineer_invitations')
          .insert({
            organization_id: orgId,
            email,
            role: inviteRole,
            first_name: names.first_name,
            last_name: names.last_name,
            invited_by: user.id,
            accepted: fresh.accepted,
            accepted_at: fresh.accepted_at,
            expires_at: fresh.expires_at,
          })
          .select('id')
          .maybeSingle();
        return (inserted.data as { id?: string | number } | null)?.id ?? null;
      }
      if (!preserveInviteRow) {
        // Pending resend, or an accepted invite for someone who is no longer in this org.
        await admin
          .from('engineer_invitations')
          .update({
            role: inviteRole,
            ...names,
            accepted: fresh.accepted,
            accepted_at: fresh.accepted_at,
            expires_at: fresh.expires_at,
          })
          .eq('id', existingInv.id);
        return (existingInv as { id: string | number }).id;
      }
      const keptAcceptedAt =
        (existingInv as { accepted_at?: string | null }).accepted_at || new Date().toISOString();
      await admin
        .from('engineer_invitations')
        .update({
          accepted: true,
          accepted_at: keptAcceptedAt,
        })
        .eq('id', existingInv.id);
      return (existingInv as { id: string | number }).id;
    };

    const rememberCreatedAuthUser = async (inviteId: string | number | null, userId: string | null) => {
      if (inviteId == null || !userId) return;
      const { error } = await admin
        .from('engineer_invitations')
        .update({ created_auth_user_id: userId })
        .eq('id', inviteId);
      if (error && !/created_auth_user_id|column/i.test(String(error.message || ''))) {
        console.warn('could not record invite auth user');
      }
    };

    type MintedLink = { url: string | null; userId: string | null; error: string | null };

    const mintedFrom = (
      data: { properties?: { action_link?: string | null } | null; user?: { id?: string | null } | null } | null,
      error: { message?: string } | null
    ): MintedLink => {
      const actionLink = data?.properties?.action_link || null;
      const userId = data?.user?.id ? String(data.user.id) : null;
      if (error || !actionLink) {
        return { url: null, userId, error: error?.message || 'invite link was not created' };
      }
      return { url: actionLink, userId, error: null };
    };

    /**
     * Invite link for an address we have positively confirmed is not an
     * auth user yet. Emailed to that address. Never returned to the caller.
     * No second type is tried if this fails.
     */
    const createNewUserInviteLink = async (): Promise<MintedLink> => {
      try {
        const { data, error } = await admin.auth.admin.generateLink({
          type: 'invite',
          email,
          options: {
            redirectTo,
            data: inviteMeta,
          },
        });
        return mintedFrom(data, error);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'invite link was not created';
        console.warn('generateLink invite failed');
        return { url: null, userId: null, error: message };
      }
    };

    const createFollowupSetupLink = async (): Promise<MintedLink> => {
      const linkType = nextSetupLinkType('invite');
      if (!linkType) return { url: null, userId: null, error: 'invite link was not created' };
      try {
        const { data, error } = await admin.auth.admin.generateLink({
          type: linkType,
          email,
          options: {
            redirectTo,
            data: inviteMeta,
          },
        } as never);
        return mintedFrom(data, error);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'invite link was not created';
        console.warn('generateLink invite failed');
        return { url: null, userId: null, error: message };
      }
    };

    const deliverForExistingAccount = async (opts: {
      greetName?: string | null;
      moonlight?: boolean;
    }) => {
      return deliverBrandedInvite({
        alreadyRegistered: true,
        greetName: opts.greetName,
        moonlight: !!opts.moonlight,
      });
    };

    const lookupProfile = async (): Promise<InviteProfileLookup> => {
      try {
        const { data, error } = await admin
          .from('user_profiles')
          .select('id, email, organization_id, role, first_name, last_name, onboarding_completed')
          .eq('email', email)
          .maybeSingle();
        if (error) {
          return { status: 'error', moonlight: false, memberHere: false, firstName: null, onboardingCompleted: null };
        }
        if (!data?.id) {
          return { status: 'not_found', moonlight: false, memberHere: false, firstName: null, onboardingCompleted: null };
        }
        const otherOrg =
          data.organization_id != null && String(data.organization_id) !== String(orgId);
        const memberHere = data.organization_id != null && String(data.organization_id) === String(orgId);
        return {
          status: 'found',
          moonlight: otherOrg,
          memberHere,
          firstName: (data as { first_name?: string | null }).first_name || null,
          onboardingCompleted: (data as { onboarding_completed?: boolean | null }).onboarding_completed ?? null,
        };
      } catch {
        return { status: 'error', moonlight: false, memberHere: false, firstName: null, onboardingCompleted: null };
      }
    };

    let authLookup: AuthEmailLookup;
    try {
      authLookup = await findUser(admin, email);
    } catch {
      authLookup = { status: 'error' };
    }
    const profileLookup = await lookupProfile();
    const audience = decideTeamInviteAudience({
      auth: authLookup,
      profile: profileLookup.status,
      onboardingCompleted: profileLookup.onboardingCompleted,
      lastSignInAt: authLookup.status === 'found' ? authLookup.user.last_sign_in_at : null,
    });

    if (audience === 'closed') {
      const closed = teamInviteClosedBody();
      return respond(closed.body, closed.status);
    }

    if (audience === 'new' && !resendKey) {
      return respond(
        {
          ok: false,
          error: `Email delivery is not configured, so no invite link was created for ${email}.`,
        },
        503
      );
    }

    const priorInvite = await (async () => {
      const columns =
        'id, role, first_name, last_name, accepted, expires_at, created_at, created_auth_user_id';
      const first = await admin
        .from('engineer_invitations')
        .select(columns)
        .eq('email', email)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!first.error) {
        return first.data as {
          role?: string | null;
          accepted?: boolean | null;
          expires_at?: string | null;
          created_at?: string | null;
          created_auth_user_id?: string | null;
        } | null;
      }
      if (/created_auth_user_id|column/i.test(String(first.error.message || ''))) {
        const fallback = await admin
          .from('engineer_invitations')
          .select('id, role, first_name, last_name, accepted, expires_at, created_at')
          .eq('email', email)
          .eq('organization_id', orgId)
          .maybeSingle();
        return (fallback.data as {
          role?: string | null;
          accepted?: boolean | null;
          expires_at?: string | null;
          created_at?: string | null;
          created_auth_user_id?: string | null;
        } | null) ?? null;
      }
      return null;
    })();

    if (normalizeRole(priorInvite?.role) === 'owner') {
      return respond({ error: rejectedInviteRoleMessage('owner') }, 400);
    }

    const existingMember = profileLookup.memberHere;
    const acceptedInvite = priorInvite?.accepted === true;
    const reopenFormerMember = acceptedInvite && !existingMember;
    preserveInviteRow = existingMember;

    const setupDecision = preserveInviteRow || reopenFormerMember
      ? 'sign-in'
      : audience === 'existing'
        ? decideInviteSetupResend({
            authStatus: authLookup.status,
            lastSignInAt: authLookup.status === 'found' ? authLookup.user.last_sign_in_at : undefined,
            authUserId: authLookup.status === 'found' ? authLookup.user.id : null,
            invite: priorInvite
              ? {
                  accepted: priorInvite.accepted,
                  expires_at: priorInvite.expires_at,
                  created_at: priorInvite.created_at,
                  createdAuthUserId: priorInvite.created_auth_user_id,
                }
              : null,
          })
        : 'sign-in';

    if (setupDecision === 'closed') {
      const closed = teamInviteClosedBody();
      return respond(closed.body, closed.status);
    }

    const greetName = firstName || profileLookup.firstName;
    const moonlight = profileLookup.moonlight;

    // Existing profile: invite row only. Membership is created later by /api/team/claim.
    const inviteId = await recordInvitation();

    if (preserveInviteRow || reopenFormerMember) {
      return deliverForExistingAccount({ greetName, moonlight });
    }

    if (setupDecision === 'setup') {
      if (!resendKey) {
        return respond(existingUserInviteDeliveryError(email, 'unconfigured'), 503);
      }
      let minted = await createNewUserInviteLink();
      if (!minted.url) minted = await createFollowupSetupLink();
      if (!minted.url) {
        return respond(existingUserInviteDeliveryError(email, 'failed'), 503);
      }
      if (!priorInvite?.created_auth_user_id) {
        await rememberCreatedAuthUser(inviteId, minted.userId);
      }
      return deliverBrandedInvite({
        alreadyRegistered: false,
        acceptUrl: minted.url,
        greetName,
        moonlight,
        failIfNotEmailed: true,
      });
    }

    if (audience === 'existing' || !teamInviteMayMintActionLink(audience)) {
      return deliverForExistingAccount({ greetName, moonlight });
    }

    const created = await createNewUserInviteLink();
    if (!created.url) {
      if (newUserLinkFailureMode(created.error) === 'existing') {
        return deliverForExistingAccount({ greetName, moonlight });
      }
      return respond(
        {
          ok: false,
          error: `Could not email an invite to ${email}. No link was created. Try again.`,
        },
        502
      );
    }

    await rememberCreatedAuthUser(inviteId, created.userId);
    return deliverBrandedInvite({
      alreadyRegistered: false,
      acceptUrl: created.url,
      greetName,
      moonlight,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Invite failed';
    const logged = /\/auth\/v1\/verify|action_link|hashed_token/i.test(message) ? 'Invite failed' : message;
    console.error('team invite error', logged);
    return respond({ error: message || 'Invite failed' }, 500);
  }
}

function rejectedInviteRoleMessage(role: string): string {
  const named = normalizeRole(role);
  if (named === 'owner') return 'Choose a staff role. Owner cannot be invited this way.';
  if (named === 'admin') return 'Choose a staff role. Platform admin cannot be invited this way.';
  return 'Choose a staff role. That role cannot be invited this way.';
}
