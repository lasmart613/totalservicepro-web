/**
 * Shape pins for 20261025_000946_service_invoice_number_backfill.sql and its
 * rollback. Behavior is proven on local Postgres 17 by
 * web/supabase/tests/20261025_service_invoice_number_backfill.sql.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, '../../supabase/migrations');
const up = readFileSync(join(migDir, '20261025_000946_service_invoice_number_backfill.sql'), 'utf8');
const down = readFileSync(join(migDir, '20261025_000946_service_invoice_number_backfill_rollback.sql'), 'utf8');
const proof = readFileSync(join(here, '../../supabase/tests/20261025_service_invoice_number_backfill.sql'), 'utf8');
const code = (s: string) => s.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

test('000946 opens a transaction and sets lock_timeout before work', () => {
  assert.match(code(up).trim(), /^BEGIN;/);
  assert.match(code(up), /SET LOCAL lock_timeout = '5s';/);
  assert.match(code(up), /COMMIT;\s*$/);
  assert.match(code(down).trim(), /^BEGIN;/);
  assert.match(code(down), /SET LOCAL lock_timeout = '5s';/);
  const lockAt = code(up).indexOf("SET LOCAL lock_timeout = '5s';");
  const workAt = code(up).indexOf('LOCK TABLE public.service_invoices');
  assert.ok(lockAt > 0 && lockAt < workAt);
});

test('000946 aborts when the invoice number column or unique index is missing', () => {
  assert.match(up, /000946 drift: public\.service_invoices\.invoice_number text column is missing/);
  assert.match(up, /000946 drift: unique index service_invoices_org_number_uidx is missing/);
  assert.match(up, /000946 drift: public\.service_invoices\.invoice_data json column is missing/);
  assert.match(up, /service_invoices_org_number_uidx/);
});

test('000946 backfills JSON keys then per-org sequence and audits the ids', () => {
  assert.match(up, /v_obj->>'invoice_number'/);
  assert.match(up, /v_obj->>'invNumber'/);
  assert.match(up, /public\.service_invoice_next_number\(rec\.organization_id, rec\.created_at\)/);
  assert.match(up, /ORDER BY si\.organization_id ASC NULLS FIRST, si\.created_at ASC NULLS LAST, si\.id ASC/);
  assert.match(up, /CREATE TABLE IF NOT EXISTS public\.service_invoice_number_backfill_audit/);
  assert.match(up, /ENABLE ROW LEVEL SECURITY/);
  assert.match(up, /REVOKE ALL ON TABLE public\.service_invoice_number_backfill_audit FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(code(up), /GRANT [^;]*service_invoice_number_backfill_audit[^;]*TO[^;]*anon/);
  assert.doesNotMatch(code(up), /GRANT [^;]*service_invoice_number_backfill_audit[^;]*TO[^;]*authenticated/);
  assert.match(up, /RAISE NOTICE '000946 backfill source=/);
  assert.doesNotMatch(up, /\b1005\b/);
  assert.doesNotMatch(down, /\b1005\b/);
  assert.doesNotMatch(proof, /VALUES\s*\(\s*1005\b/);
});

test('000946 trigger is definer, locks per org, and the column becomes NOT NULL', () => {
  const trigger = /CREATE OR REPLACE FUNCTION public\.service_invoices_assign_invoice_number\(\)[\s\S]*?\$fn\$;/.exec(code(up))?.[0] || '';
  assert.match(trigger, /SECURITY DEFINER/);
  assert.match(trigger, /SET search_path = ''/);
  const next = /CREATE OR REPLACE FUNCTION public\.service_invoice_next_number\(p_organization_id bigint, p_at timestamptz\)[\s\S]*?\$fn\$;/.exec(code(up))?.[0] || '';
  assert.match(next, /SECURITY DEFINER/);
  assert.match(next, /SET search_path = ''/);
  assert.match(next, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(next, /-INV-/);
  assert.match(up, /BEFORE INSERT ON public\.service_invoices/);
  assert.match(up, /ALTER COLUMN invoice_number SET NOT NULL/);
  assert.match(up, /REVOKE ALL ON FUNCTION public\.service_invoice_next_number\(bigint, timestamptz\) FROM PUBLIC, anon, authenticated/);
});

test('000946 records schema_migrations version 20261025_000946', () => {
  assert.match(up, /supabase_migrations\.schema_migrations/);
  assert.match(up, /'20261025_000946'/);
  assert.match(up, /'service_invoice_number_backfill'/);
  assert.match(up, /ON CONFLICT \(version\) DO NOTHING/);
  assert.doesNotMatch(up, /pg_catalog\.coalesce\s*\(/i);
});

test('rollback nulls exactly the audited rows and drops the guard', () => {
  assert.match(down, /SET invoice_number = rec\.old_invoice_number/);
  assert.match(down, /si\.id::text = a\.invoice_id/);
  assert.match(down, /invoice_number IS NOT DISTINCT FROM rec\.new_invoice_number/);
  assert.match(down, /DROP TRIGGER IF EXISTS service_invoices_assign_invoice_number/);
  assert.match(down, /ALTER COLUMN invoice_number DROP NOT NULL/);
  assert.match(down, /DROP TABLE IF EXISTS public\.service_invoice_number_backfill_audit/);
  assert.match(down, /DROP FUNCTION IF EXISTS public\.service_invoice_next_number\(bigint, timestamptz\)/);
  assert.match(down, /DELETE FROM supabase_migrations\.schema_migrations WHERE version = '20261025_000946'/);
  assert.doesNotMatch(down, /DROP COLUMN/);
});

test('proof covers json backfill, sequencing, collision, trigger, and rollback', () => {
  for (const name of [
    'json invoice_number key',
    'json invNumber key',
    'per-org sequence oldest',
    'collision with existing same-day number is skipped',
    'trigger assigns next per-org number when null',
    'trigger skips a number the unique index already holds',
    'rollback nulls exactly the rows it filled',
    'rollback leaves a number edited after the backfill',
    'drift missing index aborts before audit or NOT NULL',
  ]) {
    assert.ok(proof.includes(name), name);
  }
  assert.match(proof, /7001/);
  assert.match(proof, /org 1005 is a real customer/);
  assert.doesNotMatch(proof, /INSERT INTO public\.(organizations|service_invoices)[\s\S]{0,200}1005/);
  assert.match(proof, /server_version_num/);
});
