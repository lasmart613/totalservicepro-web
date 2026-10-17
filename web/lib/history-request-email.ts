/**
 * Emails for service history access requests (000922). Server-only.
 * The clinic's email names the requesting shop (its real organization name),
 * the clinic's own laser and how many reports are locked. It never carries
 * report contents, other shops' names, or a sign-in-free link.
 */

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clean(s: unknown, max = 120): string {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export type HistoryRequestEmailCopy = {
  firstName?: string | null;
  shopName?: string | null;
  clinicName?: string | null;
  laser?: string | null;
  serialNumber?: string | null;
  reportCount?: number | null;
  url: string;
};

function shop(c: HistoryRequestEmailCopy): string {
  return clean(c.shopName) || 'A service company';
}

function laserLine(c: HistoryRequestEmailCopy): string {
  const laser = clean(c.laser) || 'your laser';
  const sn = clean(c.serialNumber, 60);
  return sn ? `${laser} (SN ${sn})` : laser;
}

export function historyRequestSubject(c: HistoryRequestEmailCopy): string {
  return `${shop(c)} is asking to see your laser's service history`;
}

export function historyRequestText(c: HistoryRequestEmailCopy): string {
  const n = Math.max(0, Math.trunc(Number(c.reportCount) || 0));
  return [
    clean(c.firstName) ? `Hi ${clean(c.firstName)},` : 'Hi,',
    '',
    `${shop(c)} asked to see the earlier service history of ${laserLine(c)}.`,
    n ? `${n} earlier report${n === 1 ? ' is' : 's are'} locked until you decide.` : '',
    '',
    'Approve or deny in Total Service Pro (sign in required):',
    c.url,
    '',
    'Nothing is shared unless you approve. You can revoke access later.',
    'Turn these emails off in the same page.',
    '',
    'Sent by Total Service Pro · repairplanet.net',
  ]
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n');
}

export function historyRequestHtml(c: HistoryRequestEmailCopy): string {
  const n = Math.max(0, Math.trunc(Number(c.reportCount) || 0));
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111">
<p>${clean(c.firstName) ? `Hi ${esc(clean(c.firstName))},` : 'Hi,'}</p>
<p><strong>${esc(shop(c))}</strong> asked to see the earlier service history of ${esc(laserLine(c))}.</p>
${n ? `<p>${n} earlier report${n === 1 ? ' is' : 's are'} locked until you decide.</p>` : ''}
<p><a href="${esc(c.url)}" style="background:#c9a227;color:#111;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Review the request</a></p>
<p style="color:#555;font-size:13px">Sign in required. Nothing is shared unless you approve, and you can revoke access later. You can turn these emails off on the same page.</p>
<p style="color:#888;font-size:12px">Sent by Total Service Pro · repairplanet.net</p>
</body></html>`;
}

export function historyApprovedSubject(c: HistoryRequestEmailCopy): string {
  return `${clean(c.clinicName) || 'The clinic'} shared a laser's service history with you`;
}

export function historyApprovedText(c: HistoryRequestEmailCopy): string {
  return [
    clean(c.firstName) ? `Hi ${clean(c.firstName)},` : 'Hi,',
    '',
    `${clean(c.clinicName) || 'The clinic'} approved your request for the earlier service history of ${laserLine(c)}.`,
    '',
    'Open it in Total Service Pro:',
    c.url,
    '',
    'Sent by Total Service Pro · repairplanet.net',
  ].join('\n');
}

export function historyApprovedHtml(c: HistoryRequestEmailCopy): string {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111">
<p>${clean(c.firstName) ? `Hi ${esc(clean(c.firstName))},` : 'Hi,'}</p>
<p><strong>${esc(clean(c.clinicName) || 'The clinic')}</strong> approved your request for the earlier service history of ${esc(laserLine(c))}.</p>
<p><a href="${esc(c.url)}">Open it in Total Service Pro</a></p>
<p style="color:#888;font-size:12px">Sent by Total Service Pro · repairplanet.net</p>
</body></html>`;
}

export type OutgoingEmail = { to: string; subject: string; html: string; text: string };

export function isEmailAddress(s: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

/** Resend sender (same env and from-address as the other notification emails). */
export async function sendResendEmail(
  msg: OutgoingEmail,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  if (!isEmailAddress(msg.to)) return { ok: false, error: 'No valid email' };
  const from =
    process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM || 'Total Service Pro <contact@medicalrepairnetwork.com>';
  const rr = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [msg.to.trim()], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!rr.ok) {
    const result = await rr.json().catch(() => ({}));
    return { ok: false, error: (result as any)?.message || `Email provider error (${rr.status})` };
  }
  return { ok: true };
}
