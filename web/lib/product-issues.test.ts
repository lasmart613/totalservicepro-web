import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseProductIssue,
  parseSubmittedEmail,
  planProductIssueMail,
  productIssueConfirmationHtml,
  productIssueConfirmationSubject,
  productIssueConfirmationText,
  productIssueHtml,
  productIssueSubject,
  productIssueText,
  productIssuesInbox,
  productIssuesTeamRecipients,
  PRODUCT_ISSUE_CONFIRM_REPLY_TO,
  PRODUCT_ISSUES_INBOX_DEFAULT,
  PRODUCT_ISSUES_QA_INBOX,
  resolveReporterEmail,
  shouldSendReporterConfirmation,
} from './product-issues.ts';

const here = dirname(fileURLToPath(import.meta.url));

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    prev.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('issue report requires a short description and keeps the page URL', () => {
  assert.equal(parseProductIssue({ whatHappened: 'too short' }).ok, false);
  const ok = parseProductIssue({
    whatHappened: 'Bookshelf tap did nothing on the manuals page.',
    pageUrl: 'https://repairplanet.net/manuals',
    userAgent: 'Mozilla/5.0',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.report.pageUrl, 'https://repairplanet.net/manuals');
    assert.match(ok.report.whatHappened, /Bookshelf tap/);
  }
});

test('default team recipients are contact@ and the QA plus-address', () => {
  withEnv({ PRODUCT_ISSUES_INBOX: undefined, SUPPORT_EMAIL: undefined }, () => {
    assert.deepEqual(productIssuesTeamRecipients(), [
      PRODUCT_ISSUES_INBOX_DEFAULT,
      PRODUCT_ISSUES_QA_INBOX,
    ]);
    assert.equal(productIssuesInbox(), PRODUCT_ISSUES_INBOX_DEFAULT);
  });
});

test('PRODUCT_ISSUES_INBOX elsewhere drops contact@ and still includes QA', () => {
  withEnv({ PRODUCT_ISSUES_INBOX: 'product@repairplanet.net', SUPPORT_EMAIL: undefined }, () => {
    assert.deepEqual(productIssuesTeamRecipients(), [
      'product@repairplanet.net',
      PRODUCT_ISSUES_QA_INBOX,
    ]);
    assert.doesNotMatch(productIssuesTeamRecipients().join(','), /contact@medicalrepairnetwork\.com/);
  });
});

test('signed-in report plans one confirmation to the session email and still emails the team', () => {
  withEnv({ PRODUCT_ISSUES_INBOX: undefined, SUPPORT_EMAIL: undefined }, () => {
    const planned = planProductIssueMail({ sessionEmail: 'larry@shop.example' });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.equal(planned.plan.reporterEmail, 'larry@shop.example');
    assert.equal(planned.plan.confirmationTo, 'larry@shop.example');
    assert.deepEqual(planned.plan.teamRecipients, [
      PRODUCT_ISSUES_INBOX_DEFAULT,
      PRODUCT_ISSUES_QA_INBOX,
    ]);
    assert.equal(shouldSendReporterConfirmation({ email: planned.plan.confirmationTo }), true);
  });
});

test('guest with email plans one confirmation; guest without email accepts with no confirm', () => {
  withEnv({ PRODUCT_ISSUES_INBOX: undefined, SUPPORT_EMAIL: undefined }, () => {
    const withEmail = planProductIssueMail({ submittedEmail: 'guest@clinic.example' });
    assert.equal(withEmail.ok, true);
    if (withEmail.ok) {
      assert.equal(withEmail.plan.reporterEmail, 'guest@clinic.example');
      assert.equal(withEmail.plan.confirmationTo, 'guest@clinic.example');
      assert.ok(withEmail.plan.teamRecipients.includes(PRODUCT_ISSUES_INBOX_DEFAULT));
      assert.ok(withEmail.plan.teamRecipients.includes(PRODUCT_ISSUES_QA_INBOX));
    }

    const noEmail = planProductIssueMail({});
    assert.equal(noEmail.ok, true);
    if (noEmail.ok) {
      assert.equal(noEmail.plan.reporterEmail, null);
      assert.equal(noEmail.plan.confirmationTo, null);
      assert.ok(noEmail.plan.teamRecipients.length >= 2);
    }

    const already = planProductIssueMail({
      submittedEmail: 'guest@clinic.example',
      confirmationAlreadySent: true,
    });
    assert.equal(already.ok, true);
    if (already.ok) {
      assert.equal(already.plan.reporterEmail, 'guest@clinic.example');
      assert.equal(already.plan.confirmationTo, null);
    }
  });
});

