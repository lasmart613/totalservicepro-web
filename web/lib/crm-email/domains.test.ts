import assert from 'node:assert/strict';
import test from 'node:test';
import { canManageDomain, ownDomainSender, validateSendingDomain } from './domains.ts';
import { handleDomainCreate, handleDomainRemove, handleDomainStatus, handleDomainVerify, handleSend, ownDomainFromHeader, type UserCtx } from './server.ts';

type Rows = Record<string, any[]>;
const ENV = { CRM_EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_test', RESEND_FROM: 'RepairPlanet <noreply@repairplanet.net>' };

function fakeDb(rows: Rows, rpc: Record<string, (a: any) => any> = {}, log: any[] = [], insertError: any = null) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let op = 'select';
      let payload: any = null;
      const match = () => (rows[table] || []).filter((r) => filters.every(([c, v]) => String(r[c]) === String(v)));
      const q: any = {
        select: () => q, eq: (c: string, v: unknown) => (filters.push([c, v]), q), gt: () => q, order: () => q, limit: () => q,
        update: (p: any) => ((op = 'update'), (payload = p), q),
        delete: () => ((op = 'delete'), q),
        insert: (p: any) => (log.push({ table, op: 'insert', p }), Promise.resolve({ error: insertError })),
        upsert: (p: any) => (log.push({ table, op: 'upsert', p }), Promise.resolve({ error: null })),
        maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
        then: (res: any, rej: any) => {
          if (op !== 'select') log.push({ table, op, payload });
          return Promise.resolve({ data: match(), error: null }).then(res, rej);
        },
      };
      return q;
    },
    rpc: (fn: string, a: any) => (log.push({ rpc: fn, a }), Promise.resolve({ data: rpc[fn] ? rpc[fn](a) : null, error: null })),
  } as any;
}

const custRows: Rows = {
  organization_customers: [{ service_organization_id: 2655, customer_organization_id: 2639 }],
  organizations: [{ id: 2639, email: 'office@clinic.com', directory_contacts: null }],
  organization_contacts: [],
};
function user(email = 'sam@shop.com'): UserCtx {
  return { userId: 'u1', loginEmail: email, profileEmail: email, name: 'Sam Lee', orgId: 2655, orgName: 'Shop', userDb: fakeDb(custRows) };
}
const admin = (role = 'owner') => ({ organization_memberships: [{ user_id: 'u1', organization_id: 2655, role }] });
const DOMAIN = { organization_id: 2655, resend_domain_id: 'd_1', domain_name: 'shop.com', status: 'not_started', region: 'us-east-1', records: [], checked_at: null };
const remote = (status = 'not_started') => ({ id: 'd_1', name: 'shop.com', status, region: 'us-east-1', records: [{ record: 'SPF', name: 'send', type: 'MX', value: 'feedback-smtp.us-east-1.amazonses.com', ttl: 'Auto', status, priority: 10 }] });
function fetchLog(map: (url: string, init: any) => any) {
  const calls: { url: string; method: string; body: any }[] = [];
  const f = (async (url: string, init: any) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
    const [status, j] = map(url, init) ?? [200, {}];
    return new Response(JSON.stringify(j), { status });
  }) as any;
  return { calls, f };
}

test('domain validation: blocks repairplanet.net always, internal domains except listed orgs, shared/free mail', () => {
  assert.deepEqual(validateSendingDomain('https://Shop.COM/x', 1, {}), { ok: true, domain: 'shop.com' });
  assert.deepEqual(validateSendingDomain('sam@shop.com', 1, {}), { ok: true, domain: 'shop.com' });
  for (const d of ['repairplanet.net', 'mail.repairplanet.net']) {
    assert.equal(validateSendingDomain(d, 2655, { CRM_EMAIL_INTERNAL_ORG_IDS: '2655' }).ok, false, d);
  }
  assert.equal(validateSendingDomain('medicalrepairnetwork.com', 7, {}).ok, false);
  assert.equal(validateSendingDomain('medicalrepairnetwork.com', 7, { CRM_EMAIL_INTERNAL_ORG_IDS: '7' }).ok, true);
  for (const d of ['gmail.com', 'outlook.com', 'foo.local', 'xn--bcher-kva.com', 'not a domain', '']) assert.equal(validateSendingDomain(d, 1, {}).ok, false, d);
});

