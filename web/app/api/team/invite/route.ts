import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { ensureTeamMemberProfile, findAuthUserByEmail } from '@/lib/team-profile';

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

function roleLabelFor(role: string): string {
  const roleLabels: Record<string, string> = {
    fse: 'Field Service Engineer (FSE)',
    engineer: 'Field Service Engineer',
    dispatcher: 'Dispatcher',
    service_manager: 'Service Manager',
    company_admin: 'Company Admin',
    admin: 'Administrator',
    billing_manager: 'Billing Manager',
    scheduler: 'Scheduler',
    technician: 'Technician',
    viewer: 'Viewer',
  };
  return roleLabels[role] || role.replace(/_/g, ' ');
}

function isRateLimitError(msg: string): boolean {
  return /rate.?limit|too many|429|email.*limit/i.test(msg || '');
}

/**
 * Invite a team member:
 * 1) Verify caller is authenticated admin of an org
 * 2) Record engineer_invitations + user_profiles
 * 3) Send Supabase Auth invite email (service role)
 * 4) If email fails (rate limit / SMTP), still return a copyable action link
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
    const roleLabel = roleLabelFor(inviteRole);

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

    // Existing profile → link only if they are not already on another org
    const { data: existingProfile } = await admin
      .from('user_profiles')
      .select('id, email, organization_id, role')
      .ilike('email', email)
      .maybeSingle();

    if (existingProfile?.id) {
      const existingOrg = existingProfile.organization_id;
      const existingRole = String(existingProfile.role || '').toLowerCase();
      const founderLocked = ['company_admin', 'admin', 'owner', 'parts_supplier'].includes(existingRole);
      if (existingOrg && String(existingOrg) !== String(orgId)) {
        return NextResponse.json({
          error: `${email} already belongs to another organization. Ask them to leave that org first, or invite a different email.`,
        }, { status: 409 });
      }
      if (founderLocked && String(existingOrg) === String(orgId) && existingRole !== inviteRole) {
        return NextResponse.json({
          ok: true,
          linked: true,
          emailed: false,
          message: `${email} is already a ${existingRole.replace(/_/g, ' ')} in your organization. Role was not overwritten.`,
        });
      }
      if (!existingOrg) {
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
      }
      return NextResponse.json({
        ok: true,
        linked: true,
        emailed: false,
        message: `${email} already has a profile — linked to your organization. No invite email needed; they can sign in.`,
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

    /** Build a copyable invite/recovery link even when SMTP fails */
    const buildActionLink = async (preferInvite: boolean): Promise<string | null> => {
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
          // Try the other type
          const alt = preferInvite ? 'recovery' : 'invite';
          const { data: d2, error: e2 } = await admin.auth.admin.generateLink({
            type: alt,
            email,
            options: { redirectTo, data: inviteMeta },
          } as any);
          if (e2) {
            console.warn('generateLink failed', error.message, e2.message);
            return null;
          }
          return d2?.properties?.action_link || null;
        }
        return data?.properties?.action_link || null;
      } catch (e) {
        console.warn('generateLink exception', e);
        return null;
      }
    };

    // --- Send invite email ---
    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: inviteMeta,
      redirectTo,
    });

    if (!inviteErr) {
      const newUserId = inviteData?.user?.id || null;
      if (newUserId) {
        await ensureProfileForUserId(newUserId);
      } else {
        const found = await findAuthUserByEmail(admin, email);
        if (found?.id) await ensureProfileForUserId(found.id);
      }

      // Also generate link for admin (handy if email is slow / in spam)
      const inviteUrl = await buildActionLink(true);

      return NextResponse.json({
        ok: true,
        emailed: true,
        userId: newUserId,
        inviteUrl,
        message: `Invite email sent to ${email}. If they don't see it within a few minutes, check spam — or copy the invite link from the toast / pending list.`,
      });
    }

    // --- Email path failed ---
    const msg = inviteErr.message || 'Invite email failed';
    const rateLimited = isRateLimitError(msg);
    console.warn('inviteUserByEmail failed:', msg);

    // User may already exist, or email rate limit hit after partial create
    const existingAuth = await findAuthUserByEmail(admin, email);
    if (existingAuth?.id) {
      await ensureProfileForUserId(existingAuth.id);
    }

    // Prefer recovery link if auth user already exists; invite link if not
    const inviteUrl = await buildActionLink(!existingAuth);

    // If generateLink created a user (invite type), ensure profile
    if (!existingAuth && inviteUrl) {
      const found = await findAuthUserByEmail(admin, email);
      if (found?.id) await ensureProfileForUserId(found.id);
    }

    if (rateLimited) {
      return NextResponse.json({
        ok: true,
        emailed: false,
        rateLimited: true,
        inviteUrl,
        message:
          'Supabase blocked the email (built-in email limit: only a few per hour without custom SMTP). ' +
          (inviteUrl
            ? 'Copy the invite link below and send it yourself (text/email).'
            : 'Wait ~1 hour and try again, or configure custom SMTP in Supabase Auth settings.'),
      });
    }

    if (/already|registered|exists/i.test(msg)) {
      // Try recovery email
      try {
        const recoverRes = await fetch(`${url}/auth/v1/recover`, {
          method: 'POST',
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            gotrue_meta_security: {},
            redirect_to: redirectTo,
          }),
        });
        if (recoverRes.ok) {
          return NextResponse.json({
            ok: true,
            emailed: true,
            inviteUrl,
            message: `Account already existed for ${email}. Sent a password-setup email. Check spam if needed.`,
          });
        }
        const recoverText = await recoverRes.text().catch(() => '');
        console.warn('recover failed', recoverRes.status, recoverText);
        if (isRateLimitError(recoverText)) {
          return NextResponse.json({
            ok: true,
            emailed: false,
            rateLimited: true,
            inviteUrl,
            message:
              'Email rate limit hit. Copy the invite/setup link and send it to them manually.',
          });
        }
      } catch (re) {
        console.warn('recover exception', re);
      }

      return NextResponse.json({
        ok: true,
        emailed: false,
        inviteUrl,
        message:
          inviteUrl
            ? `Account exists for ${email}. Email could not be sent — copy this link and share it with them.`
            : `Account exists for ${email}. They should use Login → Forgot password.`,
        signupUrl: `${base}/login`,
      });
    }

    return NextResponse.json({
      ok: true,
      emailed: false,
      warning: msg,
      inviteUrl,
      message:
        `Could not send email: ${msg}. ` +
        (inviteUrl
          ? 'Copy the invite link and send it yourself.'
          : 'Try again later or set up custom SMTP in Supabase.'),
    });
  } catch (e: any) {
    console.error('team invite error', e);
    return NextResponse.json({ error: e?.message || 'Invite failed' }, { status: 500 });
  }
}
