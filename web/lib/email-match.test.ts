import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  containsTextImatch,
  emailsMatch,
  exactEmailIlike,
  exactEmailImatch,
  exactTextImatch,
  ilikeExact,
  normalizeLookupEmail,
  textsMatchCaseInsensitive,
} from './email-match.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('lookup emails are trimmed then lowercased', () => {
  assert.equal(normalizeLookupEmail('  Person@Example.com  '), 'person@example.com');
  assert.equal(normalizeLookupEmail(''), '');
  assert.equal(emailsMatch('Person@Example.com', ' person@example.com '), true);
  assert.equal(emailsMatch('a_b@example.com', 'aXb@example.com'), false);
  assert.equal(emailsMatch('a%b@example.com', 'axxb@example.com'), false);
  assert.equal(emailsMatch('', 'person@example.com'), false);
  assert.equal(emailsMatch('person@example.com', ''), false);
});

test('ilike exact pattern escapes backslash, percent, and underscore', () => {
  assert.equal(exactEmailIlike('  A_B%@x.com  '), 'a\\_b\\%@x.com');
  assert.equal(ilikeExact('a\\b'), 'a\\\\b');
  assert.equal(exactEmailIlike('plain@example.com'), 'plain@example.com');
  assert.equal(exactEmailIlike('a_b@example.com'), 'a\\_b@example.com');
  assert.equal(exactEmailIlike('a%b@example.com'), 'a\\%b@example.com');
  for (const pattern of [exactEmailIlike('a_b@example.com'), exactEmailIlike('a%b@example.com'), exactEmailIlike('a\\b@example.com')]) {
    assert.doesNotMatch(pattern, /(^|[^\\])[%_]/);
  }
});

test('a star in an email is not a wildcard', () => {
  assert.equal(exactEmailImatch('  A*B@x.com  '), '^a\\*b@x\\.com$');
  assert.equal(ilikeExact('a*b'), 'a*b');
  const pattern = new RegExp(exactEmailImatch('a*b@x.com'), 'i');
  assert.equal(pattern.test('a*b@x.com'), true);
  assert.equal(pattern.test('A*B@x.com'), true);
  assert.equal(pattern.test('aXXb@x.com'), false);
  assert.equal(pattern.test('ab@x.com'), false);
  assert.equal(pattern.test('a%b@x.com'), false);
  assert.equal(emailsMatch('a*b@x.com', 'aXXb@x.com'), false);
  assert.equal(emailsMatch('A*B@x.com', 'a*b@x.com'), true);
});

test('exact text match treats star, percent, and underscore as literals', () => {
  assert.equal(exactTextImatch('  Acme*Laser  '), '^acme\\*laser$');
  assert.equal(exactTextImatch('A%B_C'), '^a%b_c$');
  assert.equal(exactEmailImatch('A*B@x.com'), exactTextImatch('A*B@x.com'));
  for (const sample of ['Acme*Laser', 'a%b', 'a_b']) {
    const pattern = new RegExp(exactTextImatch(sample), 'i');
    assert.equal(pattern.test(sample), true, sample);
    assert.equal(pattern.test(sample.toUpperCase()), true, sample);
    assert.equal(pattern.test(sample.replace(/[*_%]/, 'XX')), false, sample);
    assert.equal(textsMatchCaseInsensitive(sample, `  ${sample.toUpperCase()}  `), true, sample);
    assert.equal(textsMatchCaseInsensitive(sample, sample.replace(/[*_%]/, 'XX')), false, sample);
  }
  assert.equal(textsMatchCaseInsensitive('', 'acme'), false);
  assert.equal(textsMatchCaseInsensitive('  ', 'acme'), false);
  const contains = containsTextImatch('A*B%C_D');
  assert.equal(contains, 'A\\*B%C_D');
  assert.equal(new RegExp(contains, 'i').test('xxa*b%c_dyy'), true);
  assert.equal(new RegExp(contains, 'i').test('xxaxxb%c_dyy'), false);
  assert.equal(new RegExp(contains, 'i').test('xxa*bXc_dyy'), false);
  assert.equal(new RegExp(contains, 'i').test('xxa*b%cXdyy'), false);
});

