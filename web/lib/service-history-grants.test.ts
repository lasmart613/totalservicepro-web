import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHARED_HISTORY_COLUMNS,
  grantServiceHistory,
  loadSharedServiceHistory,
  revokeServiceHistory,
} from './service-history-grants.ts';

const here = dirname(fileURLToPath(import.meta.url));
const mig = join(here, '../supabase/migrations');
const up = readFileSync(join(mig, '20261017_000920_service_history_owner_consent.sql'), 'utf8');
const down = readFileSync(join(mig, '20261017_000920_service_history_owner_consent_rollback.sql'), 'utf8');
const stop = readFileSync(join(here, '../supabase/oneoff/20261017_h2_stopgap_drop_transfer_branch.sql'), 'utf8');
const stopDown = readFileSync(join(here, '../supabase/oneoff/20261017_h2_stopgap_drop_transfer_branch_rollback.sql'), 'utf8');
const proof = readFileSync(join(here, '../supabase/tests/20261017_service_history_owner_consent.sql'), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const historyBody = (s: string) => {
  const c = code(s);
  const start = c.indexOf('FUNCTION public.can_view_service_report_for_history(');
  const a = c.indexOf('AS $function$', start);
  return c.slice(a, c.indexOf('$function$;', a + 14)).replace(/\s+/g, ' ');
};
const serialOnly = /lower\(trim\(e\.serial_number\)\)\s*=\s*lower\(trim\(r\.serial_number\)\)/;

/** Real-shaped client: rpc needs `this` (see #308). */
class FakeClient {
  calls: Array<[string, Record<string, unknown> | undefined]> = [];
  constructor(private reply: (fn: string) => { data: unknown; error: unknown }) {}
  rpc(fn: string, args?: Record<string, unknown>) {
    if (!(this instanceof FakeClient)) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    this.calls.push([fn, args]);
    return Promise.resolve(this.reply(fn));
  }
}

test('000920: lock_timeout first, SECURITY DEFINER, empty search_path, no schema-qualified EXTRACT/COALESCE', () => {
  assert.match(code(up).trim(), /^SET LOCAL lock_timeout = '5s';/);
  assert.match(code(down).trim(), /^SET LOCAL lock_timeout = '5s';/);
  const fns = code(up).match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g) || [];
  assert.equal(fns.length, 5);
  for (const fn of fns) {
    assert.match(fn, /SECURITY DEFINER\n SET search_path = ''\n/, fn.slice(0, 80));
  }
  assert.doesNotMatch(code(up), /pg_catalog\.(extract|coalesce)/i);
  for (const sig of ['grant_service_history(bigint, bigint, bigint)', 'revoke_service_history(bigint)', 'get_shared_service_history(bigint, bigint)']) {
    assert.match(up, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon;`));
  }
});

test('no serial-only branch in 000920, its rollback, or the stopgap; old one only in the stopgap rollback', () => {
  assert.doesNotMatch(historyBody(up), serialOnly);
  assert.doesNotMatch(historyBody(down), serialOnly);
  assert.doesNotMatch(historyBody(stop), serialOnly);
  assert.match(historyBody(stopDown), serialOnly);
  // 000920 re-asserts the stopgapped body; its rollback restores the same body.
  assert.equal(historyBody(up), historyBody(down));
  assert.equal(historyBody(up), historyBody(stop));
  assert.doesNotMatch(historyBody(up), /service_history_grants/, 'grants never widen full-row RLS');
});

test('grants table: RLS on, read-only to clients, one active grant per scope', () => {
  assert.match(up, /ALTER TABLE public\.service_history_grants ENABLE ROW LEVEL SECURITY;/);
  assert.match(up, /REVOKE ALL ON TABLE public\.service_history_grants FROM PUBLIC, anon, authenticated;\nGRANT SELECT ON TABLE public\.service_history_grants TO authenticated;/);
  assert.doesNotMatch(code(up), /CREATE POLICY [^\n]+ON public\.service_history_grants\s+FOR (INSERT|UPDATE|DELETE|ALL)/);
  assert.match(up, /WHERE revoked_at IS NULL;/);
  assert.match(up, /lower\(btrim\(COALESCE\(m\.role, ''\)\)\) IN \('owner', 'company_admin', 'admin', 'manager'\)/);
});

test('shared history RPC returns exactly the safe columns', () => {
  const start = up.indexOf('RETURNS TABLE (');
  const cols = up.slice(start, up.indexOf(')\n LANGUAGE', start)).match(/^\s{3}(\w+) /gm)!.map((s) => s.trim());
  assert.deepEqual(cols, [...SHARED_HISTORY_COLUMNS]);
  for (const bad of ['comments', 'pdf_url', 'tech_signature', 'customer_phone', 'customer_email', 'tech_email', 'checklist_', 'power_measurements', 'ticket_id']) {
    assert.ok(!cols.some((c) => c.startsWith(bad)), bad);
  }
  assert.match(up, /AND g\.revoked_at IS NULL/);
});

test('local proof covers the required attack and consent cases', () => {
  for (const label of [
    'PRE attacker X reads other tenant',
    'BASELINE md5 is live stopgap',
    'serial collision denied (X)',
    'non-owner outsider cannot grant',
    'grantee shop admin cannot self-grant',
    'all-equipment grant allows',
    'revoke denies',
    'ROLLBACK md5 is the live stopgap',
  ]) assert.ok(proof.includes(label), label);
  assert.match(proof, /4abb0da8e35302a52783eb49416f6b5a/);
  assert.match(proof.trim(), /ROLLBACK;$/);
});

test('grantServiceHistory calls the RPC with numeric ids and a bound client', async () => {
  const c = new FakeClient(() => ({ data: 41, error: null }));
  assert.deepEqual(await grantServiceHistory(c, '2', 8, '1'), { id: 41, error: null });
  assert.deepEqual(c.calls, [['grant_service_history', { p_owner_org: 2, p_grantee_shop: 8, p_equipment_id: 1 }]]);
  assert.deepEqual(await grantServiceHistory(c, 2, 2), { id: null, error: 'an organization cannot grant itself' });
  assert.equal(c.calls.length, 1);
  const denied = new FakeClient(() => ({ data: null, error: { message: 'only an owner or admin of this facility can share its service history' } }));
  assert.match((await grantServiceHistory(denied, 2, 8)).error!, /only an owner or admin/);
});

test('revokeServiceHistory and loadSharedServiceHistory (paged, truncation visible)', async () => {
  const c = new FakeClient((fn) =>
    fn === 'revoke_service_history'
      ? { data: true, error: null }
      : { data: [{ id: 'a', report_number: 'SR-1', comments: 'SECRET', total_count: 3 }], error: null }
  );
  assert.deepEqual(await revokeServiceHistory(c, 7), { revoked: true, error: null });
  const page = await loadSharedServiceHistory(c, 2, null, { limit: 1 });
  assert.deepEqual(page, { rows: [{ id: 'a', report_number: 'SR-1' }], total: 3, truncated: true });
  assert.deepEqual(c.calls[1], ['get_shared_service_history', { p_owner_org: 2, p_equipment_id: null, p_limit: 1, p_offset: 0 }]);
  await loadSharedServiceHistory(c, 2, 5, { limit: 9999, offset: -3 });
  assert.deepEqual(c.calls[2], ['get_shared_service_history', { p_owner_org: 2, p_equipment_id: 5, p_limit: 500, p_offset: 0 }]);
  const last = await loadSharedServiceHistory(c, 2, null, { limit: 1, offset: 2 });
  assert.equal(last.truncated, false);
  assert.deepEqual(await loadSharedServiceHistory(c, ''), { rows: [], total: 0, truncated: false });
  const broken = new FakeClient(() => ({ data: null, error: { message: 'x' } }));
  assert.deepEqual(await loadSharedServiceHistory(broken, 2), { rows: [], total: 0, truncated: false });
});
