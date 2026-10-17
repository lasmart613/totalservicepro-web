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
  const fns = code(up).match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g) || [];
  assert.equal(fns.length, 7);
  for (const f of fns) assert.match(f, /SECURITY DEFINER\n SET search_path = ''\n/, f.slice(0, 80));
  assert.doesNotMatch(code(up), /pg_catalog\.(extract|coalesce)/i);
  for (const sig of ['list_linked_service_shops(bigint)', 'remove_linked_service_shop(bigint, bigint, boolean)', 'allow_linked_service_shop(bigint, bigint)', 'list_my_service_history_grants()', 'get_shared_service_history(bigint, bigint, integer, integer)']) {
    assert.ok(up.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`), sig);
  }
  assert.match(up, /REVOKE EXECUTE ON FUNCTION public\.service_history_owner_admin\(bigint\) FROM authenticated;/);
});

test('000921: the linked-shop branch is gone; nothing else in can_view changes', () => {
  const next = fn(up, 'can_view_service_report_for_history');
  const prev = fn(m920, 'can_view_service_report_for_history');
  assert.doesNotMatch(next, /organization_customers/);
  assert.match(prev, /organization_customers/);
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const prevWithout = norm(prev).replace(/ OR \( r\.customer_organization_id IS NOT NULL AND EXISTS \( SELECT 1 FROM public\.organization_customers oc[^;]*\);/, ';');
  assert.equal(norm(next), prevWithout);
});

test('000921: link rule refuses owner-blocked shops; owner RPCs need owner admin', () => {
  assert.match(fn(up, 'customer_org_link_allowed'), /NOT EXISTS \(\s+SELECT 1 FROM public\.organization_customer_link_blocks b\s+WHERE b\.owner_org_id = p_customer\s+AND b\.shop_org_id = p_service/);
  for (const name of ['list_linked_service_shops', 'remove_linked_service_shop', 'allow_linked_service_shop']) {
    assert.match(fn(up, name), /NOT public\.service_history_owner_admin\(p_owner_org\)/, name);
  }
  assert.match(up, /REVOKE ALL ON TABLE public\.organization_customer_link_blocks FROM PUBLIC, anon, authenticated;/);
  assert.match(up, /USING \(public\.is_active_org_member\(owner_org_id\)\);/);
  assert.doesNotMatch(fn(up, 'list_my_service_history_grants'), /granted_by|revoked_by/);
});

test('000921: shared history pages with total_count and the same safe columns', () => {
  const f = fn(up, 'get_shared_service_history');
  const cols = f.slice(f.indexOf('RETURNS TABLE (')).match(/^\s{3}(\w+) /gm)!.map((s) => s.trim());
  assert.deepEqual(cols, [...SHARED_HISTORY_COLUMNS, 'total_count']);
  assert.match(f, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 200\), 1\), 500\)/);
  assert.match(f, /count\(\*\) OVER \(\) AS total_count/);
  assert.match(up, /DROP FUNCTION IF EXISTS public\.get_shared_service_history\(bigint, bigint\);/);
});

test('rollback restores the exact prior bodies, ACLs and policy', () => {
  assert.equal(fn(down, 'can_view_service_report_for_history'), fn(m920, 'can_view_service_report_for_history'));
  assert.equal(fn(down, 'get_shared_service_history'), fn(m920, 'get_shared_service_history'));
  assert.match(fn(down, 'customer_org_link_allowed'), /SET search_path TO 'public', 'pg_temp'/);
  assert.doesNotMatch(fn(down, 'customer_org_link_allowed'), /link_blocks/);
  assert.match(down, /GRANT EXECUTE ON FUNCTION public\.service_history_owner_admin\(bigint\) TO authenticated;/);
  assert.match(down, /public\.is_active_org_member\(owner_org_id\)\s+OR public\.is_active_org_member\(grantee_shop_org_id\)/);
  for (const d of ['allow_linked_service_shop(bigint, bigint)', 'remove_linked_service_shop(bigint, bigint, boolean)', 'list_linked_service_shops(bigint)', 'list_my_service_history_grants()', 'get_shared_service_history(bigint, bigint, integer, integer)']) {
    assert.ok(down.includes(`DROP FUNCTION IF EXISTS public.${d};`), d);
  }
  assert.match(down, /DROP TABLE IF EXISTS public\.organization_customer_link_blocks;/);
});

test('proofs use \\ir (work from any directory) and cover the attack', () => {
  for (const p of proofs) {
    assert.doesNotMatch(p, /^\\i /m);
    assert.match(p, /^\\ir \.\.\/migrations\//m);
    assert.match(p.trim(), /ROLLBACK;$/);
  }
  for (const label of [
    'BEFORE linked shop admin reads other shop reports',
    'linked shop admin sees only its own report',
    'owner removes the link',
    'removed link: creator in shop L loses access',
    'shop L cannot re-link itself after removal',
    'ROLLBACK fingerprint equals pre-000921',
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
  await removeLinkedServiceShop(c, 2, 3, { block: false });
  assert.deepEqual(await allowLinkedServiceShop(c, 2, 3), { allowed: true, error: null });
  assert.equal((await listMyServiceHistoryGrants(c)).length, 1);
  assert.deepEqual(c.calls.slice(0, 4), [
    ['list_linked_service_shops', { p_owner_org: 2 }],
    ['remove_linked_service_shop', { p_owner_org: 2, p_shop: 3, p_block: true }],
    ['remove_linked_service_shop', { p_owner_org: 2, p_shop: 3, p_block: false }],
    ['allow_linked_service_shop', { p_owner_org: 2, p_shop: 3 }],
  ]);
  assert.match((await removeLinkedServiceShop(c, '', 3)).error!, /required/);
  const denied = new FakeClient(() => ({ data: null, error: { message: 'only an owner or admin of this facility can remove a service company' } }));
  assert.match((await removeLinkedServiceShop(denied, 2, 3)).error!, /only an owner or admin/);
});
