import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECKED_IN_STATUS,
  canCheckIn,
  checkInPatch,
  checkInState,
  checkInReportHref,
  commentsWithArrival,
  formatArrival,
  ticketAssetTag,
  ticketSerialNumber,
} from './ticket-checkin.ts';
import { reportPrefillFromTicket } from './ticket-service-report.ts';
import { APP_STRING_KEYS, appStrings } from './i18n/app-copy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

test('ticket serial: ticket value wins, equipment record fills a blank', () => {
  assert.equal(ticketSerialNumber({ serial_number: 'T-1' }, { serial_number: 'E-1' }), 'T-1');
  assert.equal(ticketSerialNumber({ serial_number: '  ' }, { serial_number: 'E-1' }), 'E-1');
  assert.equal(ticketSerialNumber({}, null), '');
});

test('asset tag shows only when a record has one', () => {
  assert.equal(ticketAssetTag({}, { asset_tag: 'AT-9' }), 'AT-9');
  assert.equal(ticketAssetTag({}, {}), '');
});

test('check-in patch records now and On Site', () => {
  const now = new Date('2026-11-02T20:05:00Z');
  assert.deepEqual(checkInPatch(now), { arrival_time: '2026-11-02T20:05:00.000Z', status: CHECKED_IN_STATUS });
  assert.equal(CHECKED_IN_STATUS, 'On Site');
});

test('arrival formats in the org zone', () => {
  assert.equal(formatArrival('2026-11-02T20:05:00Z', 'America/Phoenix'), '11/2/2026, 1:05 PM MST');
  assert.equal(formatArrival('2026-11-02T20:05:00Z', 'America/New_York'), '11/2/2026, 3:05 PM EST');
  assert.equal(formatArrival('', 'America/Phoenix'), '');
  assert.equal(formatArrival('nope', 'America/Phoenix'), '');
});

test('arrival line is prepended to comments once', () => {
  assert.equal(commentsWithArrival('Laser no fire', '11/2/2026, 1:05 PM MST'), 'Arrival: 11/2/2026, 1:05 PM MST\n\nLaser no fire');
  assert.equal(commentsWithArrival('', 'X'), 'Arrival: X');
  assert.equal(commentsWithArrival('Arrival: X\n\nfoo', 'Y'), 'Arrival: X\n\nfoo');
  assert.equal(commentsWithArrival('foo', ''), 'foo');
});

test('check-in href opens a new report for the ticket in check-in mode', () => {
  assert.equal(checkInReportHref(42), '/reports/new?ticketId=42&checkin=1');
});

test('report prefill carries arrival time and equipment serial fallback', () => {
  const p = reportPrefillFromTicket({
    ticket: { id: 7, ticket_number: 'TK-7', arrival_time: '2026-11-02T20:05:00Z', equipment_id: 3, description: 'No fire' },
    equipment: { id: 3, manufacturer: 'Cutera', model: 'Excel V', serial_number: 'SN-123' },
  });
  assert.ok(p);
  assert.equal(p!.arrivalTime, '2026-11-02T20:05:00Z');
  assert.equal(p!.serialNumber, 'SN-123');
  assert.equal(p!.equipmentMake, 'Cutera');
  assert.equal(p!.ticketNumber, 'TK-7');
  assert.equal(p!.comments, 'No fire');
});

test('check-in strings exist in every locale', () => {
  const keys = ['Check in', 'Checking in...', 'Checked in at {time}', 'Could not check in. Please try again.', 'Arrival Time', 'Asset Tag'];
  for (const key of keys) assert.ok(APP_STRING_KEYS.includes(key), key);
  for (const loc of ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const) {
    const table = appStrings(loc);
    for (const key of keys) assert.ok(table[key]?.trim(), `${loc}:${key}`);
    assert.ok(table['Checked in at {time}'].includes('{time}'), loc);
  }
});

test('ticket page wires check-in and serial fallback; report reads checkin', () => {
  const page = read('app/service-tickets/[id]/page.tsx');
  assert.match(page, /data-testid="ticket-check-in"/);
  assert.match(page, /checkInPatch\(/);
  assert.match(page, /ticketSerialNumber\(ticket, linkedEquipment\)/);
  const report = read('app/reports/new/NewServiceReportClient.tsx');
  assert.match(report, /get\('checkin'\) === '1'/);
  assert.match(report, /commentsWithArrival\(/);
});

test('check-in never overwrites an existing arrival', () => {
  assert.equal(canCheckIn({ arrival_time: null }), true);
  assert.equal(canCheckIn({ arrival_time: '' }), true);
  assert.equal(canCheckIn({ arrival_time: '2026-11-02T20:18:00Z' }), false);
});

test('check-in state: pending report vs saved report', () => {
  assert.equal(checkInState({ arrival_time: null }, 0), 'not-checked-in');
  assert.equal(checkInState({ arrival_time: '2026-11-02T20:18:00Z' }, 0), 'report-pending');
  assert.equal(checkInState({ arrival_time: '2026-11-02T20:18:00Z' }, 2), 'report-saved');
});

test('ticket page guards the update and offers Continue service report', () => {
  const src = read('app/service-tickets/[id]/page.tsx');
  assert.match(src, /\.is\('arrival_time', null\)/);
  assert.match(src, /checkIn === 'not-checked-in'/);
  assert.match(src, /ticket-continue-report/);
  assert.match(src, /checkIn === 'report-pending'/);
  assert.ok(APP_STRING_KEYS.includes('Continue service report'));
});
