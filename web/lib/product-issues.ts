/**
 * Tester / user "Report an Issue" reports for Total Service Pro.
 * Team copy goes to the product inbox plus QA. When we have a valid reporter
 * address, one confirmation is sent after the report is accepted.
 */

export const PRODUCT_ISSUES_INBOX_DEFAULT = 'contact@medicalrepairnetwork.com';
export const PRODUCT_ISSUES_QA_INBOX = 'FieldserviceTotalService+QA@gmail.com';
export const PRODUCT_ISSUE_CONFIRM_REPLY_TO = 'FieldserviceTotalService+QA@gmail.com';
export const PRODUCT_ISSUES_FROM_DEFAULT =
  'Total Service Pro <contact@medicalrepairnetwork.com>';
export const WHAT_HAPPENED_MIN = 10;
export const WHAT_HAPPENED_MAX = 4000;
export const PAGE_URL_MAX = 2000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProductIssueInput = {
  whatHappened?: unknown;
  pageUrl?: unknown;
  userAgent?: unknown;
  email?: unknown;
};

export type ProductIssueReport = {
  whatHappened: string;
  pageUrl: string;
  userAgent: string;
};

export type ProductIssueMailPlan = {
  reporterEmail: string | null;
  teamRecipients: string[];
  confirmationTo: string | null;
};

function normalizeEmail(value: unknown): string | null {
  const email = String(value || '').trim();
  if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function isValidReporterEmail(value: unknown): boolean {
  return normalizeEmail(value) != null;
}

export function parseSubmittedEmail(value: unknown):
  | { ok: true; email: string | null }
  | { ok: false; error: string } {
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: true, email: null };
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, error: 'That email does not look valid.' };
  return { ok: true, email };
}

export function resolveReporterEmail(opts: {
  sessionEmail?: string | null;
  submittedEmail?: unknown;
}): { ok: true; email: string | null } | { ok: false; error: string } {
  const submitted = parseSubmittedEmail(opts.submittedEmail);
  if (!submitted.ok) return submitted;
  if (submitted.email) return { ok: true, email: submitted.email };
  return { ok: true, email: normalizeEmail(opts.sessionEmail) };
}

export function shouldSendReporterConfirmation(opts: {
  email?: string | null;
  alreadySent?: boolean;
}): boolean {
  if (opts.alreadySent) return false;
  return normalizeEmail(opts.email) != null;
}

export function productIssuesFromAddress(): string {
  return (
    process.env.NOTIFY_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    PRODUCT_ISSUES_FROM_DEFAULT
  );
}

/** Primary product inbox (env or contact@). Does not include the QA plus-address. */
export function productIssuesInbox(): string {
  const fromEnv = String(
    process.env.PRODUCT_ISSUES_INBOX || process.env.SUPPORT_EMAIL || ''
  ).trim();
  if (normalizeEmail(fromEnv)) return fromEnv;
  return PRODUCT_ISSUES_INBOX_DEFAULT;
}

/**
 * Team recipients for the issue report.
 * Default: contact@ plus QA. If PRODUCT_ISSUES_INBOX (or SUPPORT_EMAIL) is a
 * valid address, honor that inbox and do not force contact@ back on.
 * QA still receives a copy unless the honored inbox is already QA.
 */
export function productIssuesTeamRecipients(): string[] {
  const inbox = productIssuesInbox();
  const recipients = [inbox];
  if (inbox.toLowerCase() !== PRODUCT_ISSUES_QA_INBOX.toLowerCase()) {
    recipients.push(PRODUCT_ISSUES_QA_INBOX);
  }
  return recipients;
}

export function planProductIssueMail(opts: {
  sessionEmail?: string | null;
  submittedEmail?: unknown;
  confirmationAlreadySent?: boolean;
}): { ok: true; plan: ProductIssueMailPlan } | { ok: false; error: string } {
  const resolved = resolveReporterEmail({
    sessionEmail: opts.sessionEmail,
    submittedEmail: opts.submittedEmail,
  });
  if (!resolved.ok) return resolved;
  const confirmationTo = shouldSendReporterConfirmation({
    email: resolved.email,
    alreadySent: opts.confirmationAlreadySent,
  })
    ? resolved.email
    : null;
  return {
    ok: true,
    plan: {
      reporterEmail: resolved.email,
      teamRecipients: productIssuesTeamRecipients(),
      confirmationTo,
    },
  };
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

function confirmationNote(opts: {
  reporterEmail?: string | null;
  confirmationSent?: boolean;
}): string {
  if (opts.confirmationSent && opts.reporterEmail) {
    return `Confirmation sent to ${opts.reporterEmail}.`;
  }
  if (opts.reporterEmail) {
    return 'Reporter left an address; confirmation is sent after this report is accepted.';
  }
  return 'No reporter email — confirmation was not sent.';
}

export function productIssueText(opts: {
  report: ProductIssueReport;
  reporterEmail?: string | null;
  reporterUserId?: string | null;
  confirmationSent?: boolean;
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
    confirmationNote(opts),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function productIssueHtml(opts: {
  report: ProductIssueReport;
  reporterEmail?: string | null;
  reporterUserId?: string | null;
  confirmationSent?: boolean;
}): string {
  const { report, reporterEmail, reporterUserId } = opts;
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;color:#111827;line-height:1.45">
  <h2 style="color:#92400e;margin:0 0 12px">Total Service Pro — issue report</h2>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Tester / user report. ${esc(confirmationNote(opts))}</p>
  <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">What happened</p>
  <pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;padding:12px;border-radius:8px">${esc(report.whatHappened)}</pre>
  <p><strong>Page / URL:</strong> ${esc(report.pageUrl || '(not provided)')}</p>
  <p><strong>Reporter:</strong> ${esc(reporterEmail || '(signed out)')}${
    reporterUserId ? `<br><span style="color:#6b7280;font-size:12px">User id: ${esc(reporterUserId)}</span>` : ''
  }</p>
  <p style="color:#6b7280;font-size:12px"><strong>User agent:</strong> ${esc(report.userAgent || '(not provided)')}</p>
</body></html>`;
}

export function productIssueConfirmationSubject(): string {
  return 'We received your Total Service Pro report';
}

export function productIssueConfirmationText(): string {
  return [
    'Hi,',
    '',
    'Thanks for writing. We received your issue report, and the Total Service Pro team is looking into it.',
    '',
    'You do not need to reply unless you have more to add. If we need details, we will write you.',
    '',
    '— Total Service Pro',
    'repairplanet.net',
  ].join('\n');
}

export function productIssueConfirmationHtml(): string {
  const subject = productIssueConfirmationSubject();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
          <tr>
            <td style="padding:22px 24px 8px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#92400e;text-transform:uppercase;">Total Service Pro</div>
              <h1 style="margin:10px 0 0;font-size:20px;line-height:1.35;color:#111827;">We received your report</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 24px 8px;font-size:15px;line-height:1.55;color:#374151;">
              <p style="margin:0 0 12px;">Hi,</p>
              <p style="margin:0 0 12px;">Thanks for writing. We received your issue report, and the Total Service Pro team is looking into it.</p>
              <p style="margin:0 0 12px;">You do not need to reply unless you have more to add. If we need details, we will write you.</p>
              <p style="margin:0;">— Total Service Pro</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 22px;font-size:12px;color:#6b7280;">
              repairplanet.net
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