test('only owner/company_admin/admin can manage', async () => {
  for (const r of ['owner', 'company_admin', 'admin', ' Admin ']) assert.equal(await canManageDomain(fakeDb(admin(r)), 'u1', 2655), true, r);
  for (const r of ['technician', 'member', '']) assert.equal(await canManageDomain(fakeDb(admin(r)), 'u1', 2655), false, r);
  const res = await handleDomainCreate('t', { domain: 'shop.com' }, { env: ENV, authUser: async () => user(), admin: () => fakeDb(admin('technician')) });
  assert.equal(res.status, 403);
});

test('status is hidden when flag is off', async () => {
  const r = await handleDomainStatus('t', false, { env: {}, authUser: async () => user(), admin: () => fakeDb(admin()) });
  assert.deepEqual(r.body, { enabled: false });
});

test('create calls POST /domains, stores records, returns them; blocked domain never reaches Resend', async () => {
  const log: any[] = [];
  const { calls, f } = fetchLog(() => [200, remote()]);
  const deps = { env: ENV, authUser: async () => user(), admin: () => fakeDb(admin(), {}, log), fetchImpl: f };
  const bad = await handleDomainCreate('t', { domain: 'repairplanet.net' }, deps);
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
  const r = await handleDomainCreate('t', { domain: 'shop.com' }, deps);
  assert.equal(r.status, 200);
  assert.equal(calls[0].url, 'https://api.resend.com/domains');
  assert.deepEqual(calls[0].body, { name: 'shop.com' });
  const ins = log.find((l) => l.op === 'insert');
  assert.equal(ins.p.resend_domain_id, 'd_1');
  assert.equal(ins.p.domain_name, 'shop.com');
  assert.equal(r.body.domain.records[0].type, 'MX');
  assert.equal(r.body.sendsAs, null);
});

test('create refuses second domain and taken domain; deletes Resend orphan when save fails', async () => {
  const { calls, f } = fetchLog((u, i) => (i.method === 'DELETE' ? [200, { deleted: true }] : [200, remote()]));
  const exists = await handleDomainCreate('t', { domain: 'other.com' }, { env: ENV, authUser: async () => user(), admin: () => fakeDb({ ...admin(), org_sending_domains: [DOMAIN] }), fetchImpl: f });
  assert.equal(exists.status, 409);
  const taken = await handleDomainCreate('t', { domain: 'shop.com' }, { env: ENV, authUser: async () => user(), admin: () => fakeDb({ ...admin(), org_sending_domains: [{ ...DOMAIN, organization_id: 9 }] }), fetchImpl: f });
  assert.equal(taken.body.code, 'domain_taken');
  assert.equal(calls.length, 0);
  const fail = await handleDomainCreate('t', { domain: 'shop.com' }, { env: ENV, authUser: async () => user(), admin: () => fakeDb(admin(), {}, [], { message: 'x' }), fetchImpl: f });
  assert.equal(fail.status, 503);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'DELETE']);
});

