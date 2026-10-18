/**
 * Tests for supabase/functions/register-directory-org (not part of npm test; needs Deno).
 *
 *   deno test -A supabase/tests/register-directory-org.test.ts
 *
 * Unit cases stub the Supabase REST call. Set MRN_PG_DB=<db> (local PG on
 * /tmp:55309 with migration 000926 applied, see the PR body) to also run the
 * end-to-end cases, which route the RPC through psql as service_role.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { handle } from '../functions/register-directory-org/handler.ts'
import {
  checkFormTicket,
  checkStep2Token,
  issueFormTicket,
  issueStep2Token,
  parseAllowedOrigins,
  parseStep1,
  parseStep2,
} from '../functions/register-directory-org/contract.ts'

const SECRET = 'x'.repeat(40)
const ORIGIN = 'https://medicalrepairnetwork.com'
const RID = '6f1c2a5e-4b7d-4c1e-9a0b-1234567890ab'

type Call = { url: string; body: any }

function env(extra: Record<string, string> = {}) {
  const e: Record<string, string> = {
    SUPABASE_URL: 'http://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    DIRECTORY_FORM_SECRET: SECRET,
    ...extra,
  }
  return (k: string) => e[k]
}

function stub(reply: (name: string, args: any) => any, calls: Call[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : String(init?.body)
    calls.push({ url, body })
    if (url.startsWith('https://challenges.cloudflare.com')) return new Response(JSON.stringify(reply('turnstile', body)))
    const name = url.split('/rpc/')[1]
    return new Response(JSON.stringify(reply(name, body)), { status: 200 })
  }) as typeof fetch
}

function post(body: unknown, origin: string | null = ORIGIN, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers }
  if (origin) h.origin = origin
  return new Request('http://fn.test/register-directory-org', { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

async function oldTicket() {
  return issueFormTicket(SECRET, Date.now() - 10_000)
}

const START = { action: 'start', name: 'Delta Laser Repair', kind: 'service', email: 'pat@deltalaser.com', state: 'AZ', zip: '85004' }

Deno.test('CORS: unknown origin is 403 and gets no allow-origin header', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START, ticket: await oldTicket() }, 'https://evil.example'), env(), stub(() => ({}), calls))
  assertEquals(r.status, 403)
  assertEquals(r.headers.get('access-control-allow-origin'), null)
  assertEquals(calls.length, 0)
})

Deno.test('CORS: missing origin is 403', async () => {
  const r = await handle(post({ ...START }, null), env(), stub(() => ({})))
  assertEquals(r.status, 403)
})

Deno.test('CORS: default allowlist is apex + www; env list replaces it', async () => {
  assertEquals(parseAllowedOrigins(''), ['https://medicalrepairnetwork.com', 'https://www.medicalrepairnetwork.com'])
  assertEquals(parseAllowedOrigins('https://a.netlify.app/, junk, https://b.example'), ['https://a.netlify.app', 'https://b.example'])
  const pre = new Request('http://fn.test', { method: 'OPTIONS', headers: { origin: 'https://www.medicalrepairnetwork.com' } })
  const r = await handle(pre, env(), stub(() => ({})))
  assertEquals(r.status, 204)
  assertEquals(r.headers.get('access-control-allow-origin'), 'https://www.medicalrepairnetwork.com')
  const r2 = await handle(post({}, ORIGIN), env({ DIRECTORY_ALLOWED_ORIGINS: 'https://preview.netlify.app' }), stub(() => ({})))
  assertEquals(r2.status, 403)
})

Deno.test('no secret configured -> 503, nothing called', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START }), env({ DIRECTORY_FORM_SECRET: 'short' }), stub(() => ({}), calls))
  assertEquals(r.status, 503)
  assertEquals(calls.length, 0)
})

Deno.test('GET issues a form ticket; Turnstile flag reported off by default', async () => {
  const r = await handle(new Request('http://fn.test', { headers: { origin: ORIGIN } }), env(), stub(() => ({})))
  const j = await r.json()
  assertEquals(r.status, 200)
  assertEquals(j.turnstile, false)
  assertEquals(await checkFormTicket(SECRET, j.ticket, Date.now() + 5000), 'ok')
})

Deno.test('form ticket: too fast, expired, forged', async () => {
  const now = Date.now()
  const t = await issueFormTicket(SECRET, now)
  assertEquals(await checkFormTicket(SECRET, t, now + 1000), 'too_fast')
  assertEquals(await checkFormTicket(SECRET, t, now + 3 * 3600_000), 'expired')
  assertEquals(await checkFormTicket('y'.repeat(40), t, now + 5000), 'invalid')
  assertEquals(await checkFormTicket(SECRET, t + 'x', now + 5000), 'invalid')
  const step2 = await issueStep2Token(SECRET, RID, 5, now - 10_000)
  assertEquals(await checkFormTicket(SECRET, step2, now), 'invalid', 'step-2 token is not a form ticket')
})

Deno.test('submitting under the minimum fill time is refused before any DB call', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START, ticket: await issueFormTicket(SECRET) }), env(), stub(() => ({}), calls))
  assertEquals(r.status, 400)
  assertEquals(calls.length, 0)
})

Deno.test('honeypot: neutral 200 and no DB call', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START, ticket: await oldTicket(), company_url: 'http://spam' }), env(), stub(() => ({}), calls))
  const j = await r.json()
  assertEquals(r.status, 200)
  assertEquals(j.status, 'review')
  assertEquals(calls.length, 0)
})

Deno.test('step 1 created -> signed step-2 token bound to rid + oid; IP is hashed', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START, ticket: await oldTicket() }), env(),
    stub(() => ({ ok: true, status: 'created', registration_id: RID, organization_id: 4242 }), calls))
  const j = await r.json()
  assertEquals(j.status, 'created')
  assertEquals(await checkStep2Token(SECRET, j.token), { rid: RID, oid: 4242 })
  assertEquals(calls[0].url, 'http://supa.test/rest/v1/rpc/directory_registration_step1')
  assertEquals(calls[0].body.p_kind, 'service')
  assert(!JSON.stringify(calls[0].body).includes('203.0.113.9'), 'raw IP never sent to the DB')
  assertEquals(JSON.stringify(j).includes('4242'), false, 'org id not exposed in plain JSON')
})

Deno.test('step 1 review -> neutral message, no token, no matched details', async () => {
  const r = await handle(post({ ...START, ticket: await oldTicket() }), env(),
    stub(() => ({ ok: true, status: 'review' })))
  const j = await r.json()
  assertEquals(j.status, 'review')
  assertEquals(j.token, undefined)
  assertEquals(Object.keys(j).sort(), ['message', 'ok', 'status'])
})

Deno.test('step 1 rate limited -> 429', async () => {
  const r = await handle(post({ ...START, ticket: await oldTicket() }), env(), stub(() => ({ ok: false, reason: 'rate_limited' })))
  assertEquals(r.status, 429)
})

Deno.test('step 1 validation', () => {
  assertEquals(parseStep1({ ...START, kind: 'vendor' }), { ok: false, field: 'kind' })
  assertEquals(parseStep1({ ...START, email: 'nope' }), { ok: false, field: 'email' })
  assertEquals(parseStep1({ ...START, state: 'ZZ' }), { ok: false, field: 'state' })
  assertEquals(parseStep1({ ...START, zip: '123' }), { ok: false, field: 'zip' })
  assertEquals(parseStep1({ ...START, name: 'x' }), { ok: false, field: 'name' })
  const ok = parseStep1({ ...START, email: ' PAT@DeltaLaser.com ', state: 'az', zip: '' })
  assert(ok.ok)
  if (ok.ok) assertEquals(ok.value, { name: 'Delta Laser Repair', kind: 'service', email: 'pat@deltalaser.com', state: 'AZ', zip: null })
})

Deno.test('Turnstile: enabled flag without a passing token refuses; off by default skips it', async () => {
  const e = env({ DIRECTORY_TURNSTILE_ENABLED: '1', TURNSTILE_SECRET_KEY: 'ts' })
  const calls: Call[] = []
  const r = await handle(post({ ...START, ticket: await oldTicket() }), e, stub(() => ({ success: false }), calls))
  assertEquals(r.status, 400)
  assert(!calls.some((c) => c.url.includes('/rpc/')))
  const r2 = await handle(post({ ...START, ticket: await oldTicket(), turnstile: 'tok' }), e,
    stub((n) => (n === 'turnstile' ? { success: true } : { ok: true, status: 'review' })))
  assertEquals(r2.status, 200)
  const flagOnly = env({ DIRECTORY_TURNSTILE_ENABLED: '1' })
  const r3 = await handle(post({ ...START, ticket: await oldTicket() }), flagOnly, stub(() => ({ ok: true, status: 'review' })))
  assertEquals(r3.status, 200, 'flag without a secret stays off')
})

Deno.test('step 2: forged, expired or tampered token never reaches the DB', async () => {
  const calls: Call[] = []
  const fx = stub(() => ({ ok: true }), calls)
  const good = await issueStep2Token(SECRET, RID, 7)
  const [body, sig] = good.split('.')
  const tampered = btoa(JSON.stringify({ rid: RID, oid: 1, exp: 9e9 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.' + sig
  const expired = await issueStep2Token(SECRET, RID, 7, Date.now() - 2 * 3600_000)
  const other = await issueStep2Token('z'.repeat(40), RID, 7)
  for (const token of [tampered, expired, other, body, 'garbage', undefined]) {
    const r = await handle(post({ action: 'complete', token, contact_name: 'Pat' }), env(), fx)
    assertEquals(r.status, 400)
  }
  assertEquals(calls.length, 0)
  assertEquals(await checkStep2Token(SECRET, await issueFormTicket(SECRET)), null, 'form ticket is not a step-2 token')
})

Deno.test('step 2: org id comes only from the token, body ids are ignored', async () => {
  const calls: Call[] = []
  const token = await issueStep2Token(SECRET, RID, 7)
  const r = await handle(post({ action: 'complete', token, contact_name: 'Pat Lee', organization_id: 1, p_organization_id: 1,
    type: 'customer', list_in_directory: true, is_premium: true, brands: 'Candela, Cutera, candela' }), env(),
    stub(() => ({ ok: true, status: 'received' }), calls))
  assertEquals(r.status, 200)
  assertEquals(calls[0].body.p_organization_id, 7)
  assertEquals(calls[0].body.p_registration_id, RID)
  assertEquals(calls[0].body.p_fields.brands, ['Candela', 'Cutera'])
  for (const k of ['type', 'list_in_directory', 'is_premium', 'organization_id']) assertEquals(k in calls[0].body.p_fields, false)
})

Deno.test('step 2: DB refusal (used/expired) -> 400 restart', async () => {
  const token = await issueStep2Token(SECRET, RID, 7)
  const r = await handle(post({ action: 'complete', token, contact_name: 'Pat Lee' }), env(), stub(() => ({ ok: false, reason: 'expired' })))
  assertEquals(r.status, 400)
  assertEquals((await r.json()).restart, true)
})

Deno.test('step 2 validation', () => {
  assertEquals(parseStep2({ contact_name: '' }), { ok: false, field: 'contact_name' })
  assertEquals(parseStep2({ contact_name: 'Pat', website: 'not a url' }), { ok: false, field: 'website' })
  assertEquals(parseStep2({ contact_name: 'Pat', phone: '12' }), { ok: false, field: 'phone' })
  const ok = parseStep2({ contact_name: 'Pat', website: 'deltalaser.com', years_in_business: '12', num_techs: 'many', coverage: ['AZ', 'NM'] })
  assert(ok.ok)
  if (ok.ok) {
    assertEquals(ok.fields.website, 'https://deltalaser.com')
    assertEquals(ok.fields.years_in_business, '12')
    assertEquals('num_techs' in ok.fields, false)
  }
})

Deno.test('bad JSON, oversize body, unknown action, DB down', async () => {
  assertEquals((await handle(post('{not json'), env(), stub(() => ({})))).status, 400)
  assertEquals((await handle(post('x'.repeat(20_000)), env(), stub(() => ({})))).status, 413)
  assertEquals((await handle(post({ action: 'delete' }), env(), stub(() => ({})))).status, 400)
  const down = (async () => new Response('boom', { status: 500 })) as typeof fetch
  const r = await handle(post({ ...START, ticket: await oldTicket() }), env(), down)
  assertEquals(r.status, 503)
})

// ---------- end-to-end against local PG17 ----------
const DB = Deno.env.get('MRN_PG_DB')

function pgFetch(db: string) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const name = String(input).split('/rpc/')[1]
    const a = JSON.parse(String(init?.body))
    const lit = (v: unknown) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
    const sql = name === 'directory_registration_step1'
      ? `select public.directory_registration_step1(${lit(a.p_name)},${lit(a.p_kind)},${lit(a.p_email)},${lit(a.p_state)},${lit(a.p_zip)},${lit(a.p_ip_hash)})`
      : `select public.directory_registration_step2(${lit(a.p_registration_id)}::uuid,${Number(a.p_organization_id)},${lit(JSON.stringify(a.p_fields))}::jsonb)`
    const out = await new Deno.Command('psql', {
      args: ['-h', '/tmp', '-p', '55309', '-U', 'postgres', '-d', db, '-Atq', '-c', `set role service_role; ${sql}`],
    }).output()
    return new Response(new TextDecoder().decode(out.stdout).trim() || '{}')
  }) as typeof fetch
}

async function q(db: string, sql: string) {
  const out = await new Deno.Command('psql', { args: ['-h', '/tmp', '-p', '55309', '-U', 'postgres', '-d', db, '-Atq', '-c', sql] }).output()
  return new TextDecoder().decode(out.stdout).trim()
}

Deno.test({ name: 'e2e: start + complete creates one pending unlisted org; token is single use', ignore: !DB, fn: async () => {
  const fx = pgFetch(DB!)
  const name = `E2E Co ${crypto.randomUUID().slice(0, 8)}`
  const r1 = await handle(post({ ...START, name, email: `a@${name.slice(7)}.example`, ticket: await oldTicket() }, ORIGIN, { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200)}` }), env(), fx)
  const j1 = await r1.json()
  assertEquals(j1.status, 'created')
  const r2 = await handle(post({ action: 'complete', token: j1.token, contact_name: 'Pat', website: 'e2e.example', brands: ['Candela'] }), env(), fx)
  assertEquals((await r2.json()).status, 'received')
  assertEquals(await q(DB!, `select type||'|'||is_active||'|'||list_in_directory||'|'||website||'|'||supported_brands::text from organizations where name='${name}'`),
    'service_company|false|false|https://e2e.example|{Candela}')
  const r3 = await handle(post({ action: 'complete', token: j1.token, contact_name: 'Again' }), env(), fx)
  assertEquals(r3.status, 400)
}})

Deno.test({ name: 'e2e: known company -> neutral review, no org created', ignore: !DB, fn: async () => {
  const fx = pgFetch(DB!)
  const before = await q(DB!, 'select count(*) from organizations')
  const r = await handle(post({ ...START, name: 'Acme Laser Service', email: 'zz@acmelaser.com', ticket: await oldTicket() }, ORIGIN, { 'x-forwarded-for': '192.0.2.77' }), env(), fx)
  const j = await r.json()
  assertEquals(j.status, 'review')
  assertEquals(await q(DB!, 'select count(*) from organizations'), before)
}})
