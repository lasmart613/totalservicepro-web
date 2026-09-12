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
  assert.match(header, /hidden lg:flex items-center gap-3 xl:gap-5/);
  assert.match(header, /lg:hidden inline-flex items-center justify-center min-h-11 min-w-11/);
  assert.match(header, /id="app-mobile-nav"/);
  assert.match(header, /aria-controls="app-mobile-nav"/);
  assert.match(header, /max-h-\[min\(75vh,calc\(100dvh-4rem\)\)\]/);
  assert.match(header, /fixed inset-0 z-\[80\] bg-black\/40/);
});

test('phone chrome keeps only brand, menu, and account — no overlapping top-bar links', () => {
  const header = headerSource();
  assert.match(header, /hidden lg:flex items-center gap-2 xl:gap-3/);
  assert.match(header, /<ReportIssueControl \/>/);
  assert.match(header, /<OrgSwitcher compact \/>/);
  assert.match(header, /<ReportIssueControl showLabel \/>/);
  assert.match(header, /hidden lg:flex items-center gap-2/);
  assert.match(header, /chipLabel/);
  assert.match(header, /hidden lg:block text-sm font-semibold/);
  assert.doesNotMatch(header, /hidden md:flex/);
  assert.doesNotMatch(header, /md:hidden p-2/);
});
