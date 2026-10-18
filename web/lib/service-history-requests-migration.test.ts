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

// grant_service_history (000920) is REDEFINED, not created (QA #314 M-1).
const created = [...code(up).matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/g)]
  .map((m) => m[1])
  .filter((n) => n !== 'grant_service_history');
const LIVE_GRANT_MD5 = 'c4b6de797b5e6ee4efcb918aa5137d69';
const grantBody = (s: string) => /CREATE OR REPLACE FUNCTION public\.grant_service_history[\s\S]*?\$function\$;/.exec(s)?.[0] || '';

test('000922: lock_timeout first in both files', () => {
  assert.match(code(up).trim(), /^SET LOCAL lock_timeout = '5s';/);
  assert.match(code(down).trim(), /^SET LOCAL lock_timeout = '5s';/);
});

test('000922: every function is SECURITY DEFINER with an empty search_path', () => {
  assert.equal(created.length, 13);
  const bodies = code(up).match(/CREATE OR REPLACE FUNCTION[\s\S]*?\nAS \$\$/g) || [];
  assert.equal(bodies.length, 13);
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

test('M-1: 000922 redefines grant_service_history with the dual-member guard; rollback restores the live body', () => {
  const upBody = grantBody(code(up));
  const downBody = grantBody(code(down));
  assert.ok(upBody && downBody);
  assert.match(upBody, /SECURITY DEFINER/);
  assert.match(upBody, /SET search_path TO ''/);
  assert.match(upBody, /sm\.organization_id = p_grantee_shop AND sm\.user_id = uid/);
  assert.doesNotMatch(downBody, /p_grantee_shop AND sm\.user_id/);
  // up = live body + exactly the guard block.
  const guard = /  -- M-1 \(000922\)[\s\S]*?-- I-2 \(000922\)[\s\S]*?END IF;\n/.exec(grantBody(up))?.[0] || '';
  assert.ok(guard);
  const lock = /  -- N-1 \(000922\)[\s\S]*?pg_advisory_xact_lock\([^;]*;\n/.exec(grantBody(up))?.[0] || '';
  assert.ok(lock.includes("'tsp.history_grantor:' || uid::text"));
  assert.equal(grantBody(up).replace(lock, '').replace(guard, ''), grantBody(down));
  assert.ok(up.includes(LIVE_GRANT_MD5) && down.includes(LIVE_GRANT_MD5));
  assert.match(code(up), /REVOKE ALL ON FUNCTION public\.grant_service_history\(bigint, bigint, bigint\) FROM PUBLIC, anon;/);
  assert.match(code(down), /REVOKE ALL ON FUNCTION public\.grant_service_history\(bigint, bigint, bigint\) FROM PUBLIC, anon;/);
  assert.ok(proof.includes(`'${LIVE_GRANT_MD5}'`));
});

test('M-1 / L-1 / L-2 / L-3 guards are in the approve and request paths', () => {
  const u = code(up);
  assert.match(u, /sm\.organization_id = q\.requester_shop_org_id AND sm\.user_id = uid/);
  assert.match(u, /organization_customer_link_blocks b\s+WHERE b\.owner_org_id = q\.owner_org_id AND b\.shop_org_id = q\.requester_shop_org_id\s+\) THEN\s+UPDATE public\.service_history_requests r SET status = 'expired', close_reason = 'blocked'/);
  assert.match(u, /close_reason = 'link_removed'/);
  // cooldown query has no equipment filter
  const cd = /SELECT max\(q\.responded_at\) INTO last_denied[\s\S]*?;/.exec(u)?.[0] || '';
  assert.ok(cd && !cd.includes('equipment_id'));
  assert.match(u, /NOT IN \('cancelled', 'canceled'\)/);
  assert.match(u, /interval '90 days'/);
  for (const t of ['M-1 dual member approves', 'M-1 dual member calls grant_service_history', 'L-1 owner approves the blocked', 'L-1 approving an unlinked shop', 'L-2 cooldown is per (clinic, shop)', 'L-3 tech whose only C ticket']) {
    assert.ok(proof.includes(t), t);
  }
});

test('L-B: the very first statement after lock_timeout refuses to run without 000923', () => {
  const body = code(up).replace(/^SET LOCAL lock_timeout = '5s';\s*/, '');
  assert.match(body, /^DO \$\$\s*BEGIN\s*IF to_regclass\('public\.clinic_owner_invites'\) IS NULL/);
  assert.match(body.slice(0, 600), /RAISE EXCEPTION '000922 requires 000923/);
  // proof applies the 000923 fixture (origin copy) before 000922 and has the negative run hook
  const fx = proof.indexOf('\\ir fixtures/000923_clinic_claim_invite_binding_at_168d4f6a.sql');
  assert.ok(fx > 0 && fx < proof.indexOf("INSERT INTO fp VALUES ('pre922'"));
  assert.match(proof, /\\if :\{\?skip923\}/);
  const fixture = readFileSync(join(here, '../supabase/tests/fixtures/000923_clinic_claim_invite_binding_at_168d4f6a.sql'), 'utf8');
  assert.match(fixture, /CREATE TABLE IF NOT EXISTS public\.clinic_owner_invites/);
});

test('L-A: membership trigger revokes the joiner\'s grants to that shop; rollback drops it', () => {
  const u = code(up);
  assert.match(u, /CREATE TRIGGER trg_revoke_conflicted_history_grants\s+AFTER INSERT OR UPDATE OF user_id, organization_id ON public\.organization_memberships/);
  assert.match(u, /g\.grantee_shop_org_id = NEW\.organization_id\s+AND g\.granted_by = NEW\.user_id/);
  assert.match(u, /REVOKE ALL ON FUNCTION public\.revoke_conflicted_history_grants\(\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(code(down), /DROP TRIGGER IF EXISTS trg_revoke_conflicted_history_grants ON public\.organization_memberships;/);
  for (const t of ['L-A re-join (UPDATE into L)', 'L-A owner joins L (INSERT', 'I-1 dual member cannot DENY', 'I-2 direct grant_service_history to a blocked shop', 'I-3 tech whose C ticket is Completed but future-dated']) {
    assert.ok(proof.includes(t), t);
  }
});

test('N-1: grant and revoke trigger share the per-user advisory lock key', () => {
  const u = code(up);
  assert.match(u, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('tsp\.history_grantor:' \|\| uid::text, 0\)\)/);
  assert.match(u, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('tsp\.history_grantor:' \|\| NEW\.user_id::text, 0\)\);\s+UPDATE public\.service_history_grants g/);
  const race = readFileSync(join(here, '../supabase/tests/race/000922_race.sh'), 'utf8');
  for (const o of ['grant_first', 'join_first']) assert.ok(race.includes(o), o);
  assert.match(race, /active grants by the joiner" "\$\(active\)" 0/);
});
