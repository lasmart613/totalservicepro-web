/**
 * Team / staff invite — RepairPlanet branded email (FSE default role).
 * Server-only builders. Do not import from client components.
 *
 * CTA must be a real Supabase generateLink action_link (or ConfirmationURL),
 * never a placeholder token.
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

export function teamInviteRoleLabel(role?: string | null): string {
  const r = String(role || DEFAULT_TEAM_ROLE).toLowerCase().trim();
  return ROLE_LABELS[r] || r.replace(/_/g, ' ');
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
  acceptUrl: string;
  loginUrl: string;
};

function inviteFields(opts: TeamInviteCopy) {
  return {
    org: orgDisplayName(opts.organizationName),
    greetName: String(opts.firstName || '').trim(),
    role: String(opts.roleLabel || '').trim() || DEFAULT_TEAM_ROLE_LABEL,
    acceptUrl: String(opts.acceptUrl || '').trim(),
    loginUrl: String(opts.loginUrl || '').trim() || 'https://repairplanet.net/login',
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

export function buildTeamInviteHtml(opts: TeamInviteCopy): string {
  const { org, greetName, role, acceptUrl, loginUrl } = inviteFields(opts);
  const greet = greetName ? `Hi ${esc(greetName)},` : 'Hello,';
  const orgHtml = esc(org);
  const roleHtml = esc(role);
  const accept = esc(acceptUrl);
  const login = esc(loginUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(teamInviteSubject(org))}</title>
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
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#e8edf4;">${greet}</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#e8edf4;">
                <strong style="color:#e8edf4;">${orgHtml}</strong>
                invited you to join their team on RepairPlanet as a
                <strong style="color:#d4af37;">${roleHtml}</strong>.
              </p>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#e8edf4;">
                Accept this invite, set your password, and you can:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 8px;">
                ${bulletRow('See assigned jobs and the shop schedule')}
                ${bulletRow('Write service reports and estimates in the field')}
                ${bulletRow('Open laser manuals and the parts marketplace')}
                ${bulletRow('Use the same login on the website and the Android app')}
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:22px auto 8px;">
                <tr>
                  <td align="center" style="border-radius:8px;background:#d4af37;">
                    <a href="${accept}"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#111111;text-decoration:none;border-radius:8px;">
                      Accept invite &amp; set password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;text-align:center;font-size:12px;line-height:1.5;color:#8b95a5;">
                This link is just for you. It expires if unused.
              </p>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#8b95a5;">
                Already on RepairPlanet?
                <a href="${login}" style="color:#d4af37;text-decoration:underline;">Sign in</a>
                with this email, then use Forgot password if you still need to set one.
              </p>
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

export function buildTeamInviteText(opts: TeamInviteCopy): string {
  const { org, greetName, role, acceptUrl, loginUrl } = inviteFields(opts);
  const greet = greetName ? `Hi ${greetName},` : 'Hello,';
  return [
    greet,
    '',
    `${org} invited you to join their team on RepairPlanet as a ${role}.`,
    '',
    'Accept this invite, set your password, and you can:',
    '- See assigned jobs and the shop schedule',
    '- Write service reports and estimates in the field',
    '- Open laser manuals and the parts marketplace',
    '- Use the same login on the website and the Android app',
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
