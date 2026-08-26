import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseProductIssue,
  productIssueHtml,
  productIssueSubject,
  productIssueText,
  PRODUCT_ISSUES_INBOX_DEFAULT,
} from './product-issues.ts';

const here = dirname(fileURLToPath(import.meta.url));

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

test('issue report copy names Total Service Pro and does not write to the reporter', () => {
  const report = {
    whatHappened: 'Invoice save button stayed disabled after adding a line.',
    pageUrl: 'https://repairplanet.net/invoices/new',
    userAgent: 'TestAgent',
  };
  const subject = productIssueSubject(report);
  assert.match(subject, /TSP issue report/);
  const text = productIssueText({ report, reporterEmail: 'tech@shop.example', reporterUserId: 'u1' });
  assert.match(text, /Total Service Pro/);
  assert.match(text, /No confirmation was sent to the reporter/);
  assert.match(text, /tech@shop.example/);
  const html = productIssueHtml({ report, reporterEmail: 'tech@shop.example', reporterUserId: 'u1' });
  assert.match(html, /Total Service Pro/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(PRODUCT_ISSUES_INBOX_DEFAULT, 'contact@medicalrepairnetwork.com');
});

test('Header and landing chrome always expose Report an Issue', () => {
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
});

test('product-issues API uses the existing contact inbox and never emails the reporter', () => {
  const route = readFileSync(join(here, '../app/api/product-issues/route.ts'), 'utf8');
  assert.match(route, /productIssuesInbox/);
  assert.match(route, /RESEND_API_KEY/);
  assert.match(route, /product_issue_reports/);
  assert.doesNotMatch(route, /to:\s*\[caller/);
  assert.doesNotMatch(route, /reply_to:\s*caller/);
});
