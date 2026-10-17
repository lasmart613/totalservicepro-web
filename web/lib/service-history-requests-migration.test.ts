/**
 * Shape pins for 20261017_000922_service_history_access_requests.sql and its
 * rollback. Behavior is proven on local Postgres 17 by
 * web/supabase/tests/20261017_service_history_access_requests.sql.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mig = join(here, '../supabase/migrations');
const up = readFileSync(join(mig, '20261017_000922_service_history_access_requests.sql'), 'utf8');
const down = readFileSync(join(mig, '20261017_000922_service_history_access_requests_rollback.sql'), 'utf8');
const proof = readFileSync(join(here, '../supabase/tests/20261017_service_history_access_requests.sql'), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const created = [...code(up).matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/g)].map((m) => m[1]);

test('000922: lock_timeout first in both files', () => {
  assert.match(code(up).trim(), /^SET LOCAL lock_timeout = '5s';/);
  assert.match(code(down).trim(), /^SET LOCAL lock_timeout = '5s';/);
});

test('000922: every function is SECURITY DEFINER with an empty search_path', () => {
  assert.equal(created.length, 12);
  const bodies = code(up).match(/CREATE OR REPLACE FUNCTION[\s\S]*?\nAS \$\$/g) || [];
  assert.equal(bodies.length, 12);
  for (const b of bodies) {
    assert.match(b, /SECURITY DEFINER/, b.slice(0, 80));
    assert.match(b, /SET search_path = ''/, b.slice(0, 80));
  }
});

test('000922: anon is revoked on every function, and PUBLIC too', () => {
  for (const name of created) {
    const re = new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon`);
    assert.match(code(up), re, name);
  }
  assert.doesNotMatch(code(up), /GRANT [^;]* TO [^;]*anon/);
});

test('000922: internal helpers and the notice are not executable by authenticated', () => {
  for (const name of ['service_history_teaser_eligible', 'service_history_teaser_rows', 'service_history_can_request', 'take_service_history_slot', 'service_history_request_notice']) {
    assert.doesNotMatch(code(up), new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO [^;]*authenticated`), name);
  }
  assert.match(code(up), /GRANT EXECUTE ON FUNCTION public\.service_history_request_notice\(bigint\) TO service_role;/);
});

test('000922: no RLS widening, no policy, no client table grants', () => {
  assert.doesNotMatch(code(up), /CREATE POLICY|ALTER POLICY|DROP POLICY/);
  assert.doesNotMatch(code(up), /ON (TABLE )?public\.service_reports/);
  assert.doesNotMatch(code(up), /GRANT [^;]* ON TABLE [^;]* TO [^;]*authenticated/);
  assert.match(code(up), /ALTER TABLE public\.service_history_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(code(up), /ALTER TABLE public\.service_history_slots ENABLE ROW LEVEL SECURITY/);
});

test('000922: no schema-qualified EXTRACT / COALESCE (42601 / 42883 traps)', () => {
  assert.doesNotMatch(up, /pg_catalog\.(extract|coalesce)\s*\(/i);
});

test('000922: teaser returns only ref, title, service_date; title from service_type only', () => {
  assert.match(code(up), /get_locked_service_history_teaser\(p_owner_org bigint, p_equipment_id bigint\)\nRETURNS TABLE \(ref text, title text, service_date date\)/);
  const rows = code(up).slice(code(up).indexOf('FUNCTION public.service_history_teaser_rows('), code(up).indexOf('FUNCTION public.service_history_can_request('));
  for (const col of ['report_number', 'tech_', 'comments', 'equipment_name', 'model_type', 'sku', 'service_engineer']) {
    assert.ok(!rows.includes(col), col);
  }
  assert.match(rows, /public\.service_history_title\(r\.service_type\)/);
  assert.match(rows, /r\.customer_organization_id = p_owner/);
});

test('000922: dedupe index, 14-day expiry, 30-day cooldown, statuses', () => {
  assert.match(code(up), /CREATE UNIQUE INDEX IF NOT EXISTS service_history_requests_one_pending\s+ON public\.service_history_requests \(owner_org_id, requester_shop_org_id, equipment_id\)\s+WHERE status = 'pending'/);
  assert.match(code(up), /expires_at timestamptz NOT NULL DEFAULT now\(\) \+ interval '336 hours'/);
  assert.match(code(up), /interval '720 hours'/);
  assert.match(code(up), /status IN \('pending', 'approved', 'denied', 'expired'\)/);
});

test('000922: approval goes through grant_service_history with the row owner and shop', () => {
  assert.match(code(up), /gid := public\.grant_service_history\(\s*q\.owner_org_id,\s*q\.requester_shop_org_id,/);
  assert.match(code(up), /FOR UPDATE;/);
});

test('rollback drops every function and table 000922 creates', () => {
  for (const name of created) assert.match(code(down), new RegExp(`DROP FUNCTION IF EXISTS public\\.${name}\\(`), name);
  for (const t of ['public.service_history_requests', 'public.service_history_slots', 'private.service_history_ref_keys']) {
    assert.ok(code(down).includes(`DROP TABLE IF EXISTS ${t};`), t);
  }
  assert.doesNotMatch(code(down), /DROP TABLE IF EXISTS public\.service_history_grants|CASCADE/);
});

test('proof covers T01..T28 and applies 919 -> 920 -> 921 first', () => {
  for (let i = 1; i <= 28; i++) {
    if (i === 14) continue;
    assert.ok(proof.includes(`'T${String(i).padStart(2, '0')} `), `T${i}`);
  }
  assert.ok(proof.includes("'T14 "));
  const at = (f: string) => proof.indexOf(`\\ir ../migrations/${f}`);
  const a = at('20261016_000919_'), b = at('20261017_000920_'), c = at('20261017_000921_'), d = at('20261017_000922_service_history_access_requests.sql');
  assert.ok(a > 0 && a < b && b < c && c < d);
  assert.match(proof, /ROLLBACK;\s*$/);
});
