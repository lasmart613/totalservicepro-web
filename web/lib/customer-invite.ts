/**
 * Clinic / customer profile invite — HMAC claim token + RepairPlanet email HTML.
 * Server-only (uses Node crypto + env secrets). Do not import from client components.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const CUSTOMER_INVITE_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

export type CustomerInvitePayload = {
  orgId: string;
  email: string;
  name: string;
  exp: number;
};

export function isValidCustomerEmail(email: string): boolean {
  const e = String(email || '').trim();
  if (e.length < 6 || e.length > 254 || /\s/.test(e)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function inviteSecret(): string | null {
  return (
    process.env.CUSTOMER_INVITE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    null
  );
}

export function canSignCustomerInvite(): boolean {
  return Boolean(inviteSecret());
}

export function signCustomerInvite(payload: Omit<CustomerInvitePayload, 'exp'>, ttlSec = CUSTOMER_INVITE_TTL_SEC): string {
  const secret = inviteSecret();
  if (!secret) throw new Error('Invite signing is not configured');
  const body: CustomerInvitePayload = {
    orgId: String(payload.orgId),
    email: payload.email.trim().toLowerCase(),
    name: payload.name.trim(),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyCustomerInvite(token: string): CustomerInvitePayload | null {
  const secret = inviteSecret();
  if (!secret) return null;
  const raw = String(token || '').trim();
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const encoded = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!encoded || !sig) return null;

  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CustomerInvitePayload;
    if (!parsed?.orgId || !parsed?.email || !parsed?.exp) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!isValidCustomerEmail(parsed.email)) return null;
    return {
      orgId: String(parsed.orgId),
      email: String(parsed.email).trim().toLowerCase(),
      name: String(parsed.name || '').trim(),
      exp: Number(parsed.exp),
    };
  } catch {
    return null;
  }
}

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function customerInviteSubject(companyName: string): string {
  const name = (companyName || 'your clinic').trim();
  return `${name} — create your free RepairPlanet account`;
}

export function customerInviteSignupUrl(origin: string, token: string | null, companyName: string, email: string): string {
  const base = String(origin || 'https://repairplanet.net').replace(/\/$/, '');
  const params = new URLSearchParams();
  if (token) params.set('claim', token);
  if (companyName) params.set('company', companyName);
  if (email) params.set('email', email);
  return `${base}/signup/owner?${params.toString()}`;
}

export function publicSiteOrigin(req?: { headers: { get: (name: string) => string | null } }): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (env) return String(env).replace(/\/$/, '');
  if (req) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    if (host) return `${proto}://${host}`;
  }
  return 'https://repairplanet.net';
}

/** Same destination as the Directory invite — claim token when we know the customer org + email. */
export function resolveFreeAccountUrls(opts: {
  origin: string;
  email?: string | null;
  companyName?: string | null;
  customerOrgId?: string | number | null;
}): { signupUrl: string; loginUrl: string } {
  const email = String(opts.email || '').trim();
  const name = String(opts.companyName || '').trim();
  let claimToken: string | null = null;
  if (opts.customerOrgId != null && opts.customerOrgId !== '' && isValidCustomerEmail(email) && canSignCustomerInvite()) {
    try {
      claimToken = signCustomerInvite({
        orgId: String(opts.customerOrgId),
        email,
        name: name || 'your clinic',
      });
    } catch {
      claimToken = null;
    }
  }
  return {
    signupUrl: customerInviteSignupUrl(opts.origin, claimToken, name, email),
    loginUrl: customerInviteLoginUrl(opts.origin, claimToken),
  };
}

/**
 * Short footer for service report / estimate / invoice *emails only*.
 * Same offer + destination as the Directory invite. Do not use in PDF builders.
 */
export function buildFreeAccountEmailCtaHtml(opts: {
  signupUrl: string;
  loginUrl: string;
  companyName?: string | null;
}): string {
  const company = esc(opts.companyName?.trim() || 'your clinic');
  return (
    `<table class="tsp-free-account-cta" role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="margin:20px 0 0;border-collapse:collapse;">` +
    `<tr><td style="padding:18px 16px;background:#0f1115;border-radius:12px;border:1px solid #2a2f3a;">` +
    `<div style="font-size:13px;font-weight:800;color:#d4a017;letter-spacing:0.02em;margin-bottom:6px;">RepairPlanet</div>` +
    `<div style="font-size:15px;font-weight:700;color:#f1f3f4;margin-bottom:8px;">Keep ${company}&apos;s service work in one place</div>` +
    `<p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#c4c7cc;">` +
    `Create a <strong style="color:#f1f3f4;">free account</strong> to view laser service history and upcoming service, ` +
    `request service / RFQs, review estimates, open manuals for your equipment, shop the parts marketplace, ` +
    `and keep ${company}&apos;s equipment list in My Lasers.` +
    `</p>` +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:12px 0 8px;"><tr>` +
    `<td style="border-radius:8px;background:#d4a017;">` +
    `<a href="${esc(opts.signupUrl)}" ` +
    `style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#111;text-decoration:none;border-radius:8px;">` +
    `Create your free account</a>` +
    `</td></tr></table>` +
    `<p style="margin:0;font-size:12px;line-height:1.5;color:#9aa0a6;">` +
    `Already on RepairPlanet? <a href="${esc(opts.loginUrl)}" style="color:#d4a017;text-decoration:none;">Sign in</a>.` +
    `</p>` +
    `</td></tr></table>`
  );
}

