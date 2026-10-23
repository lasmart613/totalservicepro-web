import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptToken, encryptToken, parseTokenKey, signState, verifyState } from './token-crypto.ts';
import { crmEmailEnabled, fallbackFromHeader, providerEnabled, RATE_CAP_DAY, RATE_CAP_HOUR } from './flags.ts';
import { CRM_EMAIL_AUDIENCES, CRM_EMAIL_TEMPLATES, audienceForOrgType, templateBody, textToHtml } from './templates.ts';
import { authorizeUrl, buildMime } from './providers.ts';
import { handleCallback, handleConnect, handleSend, handleStatus, STATE_COOKIE, type UserCtx } from './server.ts';
import { FREE_AI_LINE, SHARED_SERVICE_HISTORY_LINE } from '../billing/plan-tiles.ts';

const here = dirname(fileURLToPath(import.meta.url));
const KEY_HEX = 'a'.repeat(64);
const key = parseTokenKey(KEY_HEX)!;
const ENV = {
  CRM_EMAIL_ENABLED: 'true',
  MAILBOX_TOKEN_KEY: KEY_HEX,
  MAILBOX_MS_CLIENT_ID: 'ms-id',
  MAILBOX_MS_CLIENT_SECRET: 'ms-secret',
  RESEND_API_KEY: 're_test',
  RESEND_FROM: 'RepairPlanet <noreply@repairplanet.net>',
};

test('token crypto round-trips, binds AAD, rejects tampering', () => {
  const enc = encryptToken('refresh-123', key, 'u1:google');
  assert.match(enc, /^v1\./);
  assert.ok(!enc.includes('refresh-123'));
  assert.equal(decryptToken(enc, key, 'u1:google'), 'refresh-123');
  assert.throws(() => decryptToken(enc, key, 'u2:google'));
  assert.throws(() => decryptToken(enc.slice(0, -2) + 'AA', key, 'u1:google'));
  assert.equal(parseTokenKey('short'), null);
});

test('oauth state is signed and expires', () => {
  const s = signState({ u: 'x', exp: Date.now() + 1000 }, key);
  assert.equal(verifyState<{ u: string }>(s, key)?.u, 'x');
  assert.equal(verifyState(s + 'x', key), null);
  assert.equal(verifyState(signState({ u: 'x', exp: Date.now() - 1 }, key), key), null);
});

test('flags are off until env is set', () => {
  assert.equal(crmEmailEnabled({}), false);
  assert.equal(providerEnabled('microsoft', { CRM_EMAIL_ENABLED: 'true' }), false);
  assert.equal(providerEnabled('microsoft', ENV), true);
  assert.equal(providerEnabled('google', ENV), false);
  assert.equal(RATE_CAP_HOUR, 20);
  assert.equal(RATE_CAP_DAY, 100);
  assert.equal(fallbackFromHeader('Ann "A" Lee', 'n@r.net'), '"Ann A Lee via RepairPlanet" <n@r.net>');
});

test('templates: three audiences, free signup CTA, real free-plan lines, rental never promises listings', () => {
  assert.deepEqual([...CRM_EMAIL_AUDIENCES], ['clinic', 'repair_shop', 'rental_shop']);
  for (const a of CRM_EMAIL_AUDIENCES) {
    const tpl = CRM_EMAIL_TEMPLATES[a];
    assert.ok(tpl.bullets.length >= 3 && tpl.bullets.length <= 4);
    const body = templateBody(a, { origin: 'https://repairplanet.net', senderName: 'Sam' });
    assert.match(body, /https:\/\/repairplanet\.net\/signup\/(owner|company)/);
    assert.match(body, /free/i);
  }
  const tiles = readFileSync(join(here, '../billing/plan-tiles.ts'), 'utf8');
  for (const a of CRM_EMAIL_AUDIENCES) for (const b of CRM_EMAIL_TEMPLATES[a].bullets) assert.ok(tiles.includes(b), `invented bullet: ${b}`);
  assert.ok(CRM_EMAIL_TEMPLATES.repair_shop.bullets.includes(FREE_AI_LINE));
  assert.ok(CRM_EMAIL_TEMPLATES.clinic.bullets.includes(SHARED_SERVICE_HISTORY_LINE));
  const rental = JSON.stringify(CRM_EMAIL_TEMPLATES.rental_shop) + templateBody('rental_shop', { origin: 'https://x' });
  assert.doesNotMatch(rental, /listing|list your|list parts|marketplace/i);
  assert.equal(audienceForOrgType('laser_rental'), 'rental_shop');
});

test('html is escaped', () => {
  const h = textToHtml('<script>x</script>\nhttps://a.b/c', 'foot <b>');
  assert.ok(!h.includes('<script>'));
  assert.match(h, /<a href="https:\/\/a\.b\/c">/);
  assert.match(h, /foot &lt;b&gt;/);
});

