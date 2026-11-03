/**
 * Shape pins for 20261025_000947_service_invoice_number_uidx.sql and its
 * rollback. Behavior is proven on local Postgres 17 by
 * web/supabase/tests/20261025_service_invoice_number_uidx.sql.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, '../../supabase/migrations');
const up = readFileSync(join(migDir, '20261025_000947_service_invoice_number_uidx.sql'), 'utf8');
const down = readFileSync(join(migDir, '20261025_000947_service_invoice_number_uidx_rollback.sql'), 'utf8');
const source = readFileSync(join(migDir, '20260813_000000_unique_doc_numbers.sql'), 'utf8');
const proof = readFileSync(join(here, '../../supabase/tests/20261025_service_invoice_number_uidx.sql'), 'utf8');
const code = (s: string) => s.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

const stmt = source.split(/\r?\n/).slice(7, 10).join('\n');

test('000947 copies the 20260813 invoice unique index and no other index', () => {
  assert.equal(
    stmt,
    `CREATE UNIQUE INDEX IF NOT EXISTS service_invoices_org_number_uidx
  ON public.service_invoices (organization_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND btrim(invoice_number) <> '';`,
  );
  assert.equal(code(up).split(stmt).length - 1, 1);
  assert.equal(code(up).match(/CREATE UNIQUE INDEX/g)?.length, 1);
  assert.doesNotMatch(code(up), /CREATE INDEX /);
  assert.doesNotMatch(code(up), /service_estimates_org_number_uidx/);
  assert.doesNotMatch(code(up), /purchase_orders_org_number_uidx/);
  assert.doesNotMatch(code(down), /service_estimates_org_number_uidx/);
  assert.doesNotMatch(code(down), /purchase_orders_org_number_uidx/);
});

test('000947 opens a transaction, locks, and aborts on duplicate nonblank numbers', () => {
  assert.match(code(up).trim(), /^BEGIN;/);
  assert.match(code(up), /SET LOCAL lock_timeout = '5s';/);
  assert.match(code(up), /COMMIT;\s*$/);
  const lockAt = code(up).indexOf("SET LOCAL lock_timeout = '5s';");
  const tableAt = code(up).indexOf('LOCK TABLE public.service_invoices');
  const guardAt = code(up).indexOf('000947 abort:');
  const createAt = code(up).indexOf(stmt);
  assert.ok(lockAt > 0 && lockAt < tableAt && tableAt < guardAt && guardAt < createAt);
  assert.match(up, /duplicate \(organization_id, nonblank invoice_number\) groups exist/);
  assert.match(up, /pg_catalog\.btrim\(si\.invoice_number\) <> ''/);
  assert.match(code(down).trim(), /^BEGIN;/);
  assert.match(code(down), /SET LOCAL lock_timeout = '5s';/);
  assert.match(code(down), /COMMIT;\s*$/);
});

test('000947 records schema_migrations and the rollback drops only that index', () => {
  assert.match(up, /supabase_migrations\.schema_migrations/);
  assert.match(up, /'20261025_000947'/);
  assert.match(up, /'service_invoice_number_uidx'/);
  assert.match(up, /ON CONFLICT \(version\) DO NOTHING/);
  assert.doesNotMatch(up, /'20260813_000000'/);
  assert.match(down, /DROP INDEX public\.service_invoices_org_number_uidx/);
  assert.match(down, /refusing to drop it/);
  assert.match(down, /DELETE FROM supabase_migrations\.schema_migrations WHERE version = '20261025_000947'/);
  assert.doesNotMatch(code(down), /DROP TABLE/);
  assert.doesNotMatch(code(down), /ALTER COLUMN/);
  assert.doesNotMatch(code(down), /SET invoice_number/);
});

test('proof applies 000947 before 000946 on a database missing the index', () => {
  for (const name of [
    'prod-equivalent invoice indexes omit the unique number index',
    'estimates org number index from 20260813 is missing',
    'purchase order org number index from 20260825 is present',
    'duplicate (org, nonblank number) aborts before the index exists',
    '000946 still aborts while the unique index is missing',
    '000947 creates the 20260813 invoice unique index',
    'rollback drops the index and the schema_migrations row',
    '000946 applies after 000947',
    '000947 and 000946 did not create the estimates index or drop the PO index',
  ]) {
    assert.ok(proof.includes(name), name);
  }
  assert.match(proof, /server_version_num/);
  assert.match(proof, /7001/);
  assert.match(proof, /org 1005 is a real customer/);
  assert.doesNotMatch(proof, /INSERT INTO public\.(organizations|service_invoices|service_estimates|purchase_orders)[\s\S]{0,200}1005/);
  assert.doesNotMatch(proof, /VALUES\s*\(\s*1005\b/);
});
