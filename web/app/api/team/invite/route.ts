import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { findAuthUserByEmail } from '@/lib/team-profile';
import { DEFAULT_STAFF_ROLE } from '@/lib/org-membership';
import { freshTeamInviteFields } from '@/lib/team-invite-guard';
import { decideMemberRoleChange } from '@/lib/tenant-lockdown';
import {
  buildTeamInviteHtml,
  buildTeamInviteText,
  teamInviteEmailError,
  teamInviteLoginUrl,
  teamInviteNeedsPasswordSetup,
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

function isRateLimitError(msg: string): boolean {
  return /rate.?limit|too many|429|email.*limit/i.test(msg || '');
}

/**
 * Invite a team member:
 * 1) Verify caller is authenticated admin of an org
 * 2) Write only the engineer_invitations row (accepted false, expires_at now+7 days).
 *    An existing profile does not get a membership here — they join via
 *    POST /api/team/claim after the invite is open and their email is confirmed.
 *    Never reject just because they already have another company (moonlight).
 *    Always send branded email. Prefer set-password when they never signed in
 *    or onboarding is incomplete; otherwise Sign in.
 * 3) New user → generateLink (no Supabase Auth mail) + branded set-password email
 * 4) If Resend is not configured or send fails, still return a copyable link
 * 5) Do not mark the invite accepted until they claim it
 *
 * Does not send the generic Auth invite mail (avoids double send with Resend).
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured (Supabase env)' }, { status: 500 });
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
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { data: profile } = await userClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'You are not linked to an organization' }, { status: 403 });
    }

    const role = (profile.role || '').toLowerCase();
    if (!ADMIN_ROLES.has(role)) {
      return NextResponse.json({ error: 'Only admins can invite team members' }, { status: 403 });
    }

    const body = (await req.json()) as InviteBody;
    const email = (body.email || '').toLowerCase().trim();
    const emailError = teamInviteEmailError(email);
    if (emailError) {
      return NextResponse.json({ error: emailError }, { status: 400 });
    }

    const requestedRole = (body.role || DEFAULT_STAFF_ROLE).toLowerCase();
    const roleGate = decideMemberRoleChange({
      callerRole: role,
      targetRole: requestedRole,
      sameOrganization: true,
      allowServiceManager: true,
    });
    if (!roleGate.ok) {
      return NextResponse.json({ error: roleGate.error }, { status: roleGate.status });
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
      return NextResponse.json(
        { error: 'Server cannot create team invites (missing service role).' },
        { status: 503 }
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
    const servicesOffered = (orgRow as any)?.services_offered || null;

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
      needsSetup?: boolean;
    }) => {
      const html = buildTeamInviteHtml({
        organizationName,
        firstName: opts.greetName ?? firstName,
        roleLabel,
        acceptUrl: opts.acceptUrl || undefined,
        loginUrl,
        alreadyRegistered: opts.alreadyRegistered,
      });
      const text = buildTeamInviteText({
        organizationName,
        firstName: opts.greetName ?? firstName,
        roleLabel,
        acceptUrl: opts.acceptUrl || undefined,
        loginUrl,
        alreadyRegistered: opts.alreadyRegistered,
      });
      const resendKey = process.env.RESEND_API_KEY;
      const from =
        process.env.NOTIFY_FROM_EMAIL ||
        process.env.RESEND_FROM ||
        'Total Service Pro <contact@medicalrepairnetwork.com>';
      const copyUrl = opts.alreadyRegistered ? loginUrl : opts.acceptUrl || loginUrl;

      if (!resendKey) {
        return NextResponse.json({
          ok: true,
          emailed: false,
          linked: false,
          alreadyRegistered: opts.alreadyRegistered,
          moonlight: !!opts.moonlight,
          inviteUrl: copyUrl,
          message: `Invitation saved for ${email}. Email delivery is not configured (RESEND_API_KEY) — copy the ${opts.alreadyRegistered ? 'sign-in' : 'invite'} link and send it yourself.`,
        });
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
          return NextResponse.json({
            ok: true,
            emailed: true,
            linked: false,
            alreadyRegistered: opts.alreadyRegistered,
            moonlight: !!opts.moonlight,
            inviteUrl: copyUrl,
            message: opts.needsSetup
              ? `Invite email sent to ${email}. They have not finished setup — ask them to set a password from the email. If they don't see it, check spam or copy the link.`
              : opts.moonlight
                ? `Invite email sent to ${email}. They already have a company — they join this shop when they sign in and accept (moonlight). Their home shop is not changed.`
                : opts.alreadyRegistered
                  ? `Invite email sent to ${email}. They already have a RepairPlanet account — ask them to sign in with this email.`
                  : `Invite email sent to ${email}. If they don't see it within a few minutes, check spam — or copy the invite link from the toast / pending list.`,
          });
        }
        const sendMsg = result?.message || `Email provider error (${rr.status})`;
        console.error('Resend team invite failed', rr.status, sendMsg);
        if (isRateLimitError(sendMsg)) {
          return NextResponse.json({
            ok: true,
            emailed: false,
            rateLimited: true,
            linked: false,
            alreadyRegistered: opts.alreadyRegistered,
            moonlight: !!opts.moonlight,
            inviteUrl: copyUrl,
            message: 'Email rate limit hit. Copy the link below and send it yourself.',
          });
        }
        return NextResponse.json({
          ok: true,
          emailed: false,
          warning: sendMsg,
          linked: false,
          alreadyRegistered: opts.alreadyRegistered,
          moonlight: !!opts.moonlight,
          inviteUrl: copyUrl,
          message: `Could not send email: ${sendMsg}. Copy the link and send it yourself.`,
        });
      } catch (sendErr: any) {
        console.error('Resend team invite exception', sendErr);
        return NextResponse.json({
          ok: true,
          emailed: false,
          warning: sendErr?.message || 'send failed',
          linked: false,
          alreadyRegistered: opts.alreadyRegistered,
          moonlight: !!opts.moonlight,
          inviteUrl: copyUrl,
          message: 'Could not send email. Copy the link and send it yourself.',
        });
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

    /** Build a copyable invite/recovery link without sending Supabase mail. */
    const buildActionLink = async (preferInvite: boolean): Promise<{
      url: string | null;
      userId: string | null;
    }> => {
      try {
        const type = preferInvite ? 'invite' : 'recovery';
        const { data, error } = await admin.auth.admin.generateLink({
          type,
          email,
          options: {
            redirectTo,
            data: inviteMeta,
          },
        } as any);
        if (error) {
          const alt = preferInvite ? 'recovery' : 'invite';
          const { data: d2, error: e2 } = await admin.auth.admin.generateLink({
            type: alt,
            email,
            options: { redirectTo, data: inviteMeta },
          } as any);
          if (e2) {
            console.warn('generateLink failed', error.message, e2.message);
            return { url: null, userId: null };
          }
          return {
            url: d2?.properties?.action_link || null,
            userId: d2?.user?.id || null,
          };
        }
        return {
          url: data?.properties?.action_link || null,
          userId: data?.user?.id || null,
        };
      } catch (e) {
        console.warn('generateLink exception', e);
        return { url: null, userId: null };
      }
    };

    const deliverForExistingAccount = async (opts: {
      greetName?: string | null;
      moonlight?: boolean;
      onboardingCompleted?: boolean | null;
      lastSignInAt?: string | null;
    }) => {
      const needsSetup = teamInviteNeedsPasswordSetup({
        onboardingCompleted: opts.onboardingCompleted,
        lastSignInAt: opts.lastSignInAt,
      });
      let acceptUrl: string | null = null;
      if (needsSetup) {
        const generated = await buildActionLink(false);
        acceptUrl = generated.url;
      }
      return deliverBrandedInvite({
        alreadyRegistered: !needsSetup || !acceptUrl,
        acceptUrl,
        greetName: opts.greetName,
        moonlight: !!opts.moonlight,
        needsSetup,
      });
    };

    // Existing profile: invite row only. Membership is created later by /api/team/claim.
    // Always send branded email when the caller is inviting — including already_on_team.
    const { data: existingProfile } = await admin
      .from('user_profiles')
      .select('id, email, organization_id, role, first_name, last_name, onboarding_completed')
      .ilike('email', email)
      .maybeSingle();

    if (existingProfile?.id) {
      await recordInvitation();

      const existingAuth = await findAuthUserByEmail(admin, email);
      const greetName = firstName || (existingProfile as { first_name?: string | null }).first_name || null;
      const otherOrg =
        existingProfile.organization_id != null &&
        String(existingProfile.organization_id) !== String(orgId);
      return deliverForExistingAccount({
        greetName,
        moonlight: otherOrg,
        onboardingCompleted: (existingProfile as { onboarding_completed?: boolean | null }).onboarding_completed,
        lastSignInAt: existingAuth?.last_sign_in_at || null,
      });
    }

    // Pending invitation row for a new email. No membership until they claim.
    await recordInvitation();

    // Auth exists but no profile yet — still email; prefer set-password if they never signed in.
    const existingAuth = await findAuthUserByEmail(admin, email);
    if (existingAuth?.id) {
      return deliverForExistingAccount({
        onboardingCompleted: false,
        lastSignInAt: existingAuth.last_sign_in_at || null,
      });
    }

    const generated = await buildActionLink(true);
    const inviteUrl = generated.url;

    if (!inviteUrl) {
      return NextResponse.json({
        ok: true,
        emailed: false,
        message:
          'Invitation saved, but an invite link could not be created. Ask them to use Login → Forgot password with this email.',
        signupUrl: loginUrl,
      });
    }

    return deliverBrandedInvite({
      alreadyRegistered: false,
      acceptUrl: inviteUrl,
    });
  } catch (e: any) {
    console.error('team invite error', e);
    return NextResponse.json({ error: e?.message || 'Invite failed' }, { status: 500 });
  }
}