test('guest submitted email overrides session only when provided; invalid email is rejected', () => {
  const sessionOnly = resolveReporterEmail({ sessionEmail: 'tech@shop.example' });
  assert.equal(sessionOnly.ok, true);
  if (sessionOnly.ok) assert.equal(sessionOnly.email, 'tech@shop.example');

  const override = resolveReporterEmail({
    sessionEmail: 'tech@shop.example',
    submittedEmail: 'other@shop.example',
  });
  assert.equal(override.ok, true);
  if (override.ok) assert.equal(override.email, 'other@shop.example');

  const blankKeepsSession = resolveReporterEmail({
    sessionEmail: 'tech@shop.example',
    submittedEmail: '   ',
  });
  assert.equal(blankKeepsSession.ok, true);
  if (blankKeepsSession.ok) assert.equal(blankKeepsSession.email, 'tech@shop.example');

  const invalid = parseSubmittedEmail('not-an-email');
  assert.equal(invalid.ok, false);
  const reportStillParses = parseProductIssue({
    whatHappened: 'Invoice save button stayed disabled after adding a line.',
  });
  assert.equal(reportStillParses.ok, true);
});

test('issue report and confirmation copy name Total Service Pro and do not use shop-invite phrases', () => {
  const report = {
    whatHappened: 'Invoice save button stayed disabled after adding a line.',
    pageUrl: 'https://repairplanet.net/invoices/new',
    userAgent: 'TestAgent',
  };
  const subject = productIssueSubject(report);
  assert.match(subject, /TSP issue report/);
  const text = productIssueText({
    report,
    reporterEmail: 'tech@shop.example',
    reporterUserId: 'u1',
    confirmationSent: true,
  });
  assert.match(text, /Total Service Pro/);
  assert.match(text, /Confirmation sent to tech@shop.example/);
  assert.doesNotMatch(text, /No confirmation was sent to the reporter/);
  assert.match(text, /tech@shop.example/);
  const html = productIssueHtml({
    report,
    reporterEmail: 'tech@shop.example',
    reporterUserId: 'u1',
    confirmationSent: true,
  });
  assert.match(html, /Total Service Pro/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /No confirmation was sent to the reporter/);
  assert.equal(PRODUCT_ISSUES_INBOX_DEFAULT, 'contact@medicalrepairnetwork.com');

  const confirmText = productIssueConfirmationText();
  const confirmHtml = productIssueConfirmationHtml();
  assert.match(productIssueConfirmationSubject(), /We received your Total Service Pro report/);
  assert.match(confirmText, /looking into it/);
  assert.match(confirmText, /Total Service Pro/);
  assert.match(confirmHtml, /We received your report/);
  assert.doesNotMatch(confirmText, /Free to start|Perris|Claim your business/i);
  assert.doesNotMatch(confirmHtml, /Free to start|Perris|Claim your business/i);
  assert.doesNotMatch(confirmText, /never emails the reporter/i);
});

test('Header and landing chrome always expose Report an Issue with a guest email field', () => {
  const header = readFileSync(join(here, '../components/Header.tsx'), 'utf8');
  const landing = readFileSync(join(here, '../components/landing/LandingShell.tsx'), 'utf8');
  const control = readFileSync(join(here, '../components/ReportIssueControl.tsx'), 'utf8');
  assert.match(header, /ReportIssueControl/);
  assert.match(header, /OrgSwitcher/);
  assert.match(header, /UpgradePlanLink/);
  assert.match(landing, /ReportIssueControl/);
  assert.match(landing, /variant="landing"/);
  assert.match(landing, /className="lp-root"/);
  assert.doesNotMatch(landing, /-mx-4 sm:-mx-6 lg:-mx-8 -my-6/);
  assert.match(control, /Report an Issue/);
  assert.match(control, /\/api\/product-issues/);
  assert.match(control, /pageUrl/);
  assert.match(control, /screenshot/i);
  assert.doesNotMatch(control, /tester build/i);
  assert.match(control, /Email \(optional\)/);
  assert.match(control, /guestEmail/);
  assert.match(control, /sessionEmail/);
});

test('product-issues API emails the team inbox and one reporter confirmation', () => {
  const route = readFileSync(join(here, '../app/api/product-issues/route.ts'), 'utf8');
  const lib = readFileSync(join(here, './product-issues.ts'), 'utf8');
  assert.match(route, /planProductIssueMail/);
  assert.match(route, /productIssuesTeamRecipients|teamRecipients/);
  assert.match(route, /RESEND_API_KEY/);
  assert.match(route, /product_issue_reports/);
  assert.match(route, /productIssueConfirmation/);
  assert.match(route, /PRODUCT_ISSUE_CONFIRM_REPLY_TO/);
  assert.match(route, /confirmationAlreadySent|confirmation_sent/);
  assert.match(route, /reply_to/);
  assert.doesNotMatch(route, /Never emails the reporter/);
  assert.doesNotMatch(lib, /never emails the reporter/i);
  assert.doesNotMatch(lib, /Does not send a confirmation to the reporter/);
  assert.equal(PRODUCT_ISSUE_CONFIRM_REPLY_TO, 'FieldserviceTotalService+QA@gmail.com');
});
