/**
 * QA #309 H3 (000919 rev 3): POST /api/org/founder, new-org path, driven
 * through the real route handler (runOrgFounder) with an in-memory service
 * role. The route inserts the org and the owner home membership with the
 * service role, so it must enforce the shop-member and claim rules itself.
 * The fake models the 000919 stamp trigger (customer-side insert by a shop
 * member gets creator_shop_org_id) so the post-insert check is exercised too.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { runOrgFounder } from '../app/api/org/founder/route.ts';
import { FOUNDER_SIGNUP_ORG_TYPES, founderSignupOrgType } from './founder-new-org.ts';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon';

type Row = Record<string, unknown>;
const CUSTOMER_SIDE = ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller'];
const SHOPS = ['service_company', 'service'];

const SHOP = 1;
const TECH = '00000000-0000-0000-0000-0000000000f1';
const CLINIC_OWNER = '00000000-0000-0000-0000-0000000000e1';

function fakeDb(opts: { failMembershipRead?: boolean; stampEvenIfNotMember?: number } = {}) {
  const t: Record<string, Row[]> = {
    organizations: [{ id: SHOP, name: 'Shop One', type: 'service_company', created_by: null, created_at: new Date().toISOString() }],
    organization_memberships: [{ user_id: TECH, organization_id: SHOP, role: 'fse', is_home: true }],
    organization_customers: [],
    service_reports: [],
    service_tickets: [],
    user_profiles: [{ id: TECH }, { id: CLINIC_OWNER }],
  };
  let nextId = 500;
  const log: string[] = [];
  const isShopMember = (uid: unknown) =>
    t.organization_memberships.some(
      (m) => m.user_id === uid && SHOPS.includes(String(t.organizations.find((o) => o.id === m.organization_id)?.type))
    );

  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    let payload: Row | null = null;
    let lim = Infinity;
    const run = () => {
      if (opts.failMembershipRead && table === 'organization_memberships' && op === 'select') {
        return { data: null, error: { message: 'timeout' } };
      }
      const rows = t[table] || (t[table] = []);
      if (op === 'insert') {
        const row: Row = { ...payload, id: nextId++, created_at: new Date().toISOString() };
        if (table === 'organizations') {
          // 000919 trg_stamp_org_creator_shop, service role included.
          const customer = CUSTOMER_SIDE.includes(String(row.type));
          const shop = t.organization_memberships.find(
            (m) => m.user_id === row.created_by && SHOPS.includes(String(t.organizations.find((o) => o.id === m.organization_id)?.type))
          );
          row.creator_shop_org_id = customer ? (shop?.organization_id ?? opts.stampEvenIfNotMember ?? null) : null;
        }
        rows.push(row);
        log.push(`insert ${table} ${row.id}`);
        return { data: [row], error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update' || op === 'upsert') {
        hit.forEach((r) => Object.assign(r, payload));
        if (op === 'upsert' && !hit.length) rows.push({ ...payload });
        return { data: hit.length ? hit : [payload], error: null };
      }
      if (op === 'delete') {
        t[table] = rows.filter((r) => !hit.includes(r));
        log.push(`delete ${table} ${hit.map((r) => r.id).join(',')}`);
        return { data: hit, error: null };
      }
      return { data: hit.slice(0, lim), error: null };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PostgREST builder fake
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) === String(v)), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      limit: (n: number) => ((lim = n), b),
      insert: (row: Row) => ((op = 'insert'), (payload = row), b),
      update: (row: Row) => ((op = 'update'), (payload = row), b),
      upsert: (row: Row) => ((op = 'upsert'), (payload = row), b),
      delete: () => ((op = 'delete'), b),
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      single: async () => b.maybeSingle(),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }
  const admin = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Row) => {
      if (fn !== 'set_home_membership') return { data: null, error: { message: `unexpected rpc ${fn}` } };
      t.organization_memberships.push({
        user_id: args.p_user_id, organization_id: args.p_organization_id, role: args.p_role, is_home: true,
      });
      log.push(`membership ${args.p_user_id} ${args.p_organization_id} ${args.p_role}`);
      return { data: null, error: null };
    },
  };
  return { t, log, admin, isShopMember };
}

async function post(db: ReturnType<typeof fakeDb>, caller: string, body: Row) {
  const res = await runOrgFounder(
    new NextRequest('http://127.0.0.1/api/org/founder', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {
      hasServiceRole: () => true,
      getAdmin: () => db.admin as never,
      createUserClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: caller, email: 'x@test', user_metadata: {} } }, error: null }) },
      }),
    }
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const pending = (orgType: string, name = 'Real Clinic') => ({ pending: { kind: 'owner', name, orgType } });

test('H3 API: a current shop tech cannot found a customer-side org (any customer type); nothing is written', async () => {
  for (const orgType of [...CUSTOMER_SIDE, ' Customer ', 'LASER_CLINIC']) {
    const db = fakeDb();
    const r = await post(db, TECH, pending(orgType));
    assert.equal(r.status, 403, orgType);
    assert.match(String(r.body.error), /belong to a service company/);
    assert.equal(db.t.organizations.length, 1, `no org inserted for ${orgType}`);
    assert.deepEqual(db.log, [], `no writes for ${orgType}`);
    assert.ok(!db.t.organization_memberships.some((m) => m.user_id === TECH && m.role === 'owner'));
  }
});

test('H3 API: unknown shop membership (read error) fails closed for a customer-side org', async () => {
  const db = fakeDb({ failMembershipRead: true });
  const r = await post(db, CLINIC_OWNER, pending('laser_clinic'));
  assert.equal(r.status, 403);
  assert.deepEqual(db.log, []);
});

test('H3 API: org type is allow-listed (no arbitrary or legacy types from the client)', async () => {
  assert.deepEqual([...FOUNDER_SIGNUP_ORG_TYPES].sort(), ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller', 'parts_supplier', 'service_company']);
  for (const orgType of ['admin', 'service', 'vendor', 'supplier', 'god', '', 'customer;drop']) {
    const db = fakeDb();
    const r = await post(db, CLINIC_OWNER, pending(orgType));
    assert.equal(r.status, 400, orgType);
    assert.equal(db.t.organizations.length, 1, `nothing inserted for ${JSON.stringify(orgType)}`);
  }
  assert.equal(founderSignupOrgType(' Laser_Rental '), 'laser_rental');
});

test('H3 API: a stamped row (race: the caller joined a shop between check and insert) is refused and removed', async () => {
  const db = fakeDb({ stampEvenIfNotMember: SHOP });
  const r = await post(db, CLINIC_OWNER, pending('laser_clinic'));
  assert.equal(r.status, 403);
  assert.equal(db.t.organizations.length, 1, 'the row created in this request is deleted');
  assert.ok(db.log.some((l) => l.startsWith('delete organizations 500')));
  assert.ok(!db.log.some((l) => l.startsWith('membership')), 'no owner membership written');
});

test('H3 API: existing stamped org created by an ex-tech (left the shop) is refused', async () => {
  const db = fakeDb();
  db.t.organization_memberships = [];
  db.t.organizations.push({ id: 77, name: 'Old', type: 'customer', created_by: TECH, created_at: new Date().toISOString(), creator_shop_org_id: SHOP });
  const r = await post(db, TECH, { organizationId: 77 });
  assert.equal(r.status, 403);
  assert.ok(!db.log.some((l) => l.startsWith('membership')));
});

test('legit: a clinic owner (in no shop) founds a clinic and becomes owner, unstamped', async () => {
  for (const orgType of CUSTOMER_SIDE) {
    const db = fakeDb();
    const r = await post(db, CLINIC_OWNER, pending(orgType, 'My Clinic'));
    assert.equal(r.status, 200, `${orgType}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.role, 'owner');
    const org = db.t.organizations.find((o) => o.id === r.body.organizationId)!;
    assert.equal(org.type, orgType);
    assert.equal(org.creator_shop_org_id, null);
    assert.ok(db.log.includes(`membership ${CLINIC_OWNER} ${org.id} owner`));
  }
});

test('legit: a shop tech may still found their own service company or supplier (not customer-side)', async () => {
  for (const [orgType, role] of [['service_company', 'company_admin'], ['parts_supplier', 'parts_supplier']]) {
    const db = fakeDb();
    const r = await post(db, TECH, { pending: { kind: orgType === 'service_company' ? 'company' : 'supplier', name: 'New Co', orgType } });
    assert.equal(r.status, 200, `${orgType}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.role, role);
  }
});
