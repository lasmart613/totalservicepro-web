import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { ensureTeamMemberProfile, findAuthUserByEmail } from '@/lib/team-profile';
import {
  buildTeamInviteHtml,
  buildTeamInviteText,
  isFounderLockedRole,
  teamInviteLoginUrl,
  teamInviteRoleLabel,
  teamInviteSubject,
} from '@/lib/team-invite';

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
};

function siteUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (env) return env.replace(/\/$/, '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto}://${host}`;
  return 'https://repairplanet.net';
}

function isRateLimitError(msg: string): boolean {
  return /rate.?limit|too many|429|email.*limit/i.test(msg || '');
}

/**
 * Invite a team member:
 * 1) Verify caller is authenticated admin of an org
 * 2) Existing RepairPlanet user (no other-org conflict yet) → link + branded Sign-in email
 * 3) New user → generateLink (no Supabase mail) + branded set-password email
 * 4) If Resend is not configured or send fails, still return a copyable link
 *
 * Other-org 409 below is interim (single user_profiles.organization_id).
 * Multi-org memberships will replace it with add-membership + the same Sign-in email
 * so a shop owner can moonlight as FSE on another company.
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
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const inviteRole = (body.role || 'fse').toLowerCase();
    const firstName = (body.firstName || '').trim() || null;
    const lastName = (body.lastName || '').trim() || null;
    const jobTitle = (body.jobTitle || '').trim() || null;
    const orgId = profile.organization_id;
    const base = siteUrl(req);
    const redirectTo = `${base}/auth/callback?next=${encodeURIComponent('/auth/set-password')}`;
    const roleLabel = teamInviteRoleLabel(inviteRole);

    if (!hasServiceRole()) {
      const { error: invErr } = await userClient.from('engineer_invitations').insert({
        organization_id: orgId,
        email,
        role: inviteRole,
        first_name: firstName,
        last_name: lastName,
        invited_by: user.id,
        accepted: false,
      });
      if (invErr) {
        return NextResponse.json({ error: invErr.message }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        emailed: false,
        message:
          'Invitation saved, but the server cannot send email (missing SUPABASE_SERVICE_ROLE_KEY). ' +
          'Contact support to configure email, or share the signup link manually.',
        signupUrl: `${base}/login`,
      });
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
          linked: opts.alreadyRegistered,
          alreadyRegistered: opts.alreadyRegistered,
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
            linked: opts.alreadyRegistered,
            alreadyRegistered: opts.alreadyRegistered,
            inviteUrl: copyUrl,
            message: opts.alreadyRegistered
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
            linked: opts.alreadyRegistered,
            alreadyRegistered: opts.alreadyRegistered,
            inviteUrl: copyUrl,
            message: 'Email rate limit hit. Copy the link below and send it yourself.',
          });
        }
        return NextResponse.json({
          ok: true,
          emailed: false,
          warning: sendMsg,
          linked: opts.alreadyRegistered,
          alreadyRegistered: opts.alreadyRegistered,
          inviteUrl: copyUrl,
          message: `Could not send email: ${sendMsg}. Copy the link and send it yourself.`,
        });
      } catch (sendErr: any) {
        console.error('Resend team invite exception', sendErr);
        return NextResponse.json({
          ok: true,
          emailed: false,
          warning: sendErr?.message || 'send failed',
          linked: opts.alreadyRegistered,
          alreadyRegistered: opts.alreadyRegistered,
          inviteUrl: copyUrl,
          message: 'Could not send email. Copy the link and send it yourself.',
        });
      }
    };

    // Existing profile → branded Sign-in email when we can attach them without
    // overwriting another company's single-org row.
    const { data: existingProfile } = await admin
      .from('user_profiles')
      .select('id, email, organization_id, role, first_name, last_name')
      .ilike('email', email)
      .maybeSingle();

    if (existingProfile?.id) {
      const existingOrg = existingProfile.organization_id;
      const existingRole = String(existingProfile.role || '').toLowerCase();
      // TODO(multi-org): replace this 409 with add-membership + alreadyRegistered Sign-in email.
      // Owners of a service company must be invit-able as FSE on another shop (moonlight).
      if (existingOrg && String(existingOrg) !== String(orgId)) {
        return NextResponse.json({
          error: `${email} already belongs to another organization. Ask them to leave that org first, or invite a different email.`,
        }, { status: 409 });
      }
      // Same-org founder row: do not demote owner/admin/supplier on this company.
      // Other-org founders are covered by the 409 above until add-membership lands.
      if (isFounderLockedRole(existingRole)) {
        const where = existingOrg && String(existingOrg) === String(orgId)
          ? 'your organization'
          : 'their own organization';
        return NextResponse.json({
          error: `${email} is already a ${teamInviteRoleLabel(existingRole)} of ${where}. Role was not overwritten. Ask them to leave that org first, or invite a different email.`,
        }, { status: 409 });
      }

      const { error: upErr } = await admin
        .from('user_profiles')
        .update({
          organization_id: orgId,
          role: inviteRole,
          job_title: jobTitle,
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
        })
        .eq('id', existingProfile.id);
      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 400 });
      }

      const greetName = firstName || (existingProfile as { first_name?: string | null }).first_name || null;
      return deliverBrandedInvite({
        alreadyRegistered: true,
        greetName,
      });
    }

    // Pending invitation row
    const { data: existingInv } = await admin
      .from('engineer_invitations')
      .select('id')
      .eq('email', email)
      .eq('organization_id', orgId)
      .eq('accepted', false)
      .maybeSingle();

    if (!existingInv) {
      const { error: invErr } = await admin.from('engineer_invitations').insert({
        organization_id: orgId,
        email,
        role: inviteRole,
        first_name: firstName,
        last_name: lastName,
        invited_by: user.id,
        accepted: false,
      });
      if (invErr) {
        return NextResponse.json({ error: invErr.message }, { status: 400 });
      }
    }

    const ensureProfileForUserId = async (userId: string) => {
      const r = await ensureTeamMemberProfile(admin, {
        userId,
        email,
        organizationId: orgId,
        role: inviteRole,
        firstName,
        lastName,
        jobTitle,
        onboardingCompleted: false,
      });
      if (!r.ok) console.warn('profile ensure failed', r.error);
      return r;
    };

    /** Build a copyable invite/recovery link without sending Supabase mail. */
    const buildActionLink = async (preferInvite: boolean): Promise<{
      url: string | null;
      userId: string | null;
    }> => {
      try {
        const type = preferInvite ? 'invite' : 'recovery';
        // Cast: supabase-js GenerateLinkParams typing is stricter than runtime invite/recovery payloads
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

    // Auth exists but no profile yet — treat as already registered (Sign in, no set-password).
    const existingAuth = await findAuthUserByEmail(admin, email);
    if (existingAuth?.id) {
      await ensureProfileForUserId(existingAuth.id);
      return deliverBrandedInvite({ alreadyRegistered: true });
    }

    const generated = await buildActionLink(true);
    const inviteUrl = generated.url;
    const newUserId = generated.userId;
    if (newUserId) {
      await ensureProfileForUserId(newUserId);
    }

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
