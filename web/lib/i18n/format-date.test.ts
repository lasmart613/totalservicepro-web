// Date-only values must keep their calendar day in America/Phoenix (QA #314
// live check: /my-lasers/[id] showed 2026-10-01 as 9/30/2026).
process.env.TZ = 'America/Phoenix';

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { formatDisplayDay, formatLocaleDate, parseDisplayDate } from './format-date.ts';

test('the bug: new Date(YYYY-MM-DD) is UTC midnight, the previous day in Phoenix', () => {
  assert.equal(new Date('2026-10-01').toLocaleDateString('en-US'), '9/30/2026');
});

test('formatDisplayDay keeps a date-only value on its day', () => {
  assert.equal(formatDisplayDay('2026-10-01', 'en-US'), '10/1/2026');
  assert.equal(formatDisplayDay('2026-09-15', 'en-US'), '9/15/2026');
  assert.equal(formatDisplayDay('2026-01-01', 'en-US'), '1/1/2026');
  assert.equal(formatDisplayDay(' 2026-12-31 ', 'en-US'), '12/31/2026');
});

test('formatDisplayDay still converts real timestamps to local time', () => {
  // 2026-10-01T03:00Z is 2026-09-30 20:00 in Phoenix (UTC-7).
  assert.equal(formatDisplayDay('2026-10-01T03:00:00Z', 'en-US'), '9/30/2026');
  assert.equal(formatDisplayDay('2026-10-01T20:00:00+00:00', 'en-US'), '10/1/2026');
});

test('formatDisplayDay: empty and invalid input', () => {
  assert.equal(formatDisplayDay(null), '');
  assert.equal(formatDisplayDay(undefined), '');
  assert.equal(formatDisplayDay(''), '');
  assert.equal(formatDisplayDay('not a date'), 'not a date');
  assert.equal(parseDisplayDate('not a date'), null);
  assert.equal(parseDisplayDate(null), null);
});

test('parseDisplayDate: date-only is local noon; ordering vs timestamps', () => {
  const d = parseDisplayDate('2026-10-01')!;
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 12);
  assert.ok(parseDisplayDate('2026-10-01')!.getTime() > parseDisplayDate('2026-09-30T23:00:00-07:00')!.getTime());
});

test('formatLocaleDate (existing helper) agrees on the calendar day', () => {
  assert.equal(formatLocaleDate('2026-10-01', 'en'), '10/1/2026');
});

test('pages render date-only columns through the helper, not new Date(...).toLocaleDateString()', () => {
  const root = new URL('../../', import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
  const laser = read('app/my-lasers/[id]/page.tsx');
  assert.match(laser, /formatDisplayDay\(h\.date\)/);
  assert.doesNotMatch(laser, /new Date\(h\.date\)\.toLocaleDateString/);
  assert.doesNotMatch(read('app/marketplace/requests/[id]/page.tsx'), /new Date\((request\.preferred_date|b\.proposed_date)\)\.toLocale/);
  assert.doesNotMatch(read('app/bids/page.tsx'), /new Date\(bid\.proposed_date\)\.toLocale/);
  const customer = read('app/customers/[id]/page.tsx');
  assert.match(customer, /return formatDisplayDay\(v\)/);
  assert.doesNotMatch(customer, /return new Date\(v\)\.toLocaleDateString\(\)/);
});
