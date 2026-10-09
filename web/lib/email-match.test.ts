import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emailsMatch, exactEmailIlike, ilikeExact, normalizeLookupEmail } from './email-match.ts';

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
