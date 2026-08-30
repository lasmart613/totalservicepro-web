/**
 * Tester / user "Report an Issue" reports for Total Service Pro.
 * Delivered to the existing product contact inbox (same From/To path as other TSP mail).
 * Does not send a confirmation to the reporter.
 */

export const PRODUCT_ISSUES_INBOX_DEFAULT = 'contact@medicalrepairnetwork.com';
export const WHAT_HAPPENED_MIN = 10;
export const WHAT_HAPPENED_MAX = 4000;
export const PAGE_URL_MAX = 2000;

export type ProductIssueInput = {
  whatHappened?: unknown;
  pageUrl?: unknown;
  userAgent?: unknown;
};

export type ProductIssueReport = {
  whatHappened: string;
  pageUrl: string;
  userAgent: string;
};

export function productIssuesInbox(): string {
  const fromEnv = String(
    process.env.PRODUCT_ISSUES_INBOX || process.env.SUPPORT_EMAIL || ''
  ).trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEnv)) return fromEnv;
  return PRODUCT_ISSUES_INBOX_DEFAULT;
}

export function parseProductIssue(body: ProductIssueInput):
  | { ok: true; report: ProductIssueReport }
  | { ok: false; error: string } {
  const whatHappened = String(body.whatHappened || '').trim();
  if (whatHappened.length < WHAT_HAPPENED_MIN) {
    return { ok: false, error: `Please describe what happened (at least ${WHAT_HAPPENED_MIN} characters).` };
  }
  if (whatHappened.length > WHAT_HAPPENED_MAX) {
    return { ok: false, error: `Description is too long (max ${WHAT_HAPPENED_MAX} characters).` };
  }
  let pageUrl = String(body.pageUrl || '').trim();
  if (pageUrl.length > PAGE_URL_MAX) pageUrl = pageUrl.slice(0, PAGE_URL_MAX);
  if (pageUrl && !/^https?:\/\//i.test(pageUrl) && !pageUrl.startsWith('/')) {
    return { ok: false, error: 'Page URL looks invalid.' };
  }
  const userAgent = String(body.userAgent || '').trim().slice(0, 500);
  return { ok: true, report: { whatHappened, pageUrl, userAgent } };
}

export function productIssueSubject(report: ProductIssueReport): string {
  const snippet = report.whatHappened.replace(/\s+/g, ' ').slice(0, 72);
  return `TSP issue report: ${snippet}${report.whatHappened.length > 72 ? '…' : ''}`;
}

export function productIssueText(opts: {
  report: ProductIssueReport;
  reporterEmail?: string | null;
  reporterUserId?: string | null;
}): string {
  const { report, reporterEmail, reporterUserId } = opts;
  return [
    'Total Service Pro — tester issue report',
    '',
    `What happened:`,
    report.whatHappened,
    '',
    `Page / URL: ${report.pageUrl || '(not provided)'}`,
    `Reporter: ${reporterEmail || '(signed out)'}`,
    reporterUserId ? `User id: ${reporterUserId}` : '',
    `User agent: ${report.userAgent || '(not provided)'}`,
    '',
    'No confirmation was sent to the reporter.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function productIssueHtml(opts: {
  report: ProductIssueReport;
  reporterEmail?: string | null;
  reporterUserId?: string | null;
}): string {
  const esc = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const { report, reporterEmail, reporterUserId } = opts;
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;color:#111827;line-height:1.45">
  <h2 style="color:#92400e;margin:0 0 12px">Total Service Pro — issue report</h2>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Tester / user report. No confirmation was sent to the reporter.</p>
  <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">What happened</p>
  <pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;padding:12px;border-radius:8px">${esc(report.whatHappened)}</pre>
  <p><strong>Page / URL:</strong> ${esc(report.pageUrl || '(not provided)')}</p>
  <p><strong>Reporter:</strong> ${esc(reporterEmail || '(signed out)')}${
    reporterUserId ? `<br><span style="color:#6b7280;font-size:12px">User id: ${esc(reporterUserId)}</span>` : ''
  }</p>
  <p style="color:#6b7280;font-size:12px"><strong>User agent:</strong> ${esc(report.userAgent || '(not provided)')}</p>
</body></html>`;
}