test('verify is rate limited by the DB claim and otherwise calls verify then get', async () => {
  const { calls, f } = fetchLog((u) => (u.endsWith('/verify') ? [200, { object: 'domain', id: 'd_1' }] : [200, remote('pending')]));
  const limited = await handleDomainVerify('t', { env: ENV, authUser: async () => user(), admin: () => fakeDb({ ...admin(), org_sending_domains: [DOMAIN] }, { org_sending_domain_claim_verify: () => ({ ok: false, code: 'rate_limited', retry_after: 22 }) }), fetchImpl: f });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.retryAfter, 22);
  assert.equal(calls.length, 0);
  const log: any[] = [];
  const ok = await handleDomainVerify('t', { env: ENV, authUser: async () => user(), admin: () => fakeDb({ ...admin(), org_sending_domains: [DOMAIN] }, { org_sending_domain_claim_verify: () => ({ ok: true, resend_domain_id: 'd_1' }) }, log), fetchImpl: f });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST https://api.resend.com/domains/d_1/verify', 'GET https://api.resend.com/domains/d_1']);
  assert.equal(ok.body.domain.status, 'pending');
  assert.equal(log.find((l) => l.op === 'update').payload.status, 'pending');
});

test('status refresh polls Resend at most every 15s', async () => {
  const { calls, f } = fetchLog(() => [200, remote('verified')]);
  const fresh = { ...DOMAIN, checked_at: new Date().toISOString() };
  await handleDomainStatus('t', true, { env: ENV, authUser: async () => user(), admin: () => fakeDb({ ...admin(), org_sending_domains: [fresh] }), fetchImpl: f });
  assert.equal(calls.length, 0);
  const r = await handleDomainStatus('t', true, { env: ENV, authUser: async () => user(), admin: () => fakeDb({ ...admin(), org_sending_domains: [DOMAIN] }), fetchImpl: f });
  assert.equal(calls.length, 1);
  assert.equal(r.body.domain.status, 'verified');
  assert.equal(r.body.sendsAs, 'sam@shop.com');
});

test('remove calls DELETE /domains/{id} and deletes the row', async () => {
  const log: any[] = [];
  const { calls, f } = fetchLog(() => [200, { deleted: true }]);
  const r = await handleDomainRemove('t', { env: ENV, authUser: async () => user(), admin: () => fakeDb({ ...admin(), org_sending_domains: [DOMAIN] }, {}, log), fetchImpl: f });
  assert.equal(r.status, 200);
  assert.equal(calls[0].method, 'DELETE');
  assert.ok(log.find((l) => l.table === 'org_sending_domains' && l.op === 'delete'));
});

test('send uses own verified domain only on exact domain match, else falls back', async () => {
  assert.equal(ownDomainSender(['sam@shop.com'], { domain_name: 'shop.com', status: 'pending' }), '');
  assert.equal(ownDomainSender(['sam@mail.shop.com'], { domain_name: 'shop.com', status: 'verified' }), '');
  assert.equal(ownDomainFromHeader('Sam "<x>" Lee', 'sam@shop.com'), '"Sam x Lee" <sam@shop.com>');
  const verified = { ...DOMAIN, status: 'verified' };
  for (const [email, transport, from] of [
    ['sam@shop.com', 'resend_domain', '"Sam Lee" <sam@shop.com>'],
    ['sam@mail.shop.com', 'resend', '"Sam Lee via RepairPlanet" <noreply@repairplanet.net>'],
  ]) {
    const log: any[] = [];
    let sent: any = null;
    const deps = {
      env: ENV,
      authUser: async () => user(email),
      admin: () => fakeDb({ org_sending_domains: [verified] }, { customer_email_reserve_send: () => ({ ok: true, id: 7 }), customer_email_finish_send: () => true }, log),
      fetchImpl: (async (_u: string, init: any) => ((sent = JSON.parse(init.body)), new Response(JSON.stringify({ id: 'r1' }), { status: 200 }))) as any,
    };
    const r = await handleSend('t', { customer_organization_id: 2639, to: 'office@clinic.com', subject: 'Hi', body: 'Hello', audience: 'clinic' }, deps);
    assert.equal(r.status, 200, email);
    assert.equal(r.body.transport, transport);
    assert.equal(sent.from, from);
    assert.equal(sent.reply_to, email);
    assert.equal(log.find((l) => l.rpc === 'customer_email_reserve_send').a.p_transport, transport);
  }
});