test('mime strips header injection', () => {
  const m = buildMime('a@b.c', { to: 'x@y.z\r\nBcc: evil@e.com', subject: 'Hi\r\nBcc: e@e', text: 't', html: 'h' }, 'B');
  assert.doesNotMatch(m, /\r\nBcc:/);
});

test('authorize urls request only send scopes + offline', () => {
  const ms = new URL(authorizeUrl('microsoft', { clientId: 'i', clientSecret: 's', tenant: 'common' }, 'https://r/cb', 'st'));
  assert.match(ms.searchParams.get('scope')!, /Mail\.Send/);
  assert.match(ms.searchParams.get('scope')!, /offline_access/);
  assert.doesNotMatch(ms.searchParams.get('scope')!, /Mail\.Read/);
  const g = new URL(authorizeUrl('google', { clientId: 'i', clientSecret: 's', tenant: '' }, 'https://r/cb', 'st'));
  assert.match(g.searchParams.get('scope')!, /gmail\.send/);
  assert.equal(g.searchParams.get('access_type'), 'offline');
});

// ---- fake Supabase ----
type Rows = Record<string, any[]>;
function fakeDb(rows: Rows, rpc: Record<string, (a: any) => any> = {}, log: any[] = []) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let op = 'select';
      let payload: any = null;
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        gt: () => q,
        order: () => q,
        limit: () => q,
        update: (p: any) => ((op = 'update'), (payload = p), q),
        delete: () => ((op = 'delete'), q),
        upsert: (p: any) => (log.push({ table, op: 'upsert', p }), Promise.resolve({ error: null })),
        maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
        then: (res: any, rej: any) => {
          if (op !== 'select') log.push({ table, op, payload });
          return Promise.resolve({ data: match(), error: null }).then(res, rej);
        },
      };
      const match = () => (rows[table] || []).filter((r) => filters.every(([c, v]) => String(r[c]) === String(v)));
      return q;
    },
    rpc: (fn: string, a: any) => (log.push({ rpc: fn, a }), Promise.resolve({ data: rpc[fn] ? rpc[fn](a) : null, error: null })),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'sam@shop.com' } } }) } },
  } as any;
}

const userRows: Rows = {
  organization_customers: [{ service_organization_id: 2655, customer_organization_id: 2639 }],
  organizations: [{ id: 2639, email: 'office@clinic.com', directory_contacts: null }],
  organization_contacts: [],
};
function user(): UserCtx {
  return { userId: 'u1', loginEmail: 'sam@shop.com', profileEmail: 'sam@shop.com', name: 'Sam Lee', orgId: 2655, orgName: 'Shop', userDb: fakeDb(userRows) };
}

test('routes are hidden when CRM_EMAIL_ENABLED is off', async () => {
  const r = await handleSend('tok', {}, { env: {}, authUser: async () => user() });
  assert.equal(r.status, 404);
  const s = await handleStatus('tok', null, { env: {}, authUser: async () => user() });
  assert.equal(s.body.enabled, false);
});

test('send requires auth', async () => {
  const r = await handleSend('', {}, { env: ENV, authUser: async () => null });
  assert.equal(r.status, 401);
});

test('send refuses non-customer and recipients not on file', async () => {
  const deps = { env: ENV, authUser: async () => user(), admin: () => fakeDb({}) };
  const base = { subject: 's', body: 'b', audience: 'clinic' };
  const r1 = await handleSend('t', { ...base, customer_organization_id: 9999, to: 'office@clinic.com' }, deps);
  assert.equal(r1.status, 403);
  const r2 = await handleSend('t', { ...base, customer_organization_id: 2639, to: 'random@else.com' }, deps);
  assert.equal(r2.status, 400);
  assert.equal(r2.body.code, 'recipient_not_on_file');
});

test('rate cap refusal from DB maps to 429 and nothing is sent', async () => {
  let fetched = 0;
  const deps = {
    env: ENV,
    authUser: async () => user(),
    admin: () => fakeDb({}, { customer_email_reserve_send: () => ({ ok: false, code: 'rate_limited_hour' }) }),
    fetchImpl: (async () => (fetched++, new Response('{}'))) as any,
  };
  const r = await handleSend('t', { customer_organization_id: 2639, to: 'office@clinic.com', subject: 's', body: 'b' }, deps);
  assert.equal(r.status, 429);
  assert.equal(fetched, 0);
});

