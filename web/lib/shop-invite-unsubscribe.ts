/**
 * RFC 8058 one-click unsubscribe for the locked shop-invite send.
 * Headers only on the Resend payload — does not rewrite invite HTML/PNGs.
 */

import { randomBytes } from 'node:crypto';

export const UNSUBSCRIBE_MAILTO = 'mailto:contact@medicalrepairnetwork.com?subject=unsubscribe';
export const UNSUBSCRIBE_ORIGIN = 'https://repairplanet.net';
export const UNSUBSCRIBE_PATH = '/unsubscribe';
export const LIST_UNSUBSCRIBE_POST = 'List-Unsubscribe=One-Click';

export function newUnsubscribeToken(): string {
  return randomBytes(32).toString('hex');
}

export function isValidUnsubscribeToken(value?: string | null): boolean {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

export function unsubscribeHttpsUrl(token: string): string {
  const clean = String(token || '').trim();
  return `${UNSUBSCRIBE_ORIGIN}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(clean)}`;
}

export function listUnsubscribeHeader(token: string): string {
  return `<${UNSUBSCRIBE_MAILTO}>, <${unsubscribeHttpsUrl(token)}>`;
}

export function shopInviteResendHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': listUnsubscribeHeader(token),
    'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_POST,
  };
}

export function parseUnsubscribePostBody(raw: string): { oneClick: boolean; token: string } {
  const text = String(raw || '');
  const params = new URLSearchParams(text);
  const oneClick =
    text.trim() === LIST_UNSUBSCRIBE_POST || params.get('List-Unsubscribe') === 'One-Click';
  return { oneClick, token: String(params.get('token') || '').trim() };
}

export function unsubscribePageHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_POST,
  };
  if (isValidUnsubscribeToken(token)) {
    headers['List-Unsubscribe'] = listUnsubscribeHeader(String(token).trim());
  } else {
    headers['List-Unsubscribe'] = `<${UNSUBSCRIBE_MAILTO}>, <${UNSUBSCRIBE_ORIGIN}${UNSUBSCRIBE_PATH}>`;
  }
  return headers;
}

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type UnsubscribePageStatus = 'form' | 'done' | 'already' | 'missing' | 'invalid';

export function shopInviteUnsubscribePageHtml(opts: {
  status: UnsubscribePageStatus;
  token?: string | null;
}): string {
  const token = String(opts.token || '').trim();
  const action = isValidUnsubscribeToken(token) ? unsubscribeHttpsUrl(token) : `${UNSUBSCRIBE_ORIGIN}${UNSUBSCRIBE_PATH}`;
  let title = 'Unsubscribe';
  let body = '';

  if (opts.status === 'done' || opts.status === 'already') {
    title = 'Unsubscribed';
    body =
      `<p>You will no longer receive shop invites from Total Service Pro / Medical Repair Network.</p>` +
      `<p>If you still see mail, write <a href="${esc(UNSUBSCRIBE_MAILTO)}">contact@medicalrepairnetwork.com</a> with subject unsubscribe.</p>`;
  } else if (opts.status === 'invalid' || opts.status === 'missing') {
    title = 'Unsubscribe';
    body =
      `<p>Use the unsubscribe link in the email, or write <a href="${esc(UNSUBSCRIBE_MAILTO)}">contact@medicalrepairnetwork.com</a> with subject unsubscribe.</p>`;
  } else {
    title = 'Unsubscribe from shop invites';
    body =
      `<p>Stop future shop-invite emails from Total Service Pro / Medical Repair Network.</p>` +
      `<form method="POST" action="${esc(action)}">` +
      `<input type="hidden" name="List-Unsubscribe" value="One-Click" />` +
      (isValidUnsubscribeToken(token) ? `<input type="hidden" name="token" value="${esc(token)}" />` : '') +
      `<button type="submit" style="margin:8px 0 16px;padding:12px 22px;font-size:16px;font-weight:700;color:#0b0f14;background:#e8c547;border:0;border-radius:8px;cursor:pointer;">Unsubscribe</button>` +
      `</form>` +
      `<p>Or email <a href="${esc(UNSUBSCRIBE_MAILTO)}">contact@medicalrepairnetwork.com</a>.</p>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#0b0f14;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8edf4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0f14;padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#121820;border-radius:12px;">
          <tr><td style="height:4px;line-height:4px;font-size:0;background:#e8c547;">&nbsp;</td></tr>
          <tr>
            <td style="padding:28px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#e8c547;text-transform:uppercase;">TOTAL SERVICE PRO</div>
              <h1 style="margin:10px 0 16px;font-size:24px;line-height:1.3;color:#e8edf4;">${esc(title)}</h1>
              <div style="font-size:16px;line-height:1.6;color:#e8edf4;">${body}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