test('exact text callers re-check and do not use unescaped ilike', () => {
  const named = [
    ['../app/api/god/blast/send/route.ts', /recipientUnsubscribed\(/],
    ['../app/api/god/invite/send/route.ts', /recipientUnsubscribed\(/],
    ['./pending-signup.ts', /exactTextImatch\(/],
    ['./equipment-ensure.ts', /exactTextImatch\(/],
    ['../app/customers/[id]/page.tsx', /exactTextImatch\(/],
    ['../app/my-lasers/[id]/page.tsx', /loadServiceRequestsForLaser\(/],
  ] as const;
  for (const [rel, marker] of named) {
    const source = readFileSync(join(here, rel), 'utf8');
    assert.match(source, marker, rel);
    assert.doesNotMatch(source, /\.ilike\(/, rel);
  }
  const pending = readFileSync(join(here, './pending-signup.ts'), 'utf8');
  assert.match(pending, /textsMatchCaseInsensitive\(/);
  assert.doesNotMatch(pending, /exactEmailImatch\(/);
  const customer = readFileSync(join(here, '../app/customers/[id]/page.tsx'), 'utf8');
  assert.match(customer, /textsMatchCaseInsensitive\(/);
  const equipment = readFileSync(join(here, './equipment-ensure.ts'), 'utf8');
  assert.match(equipment, /textsMatchCaseInsensitive\(/);
  const lasers = readFileSync(join(here, '../app/my-lasers/[id]/page.tsx'), 'utf8');
  assert.doesNotMatch(lasers, /\.or\(/);
  const unsub = readFileSync(join(here, './shop-invite-unsubscribe.ts'), 'utf8');
  assert.match(unsub, /exactEmailImatch\(/);
  assert.match(unsub, /emailsMatch\(/);
  assert.doesNotMatch(unsub, /\.ilike\(/);
});

test('exact email callers re-check with emailsMatch and do not use ilike or or()', () => {
  const files = [
    '../app/api/org/memberships/route.ts',
    '../app/api/team/invite/route.ts',
    '../app/api/team/claim/route.ts',
    './team-profile.ts',
  ];
  for (const rel of files) {
    const source = readFileSync(join(here, rel), 'utf8');
    assert.match(source, /exactEmailImatch\(/, rel);
    assert.match(source, /emailsMatch\(/, rel);
    assert.doesNotMatch(source, /exactEmailIlike\(/, rel);
    assert.doesNotMatch(source, /\.ilike\(\s*['"]email['"]/, rel);
    assert.doesNotMatch(source, /\.or\(/, rel);
  }
});

test('lowercase profile email oneoff is find, update, and rollback and is not a migration', () => {
  const dir = join(here, '../supabase/oneoff');
  const find = readFileSync(join(dir, '20261009_lowercase_profile_emails_find.sql'), 'utf8');
  const update = readFileSync(join(dir, '20261009_lowercase_profile_emails.sql'), 'utf8');
  const rollback = readFileSync(join(dir, '20261009_lowercase_profile_emails_rollback.sql'), 'utf8');
  assert.doesNotMatch(find, /\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
  assert.match(find, /lower\(btrim\(p\.email\)\)/);
  assert.match(find, /user_profiles/);
  assert.match(update, /SET LOCAL lock_timeout = '5s'/);
  assert.match(update, /case-insensitive user_profiles\.email collision/);
  assert.match(update, /SET email = lower\(btrim\(email\)\)/);
  assert.doesNotMatch(update, /auth\.users/);
  assert.doesNotMatch(update, /\bCOMMIT\b/i);
  assert.match(rollback, /SET LOCAL lock_timeout = '5s'/);
  assert.match(rollback, /find query/i);
  assert.doesNotMatch(rollback, /\bCOMMIT\b/i);
});
