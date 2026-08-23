/**
 * Team / staff invite — RepairPlanet branded email (FSE default role).
 * Server-only builders. Do not import from client components.
 *
 * New users: CTA is a real generateLink action_link (set-password).
 * Already-registered users: CTA is Sign in (loginUrl). Never a placeholder token.
 */

export const DEFAULT_TEAM_ROLE = 'fse';
export const DEFAULT_TEAM_ROLE_LABEL = 'Field Service Engineer (FSE)';

const ROLE_LABELS: Record<string, string> = {
  fse: DEFAULT_TEAM_ROLE_LABEL,
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

/**
 * Primary-org founder roles on *this* company (do not demote).
 * Not a product ban on moonlighting — other-org invites become add-membership.
 */
const FOUNDER_LOCKED_ROLES = new Set([
  'company_admin',
  'admin',
  'owner',
  'parts_supplier',
  'supplier',
]);

export function teamInviteRoleLabel(role?: string | null): string {
  const r = String(role || DEFAULT_TEAM_ROLE).toLowerCase().trim();
  return ROLE_LABELS[r] || r.replace(/_/g, ' ');
}

export function isFounderLockedRole(role?: string | null): boolean {
  return FOUNDER_LOCKED_ROLES.has(String(role || '').toLowerCase().trim());
}

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function orgDisplayName(organizationName?: string | null): string {
  const name = String(organizationName || '').trim();
  return name || 'your service organization';
}

export function teamInviteSubject(organizationName?: string | null): string {
  return `${orgDisplayName(organizationName)} invited you to Total Service Pro`;
}

export function teamInviteLoginUrl(origin?: string | null): string {
  const base = String(origin || 'https://repairplanet.net').replace(/\/$/, '');
  return `${base}/login`;
}

export type TeamInviteCopy = {
  organizationName: string;
  firstName?: string | null;
  roleLabel?: string | null;
  /** Required for new users (generateLink action_link). Unused when alreadyRegistered. */
  acceptUrl?: string;
  loginUrl: string;
  /** Existing RepairPlanet account — Sign in CTA instead of set-password. */
  alreadyRegistered?: boolean;
};

function inviteFields(opts: TeamInviteCopy) {
  return {
    org: orgDisplayName(opts.organizationName),
    greetName: String(opts.firstName || '').trim(),
    role: String(opts.roleLabel || '').trim() || DEFAULT_TEAM_ROLE_LABEL,
    acceptUrl: String(opts.acceptUrl || '').trim(),
    loginUrl: String(opts.loginUrl || '').trim() || 'https://repairplanet.net/login',
    alreadyRegistered: Boolean(opts.alreadyRegistered),
  };
}

function bulletRow(text: string): string {
  return (
    `<tr>` +
    `<td valign="top" style="width:18px;padding:0 8px 8px 0;font-size:13px;line-height:1.55;color:#d4af37;">&#9656;</td>` +
    `<td valign="top" style="padding:0 0 8px;font-size:15px;line-height:1.55;color:#e8edf4;">${text}</td>` +
    `</tr>`
  );
}

function wrapTeamInviteEmail(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#0f1419;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8edf4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1419;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#161c24;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background:#d4af37;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;text-align:center;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#d4af37;text-transform:uppercase;">TOTAL SERVICE PRO</div>
              <div style="font-family:Georgia,Times New Roman,Times,serif;font-size:32px;line-height:1.2;color:#e8edf4;margin-top:8px;">RepairPlanet</div>
              <div style="font-size:13px;color:#8b95a5;margin-top:6px;">Laser service field ops</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 8px;">
              ${inner}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #243040;text-align:center;">
              <p style="margin:0 0 10px;font-size:12px;line-height:1.5;color:#8b95a5;">
                If you were not expecting this, you can ignore the email. Nobody else on the team was copied.
              </p>
              <div style="font-size:11px;color:#8b95a5;">
                Sent by <span style="color:#d4af37;font-weight:700;">Total Service Pro</span>
                &nbsp;&middot;&nbsp;
                <a href="https://repairplanet.net" style="color:#8b95a5;text-decoration:none;">repairplanet.net</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return (
    `<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:22px auto 8px;">` +
    `<tr>` +
    `<td align="center" style="border-radius:8px;background:#d4af37;">` +
    `<a href="${href}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#111111;text-decoration:none;border-radius:8px;">` +
    `${label}` +
    `</a>` +
    `</td>` +
    `</tr>` +
    `</table>`
  );
}

function bulletsHtml(): string {
  return (
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 8px;">` +
    `${bulletRow('See assigned jobs and the shop schedule')}` +
    `${bulletRow('Write service reports and estimates in the field')}` +
    `${bulletRow('Open laser manuals and the parts marketplace')}` +
    `${bulletRow('Use the same login on the website and the Android app')}` +
    `</table>`
  );
}

export function buildTeamInviteHtml(opts: TeamInviteCopy): string {
  const { org, greetName, role, acceptUrl, loginUrl, alreadyRegistered } = inviteFields(opts);
  const greet = greetName ? `Hi ${esc(greetName)},` : 'Hello,';
  const orgHtml = esc(org);
  const roleHtml = esc(role);
  const accept = esc(acceptUrl);
  const login = esc(loginUrl);
  const subject = teamInviteSubject(org);

  if (alreadyRegistered) {
    const inner =
      `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#e8edf4;">${greet}</p>` +
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#e8edf4;">` +
      `<strong style="color:#e8edf4;">${orgHtml}</strong>` +
      ` added you to their team on RepairPlanet as a ` +
      `<strong style="color:#d4af37;">${roleHtml}</strong>.` +
      ` Sign in with this email to start.` +
      `</p>` +
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#e8edf4;">You can:</p>` +
      bulletsHtml() +
      ctaButton(login, 'Sign in') +
      `<p style="margin:0 0 8px;text-align:center;font-size:12px;line-height:1.5;color:#8b95a5;">` +
      `Use this email to sign in on the website and the Android app.` +
      `</p>` +
      `<p style="margin:0 0 8px;font-size:12px;line-height:1.55;color:#8b95a5;">` +
      `Never set a password? Use Forgot password on the sign-in page.` +
      `</p>`;
    return wrapTeamInviteEmail(subject, inner);
  }

  const inner =
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#e8edf4;">${greet}</p>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#e8edf4;">` +
    `<strong style="color:#e8edf4;">${orgHtml}</strong>` +
    ` invited you to join their team on RepairPlanet as a ` +
    `<strong style="color:#d4af37;">${roleHtml}</strong>.` +
    `</p>` +
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#e8edf4;">` +
    `Accept this invite, set your password, and you can:` +
    `</p>` +
    bulletsHtml() +
    ctaButton(accept, 'Accept invite &amp; set password') +
    `<p style="margin:0 0 16px;text-align:center;font-size:12px;line-height:1.5;color:#8b95a5;">` +
    `This link is just for you. It expires if unused.` +
    `</p>` +
    `<p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#8b95a5;">` +
    `Already on RepairPlanet? ` +
    `<a href="${login}" style="color:#d4af37;text-decoration:underline;">Sign in</a>` +
    ` with this email, then use Forgot password if you still need to set one.` +
    `</p>`;
  return wrapTeamInviteEmail(subject, inner);
}

export function buildTeamInviteText(opts: TeamInviteCopy): string {
  const { org, greetName, role, acceptUrl, loginUrl, alreadyRegistered } = inviteFields(opts);
  const greet = greetName ? `Hi ${greetName},` : 'Hello,';
  const bullets = [
    '- See assigned jobs and the shop schedule',
    '- Write service reports and estimates in the field',
    '- Open laser manuals and the parts marketplace',
    '- Use the same login on the website and the Android app',
  ];

  if (alreadyRegistered) {
    return [
      greet,
      '',
      `${org} added you to their team on RepairPlanet as a ${role}. Sign in with this email to start.`,
      '',
      'You can:',
      ...bullets,
      '',
      `Sign in: ${loginUrl}`,
      '',
      'Never set a password? Use Forgot password on the sign-in page.',
      '',
      'If you were not expecting this, you can ignore the email. Nobody else on the team was copied.',
      'Sent by Total Service Pro · repairplanet.net',
    ].join('\n');
  }

  return [
    greet,
    '',
    `${org} invited you to join their team on RepairPlanet as a ${role}.`,
    '',
    'Accept this invite, set your password, and you can:',
    ...bullets,
    '',
    `Accept invite & set password: ${acceptUrl}`,
    '',
    'This link is just for you. It expires if unused.',
    '',
    `Already on RepairPlanet? Sign in with this email: ${loginUrl}`,
    'Then use Forgot password if you still need to set one.',
    '',
    'If you were not expecting this, you can ignore the email. Nobody else on the team was copied.',
    'Sent by Total Service Pro · repairplanet.net',
  ].join('\n');
}
