/**
 * Email when a service call is assigned to an FSE.
 * Server-only builders. Do not import from client components.
 */

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type TicketAssignCopy = {
  assigneeFirstName?: string | null;
  assignerName?: string | null;
  organizationName?: string | null;
  ticketNumber?: string | null;
  title?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  serviceType?: string | null;
  status?: string | null;
  serviceDate?: string | null;
  scheduledTime?: string | null;
  priority?: string | null;
  addressLine?: string | null;
  notes?: string | null;
  ticketUrl: string;
};

function orgName(name?: string | null): string {
  return String(name || '').trim() || 'your shop';
}

export function ticketAssignSubject(opts: {
  organizationName?: string | null;
  ticketNumber?: string | null;
  customerName?: string | null;
}): string {
  const num = String(opts.ticketNumber || '').trim();
  const customer = String(opts.customerName || '').trim();
  const shop = orgName(opts.organizationName);
  if (num && customer) return `${shop} assigned you ${num} — ${customer}`;
  if (num) return `${shop} assigned you ${num}`;
  return `${shop} assigned you a service call`;
}

export function ticketAssignText(opts: TicketAssignCopy): string {
  const greet = String(opts.assigneeFirstName || '').trim();
  const assigner = String(opts.assignerName || '').trim() || 'Your dispatcher';
  const shop = orgName(opts.organizationName);
  const lines = [
    greet ? `Hi ${greet},` : 'Hi,',
    '',
    `${assigner} at ${shop} assigned you a service call.`,
    opts.ticketNumber ? `Ticket: ${opts.ticketNumber}` : '',
    opts.title ? `Job: ${opts.title}` : '',
    opts.customerName ? `Customer: ${opts.customerName}` : '',
    opts.customerPhone ? `Phone: ${opts.customerPhone}` : '',
    opts.serviceType ? `Type: ${opts.serviceType}` : '',
    opts.status ? `Status: ${opts.status}` : '',
    opts.serviceDate
      ? `When: ${opts.serviceDate}${opts.scheduledTime ? ` ${opts.scheduledTime}` : ''}`
      : '',
    opts.priority ? `Priority: ${opts.priority}` : '',
    opts.addressLine ? `Where: ${opts.addressLine}` : '',
    opts.notes ? `Notes: ${opts.notes}` : '',
    '',
    `Open ticket: ${opts.ticketUrl}`,
    '',
    'Sent by Total Service Pro · repairplanet.net',
  ];
  return lines.filter((line, i) => line !== '' || (i > 0 && lines[i - 1] !== '')).join('\n');
}

export function ticketAssignHtml(opts: TicketAssignCopy): string {
  const subject = ticketAssignSubject(opts);
  const greet = String(opts.assigneeFirstName || '').trim();
  const assigner = esc(String(opts.assignerName || '').trim() || 'Your dispatcher');
  const shop = esc(orgName(opts.organizationName));
  const rows: Array<[string, string]> = [];
  if (opts.ticketNumber) rows.push(['Ticket', String(opts.ticketNumber)]);
  if (opts.title) rows.push(['Job', String(opts.title)]);
  if (opts.customerName) rows.push(['Customer', String(opts.customerName)]);
  if (opts.customerPhone) rows.push(['Phone', String(opts.customerPhone)]);
  if (opts.serviceType) rows.push(['Type', String(opts.serviceType)]);
  if (opts.status) rows.push(['Status', String(opts.status)]);
  if (opts.serviceDate) {
    rows.push([
      'When',
      `${opts.serviceDate}${opts.scheduledTime ? ` · ${opts.scheduledTime}` : ''}`,
    ]);
  }
  if (opts.priority) rows.push(['Priority', String(opts.priority)]);
  if (opts.addressLine) rows.push(['Where', String(opts.addressLine)]);
  if (opts.notes) rows.push(['Notes', String(opts.notes)]);

  const details = rows
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:6px 12px 6px 0;font-size:12px;color:#8b95a5;white-space:nowrap;vertical-align:top;">${esc(label)}</td>` +
        `<td style="padding:6px 0;font-size:15px;color:#e8edf4;vertical-align:top;">${esc(value)}</td>` +
        `</tr>`
    )
    .join('');

  const inner =
    `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#e8edf4;">` +
    (greet ? `Hi ${esc(greet)},` : 'Hi,') +
    `</p>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#e8edf4;">` +
    `<strong>${assigner}</strong> at <strong>${shop}</strong> assigned you a service call.` +
    `</p>` +
    (details
      ? `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 8px;">${details}</table>`
      : '') +
    `<table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:22px auto 8px;">` +
    `<tr><td align="center" style="border-radius:8px;background:#d4af37;">` +
    `<a href="${esc(opts.ticketUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#111111;text-decoration:none;border-radius:8px;">Open ticket</a>` +
    `</td></tr></table>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(subject)}</title>
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
              <div style="font-size:13px;color:#8b95a5;margin-top:6px;">A job was assigned to you</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 8px;">${inner}</td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #243040;text-align:center;">
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

export async function sendTicketAssignedEmail(opts: {
  to: string;
  copy: TicketAssignCopy;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const to = String(opts.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, error: 'Assignee has no valid email' };
  }
  const subject = ticketAssignSubject(opts.copy);
  const from =
    process.env.NOTIFY_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    'Total Service Pro <contact@medicalrepairnetwork.com>';
  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: ticketAssignHtml(opts.copy),
      text: ticketAssignText(opts.copy),
    }),
  });
  if (!rr.ok) {
    const result = await rr.json().catch(() => ({}));
    return { ok: false, error: result?.message || `Email provider error (${rr.status})` };
  }
  return { ok: true };
}
