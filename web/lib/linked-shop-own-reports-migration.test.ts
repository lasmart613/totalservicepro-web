/**
 * Shape pins for 20261017_000921_linked_shop_own_reports.sql and its rollback,
 * plus the owner link RPC wrappers. Behavior is proven on local Postgres by
 * web/supabase/tests/20261017_linked_shop_own_reports.sql.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHARED_HISTORY_COLUMNS,
  allowLinkedServiceShop,
  listLinkedServiceShops,
  listMyServiceHistoryGrants,
  removeLinkedServiceShop,
} from './service-history-grants.ts';

const here = dirname(fileURLToPath(import.meta.url));
const mig = join(here, '../supabase/migrations');
const up = readFileSync(join(mig, '20261017_000921_linked_shop_own_reports.sql'), 'utf8');
const down = readFileSync(join(mig, '20261017_000921_linked_shop_own_reports_rollback.sql'), 'utf8');
const m920 = readFileSync(join(mig, '20261017_000920_service_history_owner_consent.sql'), 'utf8');
const proofs = ['20261017_linked_shop_own_reports.sql', '20261017_service_history_owner_consent.sql'].map((f) =>
  readFileSync(join(here, '../supabase/tests', f), 'utf8')
);
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const fn = (s: string, name: string) => {
  const c = code(s);
  const start = c.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, name);
  return c.slice(start, c.indexOf('$function$;', c.indexOf('AS $function$', start) + 14) + 11);
};

class FakeClient {
  calls: Array<[string, Record<string, unknown> | undefined]> = [];
  constructor(private reply: (fn: string) => { data: unknown; error: unknown }) {}
  rpc(name: string, args?: Record<string, unknown>) {
    if (!(this instanceof FakeClient)) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    this.calls.push([name, args]);
    return Promise.resolve(this.reply(name));
  }
}

test('000921: lock_timeout first; every function SECURITY DEFINER with empty search_path; anon revoked', () => {
  assert.match(code(up).trim(), /^SET LOCAL lock_timeout = '5s';/);
  assert.match(code(down).trim(), /^SET LOCAL lock_timeout = '5s';/);
  const fns = code(up).match(/CREATE (OR REPLACE )?FUNCTION[\s\S]*?\$function\$/g) || [];
  assert.equal(fns.length, 8);
  for (const f of fns) assert.match(f, /SECURITY DEFINER\n SET search_path (=|TO) ''\n/, f.slice(0, 80));
  assert.doesNotMatch(code(up), /pg_catalog\.(extract|coalesce)/i);
  for (const sig of ['list_linked_service_shops(bigint)', 'remove_linked_service_shop(bigint, bigint, boolean, boolean)', 'allow_linked_service_shop(bigint, bigint)', 'list_my_service_history_grants()', 'get_shared_service_history(bigint, bigint, integer, integer)']) {
    assert.ok(up.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`), sig);
  }
  assert.match(up, /REVOKE EXECUTE ON FUNCTION public\.service_history_owner_admin\(bigint\) FROM authenticated;/);
  // ACLs of the three redefined functions are left as they were (CREATE OR REPLACE keeps them).
  for (const name of ['can_view_service_report_for_history', 'org_creator_access', 'customer_org_link_allowed']) {
    assert.doesNotMatch(code(up), new RegExp(`(GRANT|REVOKE)[^;]*FUNCTION public\\.${name}\\(`), name);
  }
});

test('000921: pre-000921 bodies are backed up for an exact rollback', () => {
  assert.match(up, /CREATE TABLE IF NOT EXISTS migration_backup\.m000921_functions/);
  assert.match(up, /REVOKE ALL ON SCHEMA migration_backup FROM PUBLIC, anon, authenticated;/);
  assert.match(up, /ON CONFLICT \(signature\) DO NOTHING/);
  for (const sig of ['public.can_view_service_report_for_history(public.service_reports)', 'public.org_creator_access(bigint,uuid,timestamp with time zone)', 'public.customer_org_link_allowed(bigint,bigint)']) {
    assert.ok(up.includes(`'${sig}'`), sig);
  }
  // The backup is taken before any of them is replaced.
  assert.ok(up.indexOf('pg_get_functiondef') < up.indexOf('CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history'));
});

test('000921 M-1: no linked-shop report branch; creator access never opens a linked clinic', () => {
  const next = fn(up, 'can_view_service_report_for_history');
  const prev = fn(m920, 'can_view_service_report_for_history');
  assert.match(prev, /oc\.service_organization_id/);
  assert.doesNotMatch(next, /oc\.service_organization_id/);
  assert.equal((next.match(/OR NOT EXISTS \(\s+SELECT 1 FROM public\.organization_customers oc/g) || []).length, 2);
  assert.match(next, /public\.is_active_org_member\(r\.customer_organization_id\)/);
  assert.match(next, /public\.is_active_org_member\(e\.customer_organization_id\)/);
  // org_creator_access: the linked-shop clause only while the clinic has no members.
  const oca = up.slice(up.indexOf('CREATE OR REPLACE FUNCTION public.org_creator_access'), up.indexOf('END $do$;'));
  assert.match(oca, /OR \(\s+NOT EXISTS \(\s+SELECT 1 FROM public\.organization_memberships cm\s+WHERE cm\.organization_id = p_org\s+\)\s+AND EXISTS \(\s+SELECT 1 FROM public\.organization_customers oc/);
  assert.match(up, /a\.attname = 'creator_shop_org_id'/);
  assert.match(up, /o\.creator_shop_org_id IS NOT NULL/);
});

test('000921 M-2: link rule (000919 base) refuses claimed clinics and blocked creators', () => {
  const f = fn(up, 'customer_org_link_allowed');
  assert.match(f, /JOIN public\.organization_memberships sm ON sm\.user_id = cm\.user_id/, '000919 member overlap kept');
  assert.match(f, /WHERE b\.owner_org_id = p_customer\s+AND b\.shop_org_id = p_service/);
  assert.match(f, /AND NOT EXISTS \(\s+SELECT 1 FROM public\.organization_memberships cm\s+WHERE cm\.organization_id = p_customer\s+\)/);
  assert.match(f, /AND b\.creator_user_id = o\.created_by/);
  assert.match(f, /SET search_path TO ''/);
  for (const name of ['list_linked_service_shops', 'remove_linked_service_shop', 'allow_linked_service_shop']) {
    assert.match(fn(up, name), /NOT public\.service_history_owner_admin\(p_owner_org\)/, name);
  }
  assert.match(up, /creator_user_id uuid,/);
  assert.match(up, /REVOKE ALL ON TABLE public\.organization_customer_link_blocks FROM PUBLIC, anon, authenticated;/);
});

test('000921 L-1 and info items: revoke on remove, owner/admin-only grant rows, org name', () => {
  const rm = fn(up, 'remove_linked_service_shop');
  assert.match(rm, /p_revoke_grants boolean DEFAULT false/);
  assert.match(rm, /IF COALESCE\(p_revoke_grants, false\) THEN\s+UPDATE public\.service_history_grants\s+SET revoked_at = now\(\), revoked_by = uid/);
  assert.match(up, /DROP FUNCTION IF EXISTS public\.remove_linked_service_shop\(bigint, bigint, boolean\);/);
  const pol = up.slice(up.indexOf('CREATE POLICY service_history_grants_select'), up.indexOf('CREATE OR REPLACE FUNCTION public.list_my_service_history_grants'));
  assert.match(pol, /IN \('owner', 'company_admin', 'admin', 'manager'\)/);
  assert.doesNotMatch(pol, /grantee_shop_org_id|is_active_org_member/);
  assert.doesNotMatch(fn(up, 'list_my_service_history_grants'), /granted_by|revoked_by/);
});

test('000921: shared history pages with total_count, real org name and labeled header text', () => {
  const f = fn(up, 'get_shared_service_history');
  const cols = f.slice(f.indexOf('RETURNS TABLE (')).match(/^\s{3}(\w+) /gm)!.map((s) => s.trim());
  assert.deepEqual(cols, [...SHARED_HISTORY_COLUMNS, 'total_count']);
  assert.match(f, /s\.name, h\.tech_company_name, h\.organization_id/);
  assert.match(f, /LEFT JOIN public\.organizations s ON s\.id = h\.organization_id/);
  assert.match(f, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 200\), 1\), 500\)/);
  assert.match(f, /count\(\*\) OVER \(\) AS total_count/);
  assert.match(up, /DROP FUNCTION IF EXISTS public\.get_shared_service_history\(bigint, bigint\);/);
});

test('rollback restores the exact prior bodies (from the backup), ACLs and policy', () => {
  assert.match(down, /EXECUTE rec\.definition;/);
  assert.match(down, /refusing to guess the prior bodies/);
  assert.match(down, /IF n <> 3 THEN/);
  assert.doesNotMatch(code(down), /FUNCTION public\.(can_view_service_report_for_history|org_creator_access|customer_org_link_allowed)\(/);
  assert.equal(fn(down, 'get_shared_service_history'), fn(m920, 'get_shared_service_history'));
  assert.match(down, /GRANT EXECUTE ON FUNCTION public\.service_history_owner_admin\(bigint\) TO authenticated;/);
  assert.match(down, /public\.is_active_org_member\(owner_org_id\)\s+OR public\.is_active_org_member\(grantee_shop_org_id\)/);
  for (const d of ['allow_linked_service_shop(bigint, bigint)', 'remove_linked_service_shop(bigint, bigint, boolean, boolean)', 'list_linked_service_shops(bigint)', 'list_my_service_history_grants()', 'get_shared_service_history(bigint, bigint, integer, integer)']) {
    assert.ok(down.includes(`DROP FUNCTION IF EXISTS public.${d};`), d);
  }
  assert.match(down, /DROP TABLE IF EXISTS public\.organization_customer_link_blocks;/);
  assert.match(down, /DROP SCHEMA IF EXISTS migration_backup;/);
  // Bodies are restored before the block table goes away.
  assert.ok(down.indexOf('EXECUTE rec.definition') < down.indexOf('DROP TABLE IF EXISTS public.organization_customer_link_blocks'));
});

test('proofs use \\ir (work from any directory), run with and without 000919, and cover the attacks', () => {
  for (const p of proofs) {
    assert.doesNotMatch(p, /^\\i \.\.?\//m);
    assert.match(p, /^\\ir \.\.\/migrations\//m);
    assert.match(p.trim(), /ROLLBACK;$/);
  }
  assert.match(proofs[0], /^\\if :\{\?m919\}/m);
  for (const label of [
    'BEFORE linked shop admin reads other shop reports',
    'linked shop admin sees only its own reports',
    'M-1 claimed C: creator in linked shop reads no other shop',
    'M-1 claimed C: creator has no creator access at all',
    'M-1 U gets its first member: creator access ends',
    'M-2 blocked creator',
    'M-2 block binds the creator: new shop N cannot link unclaimed V',
    'M-2 claimed C: creator path refused even with no block',
    'L-1 owner removes the link and revokes its grants in one step',
    'org name: real organizations.name plus labeled header text',
    'plain clinic staff cannot read grant rows',
    'page past the end',
    'ROLLBACK fingerprint equals pre-000921',
    'ROLLBACK md5 of the 3 redefined functions equal pre-000921',
  ]) assert.ok(proofs[0].includes(label), label);
});

test('owner link wrappers call the RPCs with numeric ids on a bound client', async () => {
  const c = new FakeClient((name) =>
    name === 'list_linked_service_shops'
      ? { data: [{ shop_org_id: 3, shop_name: 'Shop L', linked_at: 'x', first_service_date: null, removed_at: null }], error: null }
      : name === 'list_my_service_history_grants'
        ? { data: [{ id: 1, owner_org_id: 2, owner_name: 'C', equipment_id: null, granted_at: 'x', revoked_at: null }], error: null }
        : { data: true, error: null }
  );
  assert.equal((await listLinkedServiceShops(c, '2')).shops.length, 1);
  assert.deepEqual(await removeLinkedServiceShop(c, 2, '3'), { removed: true, error: null });
  await removeLinkedServiceShop(c, 2, 3, { block: false, revokeGrants: true });
  assert.deepEqual(await allowLinkedServiceShop(c, 2, 3), { allowed: true, error: null });
  assert.equal((await listMyServiceHistoryGrants(c)).length, 1);
  assert.deepEqual(c.calls.slice(0, 4), [
    ['list_linked_service_shops', { p_owner_org: 2 }],
    ['remove_linked_service_shop', { p_owner_org: 2, p_shop: 3, p_block: true, p_revoke_grants: false }],
    ['remove_linked_service_shop', { p_owner_org: 2, p_shop: 3, p_block: false, p_revoke_grants: true }],
    ['allow_linked_service_shop', { p_owner_org: 2, p_shop: 3 }],
  ]);
  assert.match((await removeLinkedServiceShop(c, '', 3)).error!, /required/);
  const denied = new FakeClient(() => ({ data: null, error: { message: 'only an owner or admin of this facility can remove a service company' } }));
  assert.match((await removeLinkedServiceShop(denied, 2, 3)).error!, /only an owner or admin/);
});
