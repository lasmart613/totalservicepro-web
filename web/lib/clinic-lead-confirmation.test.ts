import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  clinicLeadConfirmationKey,
  isConfirmationKeyConflict,
  isLeadsTableMissing,
  shouldSendConfirmation,
} from './clinic-lead-confirmation.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('confirmation key is stable per email+description+UTC day', () => {
  const t = new Date('2026-10-19T03:00:00Z');
  const a = clinicLeadConfirmationKey('QA@Example.test ', 'Laser  will not fire', t);
  const b = clinicLeadConfirmationKey('qa@example.test', 'laser will not fire', t);
  assert.equal(a, b);
  assert.match(a!, /^[0-9a-f]{32}:2026-10-19$/);
  assert.notEqual(a, clinicLeadConfirmationKey('qa@example.test', 'laser will not fire', new Date('2026-10-20T03:00:00Z')));
  assert.notEqual(a, clinicLeadConfirmationKey('qa@example.test', 'different problem', t));
  assert.equal(clinicLeadConfirmationKey(null, 'x', t), null);
  assert.equal(clinicLeadConfirmationKey('  ', 'x', t), null);
});

test('only a confirmation_key unique violation loses the claim', () => {
  assert.equal(isConfirmationKeyConflict({ code: '23505', message: 'duplicate key value violates unique constraint "clinic_service_leads_confirmation_key_key"' }), true);
  assert.equal(isConfirmationKeyConflict({ code: '23505', message: 'duplicate key value violates unique constraint "clinic_service_leads_pkey"' }), false);
  assert.equal(isConfirmationKeyConflict({ code: '42703', message: 'column confirmation_key does not exist' }), false);
  assert.equal(isConfirmationKeyConflict(null), false);
});

test('missing table is recognised, other errors are not', () => {
  assert.equal(isLeadsTableMissing({ code: 'PGRST205', message: 'Could not find the table public.clinic_service_leads in the schema cache' }), true);
  assert.equal(isLeadsTableMissing({ code: '42P01', message: 'relation "public.clinic_service_leads" does not exist' }), true);
  assert.equal(isLeadsTableMissing({ code: '23502', message: 'null value in column "clinic_name"' }), false);
});

test('send decision: one confirmation per claim', () => {
  assert.equal(shouldSendConfirmation({ email: 'a@b.test', stored: true, claimedKey: true, lostClaim: false }), true);
  assert.equal(shouldSendConfirmation({ email: 'a@b.test', stored: true, claimedKey: false, lostClaim: true }), false);
  assert.equal(shouldSendConfirmation({ email: null, stored: true, claimedKey: false, lostClaim: false }), false);
  // stored without a claim (old schema, key column stripped): no dedupe possible, do not double send
  assert.equal(shouldSendConfirmation({ email: 'a@b.test', stored: true, claimedKey: false, lostClaim: false }), false);
  assert.equal(shouldSendConfirmation({ email: 'a@b.test', stored: false, claimedKey: false, lostClaim: false }), true);
});

test('route claims the key, retries without it on conflict, and clears it on a failed send', () => {
  const route = readFileSync(join(here, '../app/api/clinic-service-leads/route.ts'), 'utf8');
  assert.match(route, /clinicLeadConfirmationKey/);
  assert.match(route, /isConfirmationKeyConflict/);
  assert.match(route, /confirmation_key: null/);
  assert.equal((route.match(/update\(\{ confirmation_key: null \}\)/g) || []).length, 2);
  assert.doesNotMatch(route, /async function confirmationAlreadySent/);
  const mig = readFileSync(join(here, '../supabase/migrations/20261018_000930_clinic_service_leads.sql'), 'utf8');
  assert.match(mig, /CREATE UNIQUE INDEX IF NOT EXISTS clinic_service_leads_confirmation_key_key/);
  assert.match(mig, /REVOKE ALL ON TABLE public\.clinic_service_leads FROM PUBLIC, anon, authenticated/);
  assert.match(mig, /SET LOCAL lock_timeout = '5s'/);
});
