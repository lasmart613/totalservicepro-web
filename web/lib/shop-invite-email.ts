/**
 * Locked shop-tester invite. Wording is product-owner locked.
 * Hosted image URLs only — email clients cannot use relative invite-assets paths.
 */

export const SHOP_INVITE_SUBJECT = 'Find Laser Repair Jobs in Your Area';
export const SHOP_INVITE_TEMPLATE_KEY = 'shop_invite';
export const SHOP_INVITE_SIGNUP_URL = 'https://repairplanet.net/signup';
export const SHOP_INVITE_UNSUBSCRIBE_URL = 'https://repairplanet.net/unsubscribe';
export const SHOP_INVITE_IMAGE_ORIGIN = 'https://repairplanet.net/email/shop-invite';

export const SHOP_INVITE_IMAGE_FILES = [
  'shot-hero.jpg',
  'shot-find-work.jpg',
  'shot-reports-email.jpg',
  'shot-billing.jpg',
  'shot-manuals-shelf.jpg',
  'shot-pdf-viewer.jpg',
] as const;

export type ShopInviteImageFile = (typeof SHOP_INVITE_IMAGE_FILES)[number];

export function shopInviteImageUrl(file: ShopInviteImageFile): string {
  return `${SHOP_INVITE_IMAGE_ORIGIN}/${file}`;
}

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

function shot(file: ShopInviteImageFile, alt: string): string {
  const src = shopInviteImageUrl(file);
  return (
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;">` +
    `<tr><td align="center">` +
    `<img src="${esc(src)}" alt="${esc(alt)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:1px solid #243040;border-radius:8px;" />` +
    `</td></tr></table>`
  );
}

function ctaButton(href: string, label: string): string {
  return (
    `<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:8px auto 20px;">` +
    `<tr><td align="center" style="border-radius:8px;background:#e8c547;">` +
    `<a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#0b0f14;text-decoration:none;border-radius:8px;">` +
    `${esc(label)}` +
    `</a>` +
    `</td></tr></table>`
  );
}

export function shopInviteText(): string {
  return [
    SHOP_INVITE_SUBJECT,
    '',
    'When a clinic has a dead laser or a PM coming due, they should not have to scroll old texts looking for a tech. They post the job. You see it. You take it.',
    '',
    'The report, the estimate, and the invoice live on that same job, so you are not rebuilding the paperwork in the truck.',
    '',
    `Claim your shop. Take the work. ${SHOP_INVITE_SIGNUP_URL}`,
    '',
    'Two months of Premium on us.',
    '',
    'Repair and PM requests from clinics near you, with the machine and the symptom already on the ticket.',
    '',
    'Service history stays with the device. It is available to you regardless of who performed it. No more guessing from photos in a group chat!',
    '',
    'Write the estimate once. They approve it. Convert the approved estimate to an invoice draft with one click.',
    '',
    'Service manuals live on the website, on shelves by brand. View your manuals online or in the app.',
    '',
    'We are asking a handful of laser shops to try this on repairplanet.net before we get loud. It is early. That is the point. You will see rough edges, and we want the notes from people who actually turn wrenches.',
    '',
    `Claim your shop. Take the work. ${SHOP_INVITE_SIGNUP_URL}`,
    '',
    'If you own the company, register it. First login is admin. Invite your techs from Team. If you are in the field, do not sign up alone. Forward this to the owner.',
    '',
    'After the two months you can stay on the free plan, keep Premium, or walk away.',
    '',
    'Total Service Pro / Medical Repair Network / repairplanet.net',
    '',
    `Unsubscribe: ${SHOP_INVITE_UNSUBSCRIBE_URL}`,
  ].join('\n');
}

export function shopInviteHtml(): string {
  const inner =
    paragraph(
      'When a clinic has a dead laser or a PM coming due, they should not have to scroll old texts looking for a tech. They post the job. You see it. You take it.'
    ) +
    paragraph(
      'The report, the estimate, and the invoice live on that same job, so you are not rebuilding the paperwork in the truck.'
    ) +
    ctaButton(SHOP_INVITE_SIGNUP_URL, 'Claim your shop. Take the work.') +
    paragraph('Two months of Premium on us.') +
    shot('shot-hero.jpg', 'Shop dashboard — open tickets and upcoming calls') +
    paragraph(
      'Repair and PM requests from clinics near you, with the machine and the symptom already on the ticket.'
    ) +
    shot('shot-find-work.jpg', 'Open repair requests near you') +
    paragraph(
      'Service history stays with the device. It is available to you regardless of who performed it. No more guessing from photos in a group chat!'
    ) +
    shot('shot-reports-email.jpg', 'Service reports list') +
    paragraph(
      'Write the estimate once. They approve it. Convert the approved estimate to an invoice draft with one click.'
    ) +
    shot('shot-billing.jpg', 'Estimate and invoice on the same job') +
    paragraph(
      'Service manuals live on the website, on shelves by brand. View your manuals online or in the app.'
    ) +
    shot('shot-manuals-shelf.jpg', 'Service manuals on shelves by brand') +
    shot('shot-pdf-viewer.jpg', 'VersaPulse Select / PowerSuite service manual viewer') +
    paragraph(
      'We are asking a handful of laser shops to try this on repairplanet.net before we get loud. It is early. That is the point. You will see rough edges, and we want the notes from people who actually turn wrenches.'
    ) +
    ctaButton(SHOP_INVITE_SIGNUP_URL, 'Claim your shop. Take the work.') +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#8b95a5;word-break:break-all;">` +
    `<a href="${esc(SHOP_INVITE_SIGNUP_URL)}" style="color:#e8c547;text-decoration:none;">${esc(SHOP_INVITE_SIGNUP_URL)}</a>` +
    `</p>` +
    paragraph(
      'If you own the company, register it. First login is admin. Invite your techs from Team. If you are in the field, do not sign up alone. Forward this to the owner.'
    ) +
    paragraph('After the two months you can stay on the free plan, keep Premium, or walk away.');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(SHOP_INVITE_SUBJECT)}</title>
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
              <h1 style="margin:10px 0 0;font-size:28px;line-height:1.25;color:#e8edf4;font-weight:800;">${esc(SHOP_INVITE_SUBJECT)}</h1>
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
                <a href="${esc(SHOP_INVITE_UNSUBSCRIBE_URL)}" style="color:#6b7380;text-decoration:underline;">Unsubscribe</a>
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

export const SHOP_INVITE_FORBIDDEN_PHRASES = [
  'Free to start',
  'No card to start',
  'This is the juicy part',
  'If this is not your shop',
  'audience pill',
] as const;