test('fallback sends via Resend as "<name> via RepairPlanet" with Reply-To the user and logs finish', async () => {
  const log: any[] = [];
  let sentBody: any = null;
  const deps = {
    env: ENV,
    authUser: async () => user(),
    admin: () => fakeDb({}, { customer_email_reserve_send: () => ({ ok: true, id: 7 }), customer_email_finish_send: () => true }, log),
    fetchImpl: (async (_u: string, init: any) => ((sentBody = JSON.parse(init.body)), new Response(JSON.stringify({ id: 'r1' }), { status: 200 }))) as any,
  };
  const r = await handleSend('t', { customer_organization_id: 2639, to: 'OFFICE@clinic.com', subject: 'Hi', body: 'Hello', audience: 'clinic' }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.transport, 'resend');
  assert.equal(sentBody.from, '"Sam Lee via RepairPlanet" <noreply@repairplanet.net>');
  assert.equal(sentBody.reply_to, 'sam@shop.com');
  assert.match(sentBody.text, /via RepairPlanet/);
  const reserve = log.find((l) => l.rpc === 'customer_email_reserve_send');
  assert.equal(reserve.a.p_transport, 'resend');
  assert.equal(reserve.a.p_recipient, 'office@clinic.com');
  assert.deepEqual(log.find((l) => l.rpc === 'customer_email_finish_send').a.p_status, 'sent');
});

test('connected Microsoft mailbox sends via Graph from the user address', async () => {
  const enc = encryptToken('rt', key, 'u1:microsoft');
  const urls: string[] = [];
  const deps = {
    env: ENV,
    authUser: async () => user(),
    admin: () =>
      fakeDb(
        { user_mailbox_connections: [{ user_id: 'u1', provider: 'microsoft', email: 'sam@shop.com', refresh_token_enc: enc }] },
        { customer_email_reserve_send: () => ({ ok: true, id: 8 }), customer_email_finish_send: () => true }
      ),
    fetchImpl: (async (u: string) => {
      urls.push(u);
      if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
      return new Response(null, { status: 202 });
    }) as any,
  };
  const r = await handleSend('t', { customer_organization_id: 2639, to: 'office@clinic.com', subject: 'Hi', body: 'Hello' }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.transport, 'microsoft');
  assert.ok(urls.some((u) => u === 'https://graph.microsoft.com/v1.0/me/sendMail'));
  assert.ok(!urls.some((u) => u.includes('resend')));
});

test('oauth callback requires matching nonce cookie and own address', async () => {
  const connect = await handleConnect('t', 'microsoft', 'https://repairplanet.net', { env: ENV, authUser: async () => user() }, 2639);
  assert.equal(connect.status, 200);
  assert.match(String(connect.setCookie), new RegExp(`^${STATE_COOKIE}=.+HttpOnly; Secure; SameSite=Lax`));
  const nonce = String(connect.setCookie).split(';')[0].split('=')[1];
  const state = new URL(String(connect.body.url)).searchParams.get('state');
  const fetchFor = (addr: string) =>
    (async (u: string) =>
      u.includes('/token')
        ? new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', scope: 'Mail.Send' }), { status: 200 })
        : new Response(JSON.stringify({ mail: addr }), { status: 200 })) as any;
  const bad = await handleCallback({ code: 'c', state }, 'other', 'https://repairplanet.net', { env: ENV, admin: () => fakeDb({}), fetchImpl: fetchFor('sam@shop.com') });
  assert.match(String(bad.redirect), /mailbox=bad_state/);
  const wrong = await handleCallback({ code: 'c', state }, nonce, 'https://repairplanet.net', {
    env: ENV,
    admin: () => fakeDb({ user_profiles: [{ id: 'u1', email: 'sam@shop.com' }] }),
    fetchImpl: fetchFor('someone@else.com'),
  });
  assert.match(String(wrong.redirect), /mailbox=wrong_address/);
  const log: any[] = [];
  const ok = await handleCallback({ code: 'c', state }, nonce, 'https://repairplanet.net', {
    env: ENV,
    admin: () => fakeDb({ user_profiles: [{ id: 'u1', email: 'sam@shop.com' }] }, {}, log),
    fetchImpl: fetchFor('Sam@Shop.com'),
  });
  assert.equal(ok.redirect, 'https://repairplanet.net/customers/2639?tab=email&mailbox=connected');
  const up = log.find((l) => l.op === 'upsert');
  assert.match(up.p.refresh_token_enc, /^v1\./);
  assert.equal(decryptToken(up.p.refresh_token_enc, key, 'u1:microsoft'), 'rt');
});

test('routes never use default privileges and migration grants are explicit', () => {
  const sql = readFileSync(join(here, '../../supabase/migrations/20261022_000940_crm_customer_email.sql'), 'utf8');
  assert.doesNotMatch(sql, /ALTER DEFAULT PRIVILEGES/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /lock_timeout/);
});

test('composer copy is translated for every locale and used keys exist', async () => {
  const { CRM_EMAIL_STRINGS } = await import('../i18n/crm-email-copy.ts');
  for (const [k, v] of Object.entries(CRM_EMAIL_STRINGS)) {
    assert.equal(Object.keys(v).length, 8, k);
    for (const [loc, s] of Object.entries(v)) assert.ok(s && s !== k, `${loc} left English: ${k}`);
  }
  const src = readFileSync(join(here, '../../components/CustomerEmailComposer.tsx'), 'utf8');
  for (const m of src.matchAll(/\bt\('([^']+)'\)/g)) assert.ok(CRM_EMAIL_STRINGS[m[1]], `missing copy: ${m[1]}`);
});