/** Email envelope around a billing document. PDF/print paths must not call this. */
export function wrapCustomerFacingDocumentEmail(opts: {
  subject: string;
  documentHtml: string;
  signupUrl: string;
  loginUrl: string;
  companyName?: string | null;
}): string {
  const title = esc(opts.subject);
  const already = opts.documentHtml.includes('tsp-free-account-cta');
  const cta = already
    ? ''
    : buildFreeAccountEmailCtaHtml({
        signupUrl: opts.signupUrl,
        loginUrl: opts.loginUrl,
        companyName: opts.companyName,
      });
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title}</title></head>
<body style="margin:0;padding:16px;background:#f4f4f5;font-family:system-ui,sans-serif;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:8px;box-shadow:0 2px 12px rgba(0,0,0,.06);">
    ${opts.documentHtml}
    ${cta}
  </div>
  <p style="max-width:720px;margin:16px auto 0;font-size:11px;color:#666;text-align:center;">
    Sent via Total Service Pro · <a href="https://repairplanet.net">repairplanet.net</a>
  </p>
</body></html>`;
}

export function customerInviteLoginUrl(origin: string, token: string | null): string {
  const base = String(origin || 'https://repairplanet.net').replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('next', '/my-lasers');
  if (token) params.set('claim', token);
  return `${base}/login?${params.toString()}`;
}

export function buildCustomerInviteHtml(opts: {
  companyName: string;
  contactName?: string | null;
  serviceCompanyName?: string | null;
  signupUrl: string;
  loginUrl: string;
}): string {
  const company = esc(opts.companyName || 'your clinic');
  const greet = opts.contactName?.trim()
    ? `Hi ${esc(opts.contactName.trim())},`
    : `Hello ${company} team,`;
  const fromWho = opts.serviceCompanyName?.trim()
    ? `<strong style="color:#f1f3f4;">${esc(opts.serviceCompanyName.trim())}</strong> added`
    : 'Your laser service provider added';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your free RepairPlanet account</title>
</head>
<body style="margin:0;padding:0;background:#0f1115;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8eaed;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1115;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#1a1d24;border:1px solid #2a2f3a;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px;text-align:center;">
              <div style="font-size:22px;font-weight:800;color:#d4a017;letter-spacing:0.02em;">RepairPlanet</div>
              <div style="font-size:12px;color:#9aa0a6;margin-top:6px;">Total Service Pro · laser service for clinics</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;">
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#c4c7cc;">${greet}</p>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#c4c7cc;">
                ${fromWho}
                <strong style="color:#f1f3f4;">${company}</strong>
                to RepairPlanet so your clinic has a home for service work — not another spreadsheet.
              </p>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#c4c7cc;">
                Create a <strong style="color:#f1f3f4;">free account</strong> and claim this company profile. Then you can keep track of and view:
              </p>
              <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;color:#c4c7cc;">
                <li>Laser <strong style="color:#f1f3f4;">service history</strong> on your systems</li>
                <li>Upcoming service and PM due dates</li>
                <li>A single list of <strong style="color:#f1f3f4;">${company}</strong>'s equipment (My Lasers)</li>
              </ul>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#c4c7cc;">
                Same login also unlocks the rest of the clinic side of Total Service Pro:
              </p>
              <ul style="margin:0 0 18px;padding-left:20px;font-size:15px;line-height:1.6;color:#c4c7cc;">
                <li>Request service / post an RFQ when a laser is down</li>
                <li>Review estimates your service company sends</li>
                <li>Open service manuals for your equipment</li>
                <li>Shop the parts marketplace</li>
              </ul>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0;">
                <tr>
                  <td align="center" style="border-radius:8px;background:#d4a017;">
                    <a href="${esc(opts.signupUrl)}"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#111;text-decoration:none;border-radius:8px;">
                      Create your free account
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#9aa0a6;">
                Already on RepairPlanet?
                <a href="${esc(opts.loginUrl)}" style="color:#d4a017;text-decoration:none;">Sign in to claim this profile</a>.
              </p>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#9aa0a6;">
                If you were not expecting this, you can ignore the email. Nobody else on the directory was copied.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #2a2f3a;text-align:center;">
              <div style="font-size:11px;color:#6b7280;">
                Sent by Total Service Pro ·
                <a href="https://repairplanet.net" style="color:#d4a017;text-decoration:none;">repairplanet.net</a>
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

export function buildCustomerInviteText(opts: {
  companyName: string;
  contactName?: string | null;
  serviceCompanyName?: string | null;
  signupUrl: string;
  loginUrl: string;
}): string {
  const company = opts.companyName || 'your clinic';
  const greet = opts.contactName?.trim() ? `Hi ${opts.contactName.trim()},` : `Hello ${company} team,`;
  const fromWho = opts.serviceCompanyName?.trim()
    ? `${opts.serviceCompanyName.trim()} added`
    : 'Your laser service provider added';
  return [
    greet,
    '',
    `${fromWho} ${company} to RepairPlanet (Total Service Pro).`,
    '',
    'Create a free account to claim this company profile and keep track of:',
    '• Laser service history',
    '• Upcoming service and PM due dates',
    `• ${company}'s equipment list (My Lasers)`,
    '',
    'You can also request service / RFQs, review estimates, open service manuals, and shop the parts marketplace.',
    '',
    `Create your free account: ${opts.signupUrl}`,
    `Already have an account? Sign in: ${opts.loginUrl}`,
    '',
    'If you were not expecting this, you can ignore the email.',
    'repairplanet.net',
  ].join('\n');
}
