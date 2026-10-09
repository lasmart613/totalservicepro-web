import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { findAuthUserByEmail, type AuthEmailLookup } from '@/lib/team-profile';
import { DEFAULT_STAFF_ROLE } from '@/lib/org-membership';
import { freshTeamInviteFields } from '@/lib/team-invite-guard';
import { decideMemberRoleChange } from '@/lib/tenant-lockdown';
import {
  decideTeamInviteAudience,
  newUserLinkFailureMode,
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
 * 4) Confirmed new user → generateLink type invite, emailed to them via Resend.
 *    The action link is not included in this response.
 * 5) If the email lookup errors or is ambiguous, fail closed: no link.
 *
 * Does not send the generic Auth invite mail (avoids double send with Resend).
 */
export async function POST(req: NextRequest) {
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

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

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

    const requestedRole = (body.role || DEFAULT_STAFF_ROLE).toLowerCase();
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

    if (!hasServiceRole()) {
      return respond(
        { error: 'Server cannot create team invites (missing service role).' },
        503
      );
    }

    const admin = getSupabaseAdmin();

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
    }) => {
      // Existing accounts get the sign-in email only. A setup URL is never
      // attached to their message or to this response.
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
      const resendKey = process.env.RESEND_API_KEY;
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

      if (!resendKey) {
        return respond(payload(false));
      }

      try {
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
        if (rr.ok) {
          return respond(payload(true));
        }
        const sendMsg = result?.message || `Email provider error (${rr.status})`;
        console.error('Resend team invite failed', rr.status, sendMsg);
        if (isRateLimitError(sendMsg)) {
          return respond(payload(false, { rateLimited: true }));
        }
        return respond(payload(false, { warning: sendMsg }));
      } catch (sendErr: unknown) {
        const sendMessage = sendErr instanceof Error ? sendErr.message : 'send failed';
        console.error('Resend team invite exception', sendMessage);
        return respond(payload(false, { warning: sendMessage }));
      }
    };

    const recordInvitation = async () => {
      const fresh = freshTeamInviteFields();
      const { data: existingInv } = await admin
        .from('engineer_invitations')
        .select('id, first_name, last_name')
        .eq('email', email)
        .eq('organization_id', orgId)
        .maybeSingle();
      const names = {
        first_name: firstName || (existingInv as { first_name?: string | null } | null)?.first_name || null,
        last_name: lastName || (existingInv as { last_name?: string | null } | null)?.last_name || null,
      };
      if (!existingInv) {
        await admin.from('engineer_invitations').insert({
          organization_id: orgId,
          email,
          role: inviteRole,
          first_name: names.first_name,
          last_name: names.last_name,
          invited_by: user.id,
          accepted: fresh.accepted,
          accepted_at: fresh.accepted_at,
          expires_at: fresh.expires_at,
        });
        return;
      }
      // Resend / re-invite: clear accepted state and extend expires_at so the new link can be claimed.
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
    };

    /**
     * Invite link for an address we have positively confirmed is not an
     * auth user yet. Emailed to that address. Never returned to the caller.
     * No second type is tried if this fails.
     */
    const createNewUserInviteLink = async (): Promise<{ url: string | null; error: string | null }> => {
      try {
        const { data, error } = await admin.auth.admin.generateLink({
          type: 'invite',
          email,
          options: {
            redirectTo,
            data: inviteMeta,
          },
        });
        const actionLink = data?.properties?.action_link || null;
        if (error || !actionLink) {
          return { url: null, error: error?.message || 'invite link was not created' };
        }
        return { url: actionLink, error: null };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'invite link was not created';
        console.warn('generateLink invite failed');
        return { url: null, error: message };
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
        if (error) return { status: 'error', moonlight: false, firstName: null, onboardingCompleted: null };
        if (!data?.id) {
          return { status: 'not_found', moonlight: false, firstName: null, onboardingCompleted: null };
        }
        const otherOrg =
          data.organization_id != null && String(data.organization_id) !== String(orgId);
        return {
          status: 'found',
          moonlight: otherOrg,
          firstName: (data as { first_name?: string | null }).first_name || null,
          onboardingCompleted: (data as { onboarding_completed?: boolean | null }).onboarding_completed ?? null,
        };
      } catch {
        return { status: 'error', moonlight: false, firstName: null, onboardingCompleted: null };
      }
    };

    let authLookup: AuthEmailLookup;
    try {
      authLookup = await findAuthUserByEmail(admin, email);
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

    if (audience === 'new' && !process.env.RESEND_API_KEY) {
      return respond(
        {
          ok: false,
          error: `Email delivery is not configured, so no invite link was created for ${email}.`,
        },
        503
      );
    }

    const greetName = firstName || profileLookup.firstName;
    const moonlight = profileLookup.moonlight;

    // Existing profile: invite row only. Membership is created later by /api/team/claim.
    await recordInvitation();

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

    return deliverBrandedInvite({
      alreadyRegistered: false,
      acceptUrl: created.url,
      greetName,
      moonlight,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Invite failed';
    console.error('team invite error', message);
    return respond({ error: message || 'Invite failed' }, 500);
  }
}
