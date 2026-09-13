/**
 * Locked clinic-invite blast. Wording is product-owner locked (Sep 11 clinic draft).
 * Hosted image URLs only — email clients cannot use relative invite-assets paths.
 */

export const CLINIC_INVITE_SUBJECT = 'Wish your laser repair tech was closer?';
export const CLINIC_INVITE_TEMPLATE_KEY = 'clinic_invite';
export const CLINIC_INVITE_TEMPLATE_NAME = 'Clinic invite';
export const CLINIC_INVITE_SIGNUP_URL = 'https://repairplanet.net/signup';
export const CLINIC_INVITE_UNSUBSCRIBE_URL = 'https://repairplanet.net/unsubscribe';
export const CLINIC_INVITE_POSTAL_ADDRESS = '3349 Somis Rd, Somis, CA 93066-9997';
export const CLINIC_INVITE_HERO_URL = 'https://repairplanet.net/email/laser-clinic-hero-locked.jpg';
export const CLINIC_INVITE_CTA_BUTTON = 'Create your clinic account';
export const CLINIC_INVITE_CTA_SUBLINE = 'Find a tech near you';
export const CLINIC_INVITE_CTA_PLAIN = `${CLINIC_INVITE_CTA_BUTTON}. ${CLINIC_INVITE_CTA_SUBLINE}.`;
export const CLINIC_INVITE_FROM_DEFAULT = 'Total Service Pro <noreply@MedicalRepairNetwork.com>';
export const CLINIC_INVITE_REPLY_TO_DEFAULT = 'support@MedicalRepairNetwork.com';

export const CLINIC_INVITE_FORBIDDEN_PHRASES = [
  'Free to start',
  'No card to start',
  'This is the juicy part',
  'If this is not your shop',
  'audience pill',
  '/register',
  'AdSense',
  'Google Ads',
] as const;

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#e8edf4;">${text}</p>`;
}

function hero(): string {
  return (
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;">` +
    `<tr><td align="center">` +
    `<img src="${esc(CLINIC_INVITE_HERO_URL)}" alt="Laser clinic — find a nearby repair tech" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:1px solid #243040;border-radius:8px;" />` +
    `</td></tr></table>`
  );
}

function ctaButton(href: string, label: string): string {
  return (
    `<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:8px auto 8px;">` +
    `<tr><td align="center" style="border-radius:8px;background:#e8c547;">` +
    `<a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#0b0f14;text-decoration:none;border-radius:8px;">` +
    `${esc(label)}` +
    `</a>` +
    `</td></tr></table>`
  );
}

function ctaSubline(text: string): string {
  return `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#e8edf4;text-align:center;">${esc(text)}</p>`;
}

function signupUrlLine(): string {
  return (
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#8b95a5;word-break:break-all;">` +
    `<a href="${esc(CLINIC_INVITE_SIGNUP_URL)}" style="color:#e8c547;text-decoration:none;">${esc(CLINIC_INVITE_SIGNUP_URL)}</a>` +
    `</p>`
  );
}

function clinicInviteCta(options?: { includeSignupUrl?: boolean }): string {
  return (
    ctaButton(CLINIC_INVITE_SIGNUP_URL, CLINIC_INVITE_CTA_BUTTON) +
    ctaSubline(CLINIC_INVITE_CTA_SUBLINE) +
    (options?.includeSignupUrl ? signupUrlLine() : '')
  );
}

export function clinicInviteText(): string {
  return [
    CLINIC_INVITE_SUBJECT,
    '',
    'When a laser dies or a PM is coming due, you should not have to scroll old texts looking for a tech. Post the job. Nearby shops see it. Someone takes it.',
    '',
    'The report, the estimate, and the invoice live on that same job, so you are not chasing paperwork after the tech leaves.',
    '',
    CLINIC_INVITE_CTA_PLAIN,
    CLINIC_INVITE_SIGNUP_URL,
    '',
    'Service history stays with the device. It is available to you regardless of who performed it. No more guessing from photos in a group chat!',
    '',
    'Write the need once. Shops bid. You pick who comes. The approved estimate becomes the invoice draft.',
    '',
    'We are asking a handful of laser clinics to try this on repairplanet.net before we get loud. It is early. That is the point. You will see rough edges, and we want the notes from people who actually run the rooms.',
    '',
    CLINIC_INVITE_CTA_PLAIN,
    CLINIC_INVITE_SIGNUP_URL,
    '',
    'If you own the clinic, register it. First login is admin. Invite the front desk from Team. If this landed with the wrong person, forward it to the owner.',
    '',
    'After you try it you can stay on the free plan, keep Premium, or walk away.',
    '',
    'Total Service Pro / Medical Repair Network / repairplanet.net',
    '',
    `Unsubscribe: ${CLINIC_INVITE_UNSUBSCRIBE_URL}`,
    '',
    CLINIC_INVITE_POSTAL_ADDRESS,
  ].join('\n');
}

export function clinicInviteHtml(): string {
  const inner =
    paragraph(
      'When a laser dies or a PM is coming due, you should not have to scroll old texts looking for a tech. Post the job. Nearby shops see it. Someone takes it.'
    ) +
    hero() +
    paragraph(
      'The report, the estimate, and the invoice live on that same job, so you are not chasing paperwork after the tech leaves.'
    ) +
    clinicInviteCta() +
    paragraph(
      'Service history stays with the device. It is available to you regardless of who performed it. No more guessing from photos in a group chat!'
    ) +
    paragraph(
      'Write the need once. Shops bid. You pick who comes. The approved estimate becomes the invoice draft.'
    ) +
    paragraph(
      'We are asking a handful of laser clinics to try this on repairplanet.net before we get loud. It is early. That is the point. You will see rough edges, and we want the notes from people who actually run the rooms.'
    ) +
    clinicInviteCta({ includeSignupUrl: true }) +
    paragraph(
      'If you own the clinic, register it. First login is admin. Invite the front desk from Team. If this landed with the wrong person, forward it to the owner.'
    ) +
    paragraph('After you try it you can stay on the free plan, keep Premium, or walk away.');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(CLINIC_INVITE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#0b0f14;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8edf4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0f14;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#121820;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background:#e8c547;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;text-align:center;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#e8c547;text-transform:uppercase;">TOTAL SERVICE PRO</div>
              <h1 style="margin:10px 0 0;font-size:28px;line-height:1.25;color:#e8edf4;font-weight:800;">${esc(CLINIC_INVITE_SUBJECT)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 8px;">${inner}</td>
          </tr>
          <tr>
            <td style="padding:16px 28px 28px;border-top:1px solid #243040;text-align:center;">
              <div style="font-size:12px;line-height:1.6;color:#8b95a5;">
                Total Service Pro / Medical Repair Network /
                <a href="https://repairplanet.net" style="color:#8b95a5;text-decoration:none;">repairplanet.net</a>
              </div>
              <div style="margin-top:10px;font-size:11px;line-height:1.6;color:#6b7380;">
                <a href="${esc(CLINIC_INVITE_UNSUBSCRIBE_URL)}" style="color:#6b7380;text-decoration:underline;">Unsubscribe</a>
              </div>
              <div style="margin-top:10px;font-size:11px;line-height:1.6;color:#6b7380;">
                ${esc(CLINIC_INVITE_POSTAL_ADDRESS)}
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
