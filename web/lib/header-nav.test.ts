import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function headerSource() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, '../components/Header.tsx'), 'utf8');
}

test('signed-in header collapses primary nav into a drawer below lg', () => {
  const header = headerSource();
  assert.match(header, /hidden lg:flex flex-wrap items-center gap-x-2\.5 gap-y-1 text-sm/);
  assert.doesNotMatch(header, /overflow-x-auto \[scrollbar-width:none\]/);
  assert.match(header, /lg:hidden inline-flex items-center justify-center min-h-11 min-w-11/);
  assert.match(header, /id="app-mobile-nav"/);
  assert.match(header, /aria-controls="app-mobile-nav"/);
  assert.match(header, /max-h-\[min\(75vh,calc\(100dvh-4rem\)\)\]/);
  assert.match(header, /fixed inset-0 z-\[80\] bg-black\/40/);
});

test('clinic / owner hub includes Estimates for dashboard review', () => {
  const header = headerSource();
  assert.match(header, /ownerMode[\s\S]*href: '\/estimates', label: 'Estimates'/);
});

test('company invite email is not the organization email field', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  const css = readFileSync(join(here, '../app/globals.css'), 'utf8');
  assert.match(page, /id="team-invite-email"/);
  assert.match(page, /type="email"/);
  assert.match(page, /autoComplete="off"/);
  assert.match(page, /Invitee email/);
  assert.match(page, /team-invite-panel/);
  const invite = page.split('id="team-invite"')[1].split('Current Team')[0];
  assert.doesNotMatch(invite, /placeholder="Email"/);
  assert.match(invite, /type="email"/);
  assert.doesNotMatch(css, /\.team-invite-panel\s*\{[^}]*z-index\s*:/);
  assert.match(css, /\.header\s*\{[^}]*z-index:\s*50/);
  assert.match(css, /scroll-padding-top:\s*7\.5rem/);
  assert.match(page, /htmlFor="company-details-email"/);
  assert.match(page, /id="company-details-email"/);
  const details = page.split('Company Details Form')[1]?.split('id="team-invite"')[0] || '';
  assert.match(details, /htmlFor="company-details-email"[\s\S]{0,240}id="company-details-email"/);
  assert.match(details, />Email</);
});

test('phone chrome keeps only brand, menu, and account — no overlapping top-bar links', () => {
  const header = headerSource();
  assert.match(header, /hidden lg:flex items-center gap-1\.5/);
  assert.match(header, /<ReportIssueControl \/>/);
  assert.match(header, /<OrgSwitcher compact \/>/);
  assert.match(header, /<ReportIssueControl showLabel \/>/);
  assert.match(header, /hidden lg:flex items-center gap-2/);
  assert.match(header, /chipLabel/);
  assert.match(header, /hidden 2xl:block text-sm font-semibold/);
  assert.doesNotMatch(header, /hidden md:flex/);
  assert.doesNotMatch(header, /md:hidden p-2/);
});
