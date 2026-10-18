/**
 * Tests for supabase/functions/register-directory-org (not part of npm test; needs Deno).
 *
 *   deno test -A supabase/tests/register-directory-org.test.ts
 *
 * Unit cases stub the Supabase REST call. Set MRN_PG_DB=<db> (local PG on
 * /tmp:55309 with migration 000926 applied, see the PR body) to also run the
 * end-to-end cases, which route the RPC through psql as service_role.
 * Set MRN_TURNSTILE_LIVE=1 to also call Cloudflare's real siteverify with its
 * documented TEST secret keys (always-pass / always-fail).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { handle, logConfigOnce, resetColdStart } from '../functions/register-directory-org/handler.ts'
import {
  buildReviewNotice,
  checkFormTicket,
  checkStep2Token,
  clientIp,
  clientIpSource,
  emailKey,
  isBlockedRecipient,
  turnstileEnabled,
  cpLength,
  fieldError,
  issueFormTicket,
  issueStep2Token,
  parseAllowedOrigins,
  parseStep1,
  parseStep2,
  REVIEW_NOTICE_SUBJECT,
  reviewInbox,
} from '../functions/register-directory-org/contract.ts'

const SECRET = 'x'.repeat(40)
const ORIGIN = 'https://medicalrepairnetwork.com'
const RID = '6f1c2a5e-4b7d-4c1e-9a0b-1234567890ab'
// Cloudflare's documented Turnstile test keys (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
const TS_PASS_SECRET = '1x0000000000000000000000000000000AA'
const TS_FAIL_SECRET = '2x0000000000000000000000000000000AA'
const TS_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

type Call = { url: string; body: any }

function env(extra: Record<string, string> = {}) {
  const e: Record<string, string> = {
    SUPABASE_URL: 'http://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    DIRECTORY_FORM_SECRET: SECRET,
    DIRECTORY_MIN_RESPONSE_MS: '0',
    ...extra,
  }
  return (k: string) => e[k]
}

function stub(reply: (name: string, args: any) => any, calls: Call[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : String(init?.body)
    calls.push({ url, body })
    if (url.startsWith('https://challenges.cloudflare.com')) {
      const r = reply('turnstile', body)
      if (r === 'throw') throw new Error('network down')
      return new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: r?.status ?? 200 })
    }
    if (url.startsWith('https://api.resend.com')) {
      const r = reply('resend', body)
      if (r === 'throw') throw new Error('network down')
      return new Response(JSON.stringify(r ?? { id: 'em_1' }), { status: r?.status ?? 200 })
    }
    const name = url.split('/rpc/')[1]
    return new Response(JSON.stringify(reply(name, body)), { status: 200 })
  }) as typeof fetch
}

function post(body: unknown, origin: string | null = ORIGIN, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...headers }
  if (origin) h.origin = origin
  return new Request('http://fn.test/register-directory-org', { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

async function oldTicket() {
  return issueFormTicket(SECRET, Date.now() - 10_000)
}

const START = { action: 'start', name: 'Delta Laser Repair', kind: 'service', email: 'pat@deltalaser.com', state: 'AZ', zip: '85004' }
const created = () => ({ ok: true, status: 'created', registration_id: crypto.randomUUID() })

function tokenShape(token: string) {
  const [b] = token.split('.')
  const p = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b.length + 3) % 4)))
  return Object.keys(p).sort().join(',')
}

// ---------- CORS / config ----------

Deno.test('CORS: unknown origin is 403 and gets no allow-origin header', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START, ticket: await oldTicket() }, 'https://evil.example'), env(), stub(() => ({}), calls))
  assertEquals(r.status, 403)
  assertEquals(r.headers.get('access-control-allow-origin'), null)
  assertEquals(calls.length, 0)
})

Deno.test('CORS: missing origin is 403', async () => {
  assertEquals((await handle(post({ ...START }, null), env(), stub(() => ({})))).status, 403)
})

Deno.test('CORS: default apex + www; env list replaces it; preview origin; invalid entries warn (L-10)', async () => {
  const warnings: string[] = []
  assertEquals(parseAllowedOrigins('', (m) => warnings.push(m)), ['https://medicalrepairnetwork.com', 'https://www.medicalrepairnetwork.com'])
  assertEquals(warnings.length, 0)
  assertEquals(parseAllowedOrigins('https://a.netlify.app/, junk, https://b.example', (m) => warnings.push(m)), ['https://a.netlify.app', 'https://b.example'])
  assert(warnings.some((w) => w.includes('junk')))
  assertEquals(parseAllowedOrigins('medicalrepairnetwork.netlify.app', (m) => warnings.push(m)).length, 2)
  assert(warnings.some((w) => w.includes('using the defaults')))
  const ship = 'https://medicalrepairnetwork.com,https://www.medicalrepairnetwork.com,https://medicalrepairnetwork.netlify.app'
  const pre = new Request('http://fn.test', { method: 'OPTIONS', headers: { origin: 'https://medicalrepairnetwork.netlify.app' } })
  const r = await handle(pre, env({ DIRECTORY_ALLOWED_ORIGINS: ship }), stub(() => ({})))
  assertEquals(r.status, 204)
  assertEquals(r.headers.get('access-control-allow-origin'), 'https://medicalrepairnetwork.netlify.app')
  const r2 = await handle(post({}, ORIGIN), env({ DIRECTORY_ALLOWED_ORIGINS: 'https://preview.netlify.app' }), stub(() => ({})))
  assertEquals(r2.status, 403)
})

Deno.test('no secret configured -> 503, nothing called', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START }), env({ DIRECTORY_FORM_SECRET: 'short' }), stub(() => ({}), calls))
  assertEquals(r.status, 503)
  assertEquals(calls.length, 0)
})

// ---------- M-1: client IP ----------

Deno.test('M-1r: default source is CF-Connecting-IP; XFF and X-Real-IP ignored', () => {
  const h = (o: Record<string, string>) => new Headers(o)
  assertEquals(clientIp(h({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '2.2.2.2' })), '198.51.100.7')
  assertEquals(clientIp(h({ 'x-forwarded-for': '198.51.100.7', 'x-real-ip': '2.2.2.2' })), null)
  assertEquals(clientIp(h({ 'cf-connecting-ip': 'unknown' })), null)
  assertEquals(clientIp(h({ 'cf-connecting-ip': '2001:DB8::1' })), '2001:db8::1')
})

Deno.test('M-1r: x-forwarded-for-rightmost option uses only the last hop', () => {
  const h = (o: Record<string, string>) => new Headers(o)
  const src = 'x-forwarded-for-rightmost' as const
  assertEquals(clientIp(h({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }), src), '198.51.100.7')
  assertEquals(clientIp(h({ 'cf-connecting-ip': '1.1.1.1' }), src), null)
  assertEquals(clientIp(h({ 'x-forwarded-for': '198.51.100.7, junk' }), src), null)
})

Deno.test('M-1r: DIRECTORY_CLIENT_IP_HEADER parsing', () => {
  assertEquals(clientIpSource(env()), { source: 'cf-connecting-ip', invalid: null })
  assertEquals(clientIpSource(env({ DIRECTORY_CLIENT_IP_HEADER: ' X-Forwarded-For-Rightmost ' })), { source: 'x-forwarded-for-rightmost', invalid: null })
  assertEquals(clientIpSource(env({ DIRECTORY_CLIENT_IP_HEADER: 'x-real-ip' })), { source: 'cf-connecting-ip', invalid: 'x-real-ip' })
})

Deno.test('M-1r: handler hashes the configured header; spoofing the other header changes nothing', async () => {
  const run = async (e: ReturnType<typeof env>, headers: Record<string, string>) => {
    const calls: Call[] = []
    await handle(post({ ...START, ticket: await oldTicket() }, ORIGIN, headers), e, stub(created, calls))
    return calls[0].body.p_ip_hash as string | null
  }
  const cf = new Set<string | null>()
  for (let i = 0; i < 4; i++) cf.add(await run(env(), { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': `10.0.0.${i}`, 'x-real-ip': `10.1.0.${i}` }))
  assertEquals(cf.size, 1)
  assert([...cf][0])
  assertEquals(await run(env(), { 'cf-connecting-ip': '', 'x-forwarded-for': '198.51.100.7' }), null, 'default ignores XFF')
  const xe = env({ DIRECTORY_CLIENT_IP_HEADER: 'x-forwarded-for-rightmost' })
  const x = new Set<string | null>()
  for (let i = 0; i < 4; i++) x.add(await run(xe, { 'x-forwarded-for': `10.0.0.${i}, 198.51.100.7`, 'cf-connecting-ip': `203.0.113.${i}` }))
  assertEquals(x.size, 1)
})

Deno.test('M-1r/L-13: cold-start log names the header once, never an IP; warns on Turnstile without secret', () => {
  resetColdStart()
  const logs: string[] = [], warns: string[] = []
  logConfigOnce(env({ DIRECTORY_TURNSTILE_ENABLED: 'YES' }), (m) => logs.push(m), (m) => warns.push(m))
  logConfigOnce(env(), (m) => logs.push(m), (m) => warns.push(m))
  assertEquals(logs, ['register-directory-org: client IP source header = cf-connecting-ip'])
  assert(warns.some((w) => w.includes('TURNSTILE_SECRET_KEY is missing')))
  assert(!/\d+\.\d+\.\d+\.\d+/.test(logs.join(' ') + warns.join(' ')))
  resetColdStart()
  const w2: string[] = []
  logConfigOnce(env({ DIRECTORY_CLIENT_IP_HEADER: 'bogus', DIRECTORY_TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 's' }), () => {}, (m) => w2.push(m))
  assertEquals(w2, ['register-directory-org: unknown DIRECTORY_CLIENT_IP_HEADER value; using cf-connecting-ip'])
})

Deno.test('M-1: no IP -> p_ip_hash null (no shared "unknown" bucket)', async () => {
  const calls: Call[] = []
  const req = new Request('http://fn.test', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ ...START, ticket: await oldTicket() }) })
  assertEquals((await handle(req, env(), stub(created, calls))).status, 200)
  assertEquals(calls[0].body.p_ip_hash, null)
})

Deno.test('L-13: Turnstile flag true for true, 1, yes in any case; false otherwise', () => {
  for (const v of ['true', 'TRUE', '1', 'yes', 'Yes', ' YES ']) assertEquals(turnstileEnabled(env({ DIRECTORY_TURNSTILE_ENABLED: v })), true, v)
  for (const v of ['', '0', 'false', 'no', 'on', 'y']) assertEquals(turnstileEnabled(env({ DIRECTORY_TURNSTILE_ENABLED: v })), false, v)
})

// ---------- tickets (L-2) ----------

Deno.test('GET issues a form ticket; Turnstile flag off by default, on with "true"', async () => {
  const r = await handle(new Request('http://fn.test', { headers: { origin: ORIGIN } }), env(), stub(() => ({})))
  const j = await r.json()
  assertEquals(j.turnstile, false)
  assertEquals((await checkFormTicket(SECRET, j.ticket, Date.now() + 5000)).status, 'ok')
  const r2 = await handle(new Request('http://fn.test', { headers: { origin: ORIGIN } }), env({ DIRECTORY_TURNSTILE_ENABLED: 'true' }), stub(() => ({})))
  assertEquals((await r2.json()).turnstile, true)
})

Deno.test('form ticket: too fast, expired, forged; nonce sent to step 1 for single use (L-2)', async () => {
  const now = Date.now()
  const t = await issueFormTicket(SECRET, now)
  assertEquals((await checkFormTicket(SECRET, t, now + 1000)).status, 'too_fast')
  assertEquals((await checkFormTicket(SECRET, t, now + 3 * 3600_000)).status, 'expired')
  assertEquals((await checkFormTicket('y'.repeat(40), t, now + 5000)).status, 'invalid')
  assertEquals((await checkFormTicket(SECRET, t + 'x', now + 5000)).status, 'invalid')
  assertEquals((await checkFormTicket(SECRET, await issueStep2Token(SECRET, RID, now - 10_000), now)).status, 'invalid')
  const ok = await checkFormTicket(SECRET, t, now + 5000)
  assert(ok.status === 'ok')
  const calls: Call[] = []
  const tk = await oldTicket()
  await handle(post({ ...START, ticket: tk }), env(), stub(created, calls))
  assertEquals(calls[0].body.p_ticket_nonce, ((await checkFormTicket(SECRET, tk)) as { nonce: string }).nonce)
  const r = await handle(post({ ...START, ticket: tk }), env(), stub(() => ({ ok: false, reason: 'ticket_used' })))
  assertEquals(r.status, 400)
  assertEquals((await r.json()).reload, true)
})

Deno.test('submitting under the minimum fill time is refused before any DB call', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START, ticket: await issueFormTicket(SECRET) }), env(), stub(() => ({}), calls))
  assertEquals(r.status, 400)
  assertEquals(calls.length, 0)
})

// ---------- M-2: no existence leak ----------

Deno.test('M-2: honeypot, dedupe match and new sign-up get the same created reply and token shape', async () => {
  const replies: Record<string, unknown>[] = []
  const calls: Call[] = []
  // honeypot: no DB call
  replies.push(await (await handle(post({ ...START, ticket: await oldTicket(), company_url: 'http://spam' }), env(), stub(() => ({}), calls))).json())
  assertEquals(calls.length, 0)
  // the DB answers a match and a miss identically ('created' + registration id)
  for (let i = 0; i < 2; i++) replies.push(await (await handle(post({ ...START, ticket: await oldTicket() }), env(), stub(created))).json())
  for (const j of replies) {
    assertEquals(Object.keys(j).sort(), ['ok', 'status', 'token'])
    assertEquals(j.status, 'created')
    assertEquals(tokenShape(j.token as string), 'exp,rid')
    assert(await checkStep2Token(SECRET, j.token))
  }
  assertEquals(new Set(replies.map((j) => (j.token as string).length)).size, 1, 'same token length')
})

Deno.test('M-2: the honeypot decoy token completes step 2 with the same received answer', async () => {
  const j = await (await handle(post({ ...START, ticket: await oldTicket(), company_url: 'x' }), env(), stub(() => ({})))).json()
  const calls: Call[] = []
  const r = await handle(post({ action: 'complete', token: j.token, contact_name: 'Bot' }), env(), stub(() => ({ ok: true, status: 'received' }), calls))
  assertEquals((await r.json()).status, 'received')
  assertEquals(Object.keys(calls[0].body).sort(), ['p_fields', 'p_registration_id'])
})

Deno.test('M-2: step-1 answers are padded to the same minimum time (+ jitter)', async () => {
  const slept: number[] = []
  let t = 0
  const deps = { now: () => t, sleep: async (ms: number) => { slept.push(ms); t += ms }, random: () => 0.5 }
  const e = env({ DIRECTORY_MIN_RESPONSE_MS: '450' })
  await handle(post({ ...START, ticket: await oldTicket(), company_url: 'x' }), e, stub(() => ({})), deps)
  await handle(post({ ...START, ticket: await oldTicket() }), e, stub(created), deps)
  await handle(post({ ...START, ticket: await oldTicket() }), e, stub(() => ({ ok: false, reason: 'rate_limited' })), deps)
  assertEquals(slept, [525, 525, 525])
  // real clock: honeypot (no DB) and a DB answer both take >= the floor
  for (const body of [{ ...START, ticket: await oldTicket(), company_url: 'x' }, { ...START, ticket: await oldTicket() }]) {
    const t0 = performance.now()
    await handle(post(body), env({ DIRECTORY_MIN_RESPONSE_MS: '120' }), stub(created))
    assert(performance.now() - t0 >= 115)
  }
})

Deno.test('step 1 created -> step-2 token bound to rid only; raw IP never sent; no org id exposed', async () => {
  const calls: Call[] = []
  const r = await handle(post({ ...START, ticket: await oldTicket() }), env(), stub(() => ({ ...created(), registration_id: RID }), calls))
  const j = await r.json()
  assertEquals(await checkStep2Token(SECRET, j.token), { rid: RID })
  assertEquals(calls[0].url, 'http://supa.test/rest/v1/rpc/directory_registration_step1')
  assert(!JSON.stringify(calls[0].body).includes('203.0.113.9'))
})

Deno.test('step 1 rate limited -> 429', async () => {
  assertEquals((await handle(post({ ...START, ticket: await oldTicket() }), env(), stub(() => ({ ok: false, reason: 'rate_limited' })))).status, 429)
})

// ---------- validation (M-1 email, L-1, L-3, L-4, L-5) ----------

Deno.test('step 1 validation with friendly labels', async () => {
  assertEquals(parseStep1({ ...START, kind: 'vendor' }), { ok: false, field: 'kind', reason: 'invalid' })
  assertEquals(parseStep1({ ...START, email: 'nope' }), { ok: false, field: 'email', reason: 'invalid' })
  assertEquals(parseStep1({ ...START, state: 'ZZ' }), { ok: false, field: 'state', reason: 'invalid' })
  assertEquals(parseStep1({ ...START, zip: '123' }), { ok: false, field: 'zip', reason: 'invalid' })
  assertEquals(parseStep1({ ...START, name: 'x' }), { ok: false, field: 'name', reason: 'invalid' })
  const ok = parseStep1({ ...START, email: ' PAT@DeltaLaser.com ', state: 'az', zip: '' })
  assert(ok.ok)
  if (ok.ok) assertEquals(ok.value, { name: 'Delta Laser Repair', kind: 'service', email: 'pat@deltalaser.com', state: 'AZ', zip: null })
  const r = await (await handle(post({ ...START, kind: 'vendor', ticket: await oldTicket() }), env(), stub(() => ({})))).json()
  assertEquals(r.error, 'Please check: Company type.')
  assert(!/\bkind\b/.test(r.error))
  assertEquals(fieldError('email', 'too_long'), 'Contact email is too long (254 characters max).')
})

Deno.test('M-1: email folded to NFKC; look-alike letters, <>" and two @ refused', () => {
  const v = parseStep1({ ...START, email: 'ｐａｔ@DeltaLaser.com' })
  assert(v.ok && v.value.email === 'pat@deltalaser.com')
  for (const email of ['pаt@deltalaser.com', '<svg/onload=alert(1)>@xss-mail.co', 'a"b@x.co', 'a@b@x.co', 'pat@déltalaser.com']) {
    assertEquals(parseStep1({ ...START, email }), { ok: false, field: 'email', reason: 'invalid' }, email)
  }
})

Deno.test('L-1: non-Latin names allowed, accents kept, needs a letter or digit in any script', () => {
  for (const name of ['東京レーザー株式会社', 'Médical Ñandú Servicios', 'Лазер Сервис', 'مركز الليزر']) {
    const v = parseStep1({ ...START, name })
    assert(v.ok && v.value.name === name, name)
  }
  assertEquals(parseStep1({ ...START, name: '!!!' }), { ok: false, field: 'name', reason: 'invalid' })
  assertEquals(parseStep1({ ...START, name: '😀😀' }), { ok: false, field: 'name', reason: 'invalid' })
})

Deno.test('L-3: over-long input is rejected with a clear error, never cut', async () => {
  assertEquals(parseStep1({ ...START, name: 'a'.repeat(161) }), { ok: false, field: 'name', reason: 'too_long' })
  assertEquals(parseStep1({ ...START, email: 'a'.repeat(250) + '@x.co' }), { ok: false, field: 'email', reason: 'too_long' })
  assert(parseStep1({ ...START, name: 'a'.repeat(160) }).ok)
  assertEquals(parseStep2({ contact_name: 'Pat', description: 'd'.repeat(1001) }), { ok: false, field: 'description', reason: 'too_long' })
  const calls: Call[] = []
  const r = await handle(post({ ...START, name: 'a'.repeat(500), ticket: await oldTicket() }), env(), stub(created, calls))
  assertEquals(r.status, 400)
  assertEquals((await r.json()).error, 'Company name is too long (160 characters max).')
  assertEquals(calls.length, 0)
})

Deno.test('L-4: emoji counted by code point, never split; lone surrogate is a 400, not a 503', async () => {
  const name = 'a'.repeat(159) + '😀'
  assertEquals(cpLength(name), 160)
  const v = parseStep1({ ...START, name })
  assert(v.ok && v.value.name === name)
  assertEquals(parseStep1({ ...START, name: 'a'.repeat(160) + '😀' }).ok, false)
  const lone = '{"action":"start","name":"Acme \\ud83d Co","kind":"service","email":"a@acme.com","ticket":' + JSON.stringify(await oldTicket()) + '}'
  const r = await handle(post(lone), env(), stub(created))
  assertEquals(r.status, 400)
})

Deno.test('L-5: bidi/RTL overrides stripped; markup kept as inert text for escaping later', () => {
  const v = parseStep1({ ...START, name: 'Evil\u202Egnp.exe\u2066x\u2069\u200F Co <script>alert(1)</script>' })
  assert(v.ok)
  if (v.ok) assertEquals(v.value.name, 'Evilgnp.exex Co <script>alert(1)</script>')
  const s2 = parseStep2({ contact_name: 'Pat\u202D Lee', city: 'Me\u202Bsa' })
  assert(s2.ok && s2.fields.contact_name === 'Pat Lee' && s2.fields.city === 'Mesa')
})

Deno.test('L-5: other phone validated like phone', () => {
  assertEquals(parseStep2({ contact_name: 'Pat', alt_phone: 'call me maybe' }), { ok: false, field: 'alt_phone', reason: 'invalid' })
  assertEquals(parseStep2({ contact_name: 'Pat', phone: '1234567<script>' }), { ok: false, field: 'phone', reason: 'invalid' })
  assertEquals(parseStep2({ contact_name: 'Pat', phone: '12' }), { ok: false, field: 'phone', reason: 'invalid' })
  const ok = parseStep2({ contact_name: 'Pat', phone: '(602) 555-0123', alt_phone: '+1 602.555.0199 ext 12' })
  assert(ok.ok)
})

// ---------- Turnstile (fails closed) ----------

Deno.test('Turnstile on: no token, failed check, HTTP error, network error, bad JSON and missing secret all refuse before the DB', async () => {
  const on = env({ DIRECTORY_TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: TS_FAIL_SECRET })
  for (const [reply, token] of [[{ success: false }, TS_DUMMY_TOKEN], [{ success: true }, undefined], [{ status: 500, success: true }, TS_DUMMY_TOKEN],
    ['throw', TS_DUMMY_TOKEN], ['not json', TS_DUMMY_TOKEN], [{ success: 'true' }, TS_DUMMY_TOKEN]] as const) {
    const calls: Call[] = []
    const r = await handle(post({ ...START, ticket: await oldTicket(), turnstile: token }), on, stub((n) => (n === 'turnstile' ? reply : created()), calls))
    assertEquals(r.status, 400, JSON.stringify(reply))
    assertEquals((await r.json()).turnstile, true)
    assert(!calls.some((c) => c.url.includes('/rpc/')))
  }
  const calls: Call[] = []
  const noSecret = await handle(post({ ...START, ticket: await oldTicket(), turnstile: TS_DUMMY_TOKEN }), env({ DIRECTORY_TURNSTILE_ENABLED: '1' }), stub(() => ({ success: true }), calls))
  assertEquals(noSecret.status, 400, 'flag on without a secret fails closed')
  assertEquals(calls.length, 0)
})

Deno.test('Turnstile on: a passing check proceeds; secret, token and rightmost IP are sent; off by default skips it', async () => {
  const calls: Call[] = []
  const on = env({ DIRECTORY_TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: TS_PASS_SECRET })
  const r = await handle(post({ ...START, ticket: await oldTicket(), turnstile: TS_DUMMY_TOKEN }, ORIGIN, { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' }), on,
    stub((n) => (n === 'turnstile' ? { success: true } : created()), calls))
  assertEquals(r.status, 200)
  assertEquals(calls[0].body, { secret: TS_PASS_SECRET, response: TS_DUMMY_TOKEN, remoteip: '198.51.100.7' })
  const calls2: Call[] = []
  await handle(post({ ...START, ticket: await oldTicket() }), env(), stub(created, calls2))
  assert(!calls2.some((c) => c.url.includes('cloudflare')))
})

Deno.test({ name: 'Turnstile live: Cloudflare test keys (always-pass passes, always-fail refuses)', ignore: Deno.env.get('MRN_TURNSTILE_LIVE') !== '1', fn: async () => {
  for (const [secret, want] of [[TS_PASS_SECRET, 200], [TS_FAIL_SECRET, 400]] as const) {
    const live = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('https://challenges.cloudflare.com') ? fetch(input, init) : new Response(JSON.stringify(created()))) as typeof fetch
    const r = await handle(post({ ...START, ticket: await oldTicket(), turnstile: TS_DUMMY_TOKEN }),
      env({ DIRECTORY_TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: secret }), live)
    assertEquals(r.status, want, secret)
  }
}})

// ---------- step 2 ----------

Deno.test('step 2: forged, expired or tampered token never reaches the DB', async () => {
  const calls: Call[] = []
  const fx = stub(() => ({ ok: true }), calls)
  const good = await issueStep2Token(SECRET, RID)
  const [body, sig] = good.split('.')
  const tampered = btoa(JSON.stringify({ rid: crypto.randomUUID(), exp: 9e9 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.' + sig
  const expired = await issueStep2Token(SECRET, RID, Date.now() - 2 * 3600_000)
  const other = await issueStep2Token('z'.repeat(40), RID)
  for (const token of [tampered, expired, other, body, 'garbage', undefined]) {
    assertEquals((await handle(post({ action: 'complete', token, contact_name: 'Pat' }), env(), fx)).status, 400)
  }
  assertEquals(calls.length, 0)
  assertEquals(await checkStep2Token(SECRET, await issueFormTicket(SECRET)), null)
  assertEquals(parseStep2({ contact_name: 'Pat', website: 'not a url' }), { ok: false, field: 'website', reason: 'invalid' })
  const ok = parseStep2({ contact_name: 'Pat', website: 'deltalaser.com', years_in_business: '12', num_techs: 'many', coverage: ['AZ', 'NM'] })
  assert(ok.ok)
  if (ok.ok) {
    assertEquals(ok.fields.website, 'https://deltalaser.com')
    assertEquals('num_techs' in ok.fields, false)
  }
})

Deno.test('step 2: only rid + allow-listed fields go to the DB', async () => {
  const calls: Call[] = []
  const token = await issueStep2Token(SECRET, RID)
  const r = await handle(post({ action: 'complete', token, contact_name: 'Pat Lee', organization_id: 1, p_organization_id: 1,
    type: 'customer', list_in_directory: true, is_premium: true, brands: 'Candela, Cutera, candela' }), env(),
    stub(() => ({ ok: true, status: 'received' }), calls))
  assertEquals(r.status, 200)
  assertEquals(calls[0].body.p_registration_id, RID)
  assertEquals('p_organization_id' in calls[0].body, false)
  assertEquals(calls[0].body.p_fields.brands, ['Candela', 'Cutera'])
  for (const k of ['type', 'list_in_directory', 'is_premium', 'organization_id']) assertEquals(k in calls[0].body.p_fields, false)
})

Deno.test('step 2: DB refusal (used/expired) -> 400 restart', async () => {
  const token = await issueStep2Token(SECRET, RID)
  const r = await handle(post({ action: 'complete', token, contact_name: 'Pat Lee' }), env(), stub(() => ({ ok: false, reason: 'expired' })))
  assertEquals(r.status, 400)
  assertEquals((await r.json()).restart, true)
})

Deno.test('L-12: replaying a honeypot decoy token gets exactly what a real replay gets', async () => {
  const replay = { ok: false, reason: 'expired' }
  const decoy = (await (await handle(post({ ...START, ticket: await oldTicket(), company_url: 'x' }), env(), stub(() => ({})))).json()).token
  const real = await issueStep2Token(SECRET, RID)
  const out: [number, string][] = []
  for (const token of [decoy, real]) {
    const r = await handle(post({ action: 'complete', token, contact_name: 'Pat Lee' }), env(), stub(() => replay))
    out.push([r.status, await r.text()])
  }
  assertEquals(out[0], out[1])
  assertEquals(out[0][0], 400)
})

Deno.test('L-11: notice inbox blocked on the email key (Larry variants) and DIRECTORY_BLOCKED_RECIPIENTS', () => {
  for (const v of ['larrysmart@gmail.com', 'Larry.Smart@gmail.com', 'larry.smart+mrn@googlemail.com', 'ｌａｒｒｙ.smart@gmail.com']) {
    assertEquals(reviewInbox(env({ DIRECTORY_REVIEW_INBOX: v })), null, v)
  }
  assertEquals(reviewInbox(env({ DIRECTORY_REVIEW_INBOX: 'ops+mrn@corp.test', DIRECTORY_BLOCKED_RECIPIENTS: 'x@y.test, OPS@corp.test' })), null)
  assertEquals(reviewInbox(env({ DIRECTORY_REVIEW_INBOX: 'FieldserviceTotalService@gmail.com' })), 'fieldservicetotalservice@gmail.com')
  assertEquals(emailKey('A.B+x@GoogleMail.com'), 'ab@gmail.com')
  assertEquals(isBlockedRecipient('larry.smart@example.com', env()), false)
})

// ---------- review notice ----------

Deno.test('notice: sent once on step-2 completion, escaped, bidi stripped, fixed subject, unverified, held-back count', async () => {
  const calls: Call[] = []
  const NOTICE = { ok: true, company: '<b>Evil & Co</b>\u202Egnp', org_type: 'laser_clinic', contact_name: 'Pat "x" <script>alert(1)</script>', email: 'pat@evil.test', city: 'Mesa', state: 'AZ', status: 'possible_duplicate', held_back: 3 }
  const e = env({ RESEND_API_KEY: 're_x', DIRECTORY_REVIEW_INBOX: 'Review@Example.test' })
  let taken = 0
  const fx = stub((name) => {
    if (name === 'directory_registration_step2') return { ok: true, status: 'received' }
    if (name === 'directory_registration_take_notice') return taken++ === 0 ? NOTICE : { ok: false }
    return undefined
  }, calls)
  const token = await issueStep2Token(SECRET, RID)
  assertEquals((await handle(post({ action: 'complete', token, contact_name: 'Pat Lee' }), e, fx)).status, 200)
  const mails = calls.filter((c) => c.url.startsWith('https://api.resend.com'))
  assertEquals(mails.length, 1)
  const m = mails[0].body
  assertEquals(m.to, ['review@example.test'])
  assertEquals(m.subject, REVIEW_NOTICE_SUBJECT)
  assert(m.html.includes('&lt;b&gt;Evil &amp; Co&lt;/b&gt;gnp'))
  assert(m.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert(!m.html.includes('<script>') && !m.html.includes('<b>Evil'))
  assert(!m.html.includes('\u202E') && !m.text.includes('\u202E'))
  assert(m.html.includes('not been verified') && m.text.includes('(not verified)'))
  assert(m.html.includes('3 more sign-ups'))
  assert(m.html.includes('possible duplicate'))
  await handle(post({ action: 'complete', token, contact_name: 'Pat Lee' }), e, fx)
  assertEquals(calls.filter((c) => c.url.startsWith('https://api.resend.com')).length, 1)
})

Deno.test('notice: no inbox / no key / Larry inbox / capped -> nothing sent; send failure never blocks', async () => {
  const token = await issueStep2Token(SECRET, RID)
  for (const extra of <Record<string, string>[]>[{ RESEND_API_KEY: 're_x' }, { DIRECTORY_REVIEW_INBOX: 'r@x.test' }, { RESEND_API_KEY: 're_x', DIRECTORY_REVIEW_INBOX: 'LarrySmart@gmail.com' }]) {
    const calls: Call[] = []
    const r = await handle(post({ action: 'complete', token, contact_name: 'Pat Lee' }), env(extra),
      stub((n) => (n === 'directory_registration_step2' ? { ok: true, status: 'received' } : { ok: true, company: 'X' }), calls))
    assertEquals(r.status, 200)
    assertEquals(calls.some((c) => c.url.startsWith('https://api.resend.com') || c.url.endsWith('take_notice')), false)
  }
  const calls: Call[] = []
  await handle(post({ action: 'complete', token, contact_name: 'Pat Lee' }), env({ RESEND_API_KEY: 're_x', DIRECTORY_REVIEW_INBOX: 'r@x.test' }),
    stub((n) => (n === 'directory_registration_step2' ? { ok: true, status: 'received' } : { ok: false, reason: 'capped' }), calls))
  assertEquals(calls.some((c) => c.url.startsWith('https://api.resend.com')), false, 'capped notice sends nothing')
  for (const failure of ['throw', { status: 500 }]) {
    const r = await handle(post({ action: 'complete', token, contact_name: 'Pat Lee' }), env({ RESEND_API_KEY: 're_x', DIRECTORY_REVIEW_INBOX: 'r@x.test' }),
      stub((n) => (n === 'directory_registration_step2' ? { ok: true, status: 'received' } : n === 'resend' ? failure : { ok: true, company: 'X' })))
    assertEquals(r.status, 200)
  }
  assertEquals(reviewInbox(env({ DIRECTORY_REVIEW_INBOX: 'not-an-email' })), null)
  assertEquals(buildReviewNotice({ company: 'A' }, 'javascript:alert(1)').html.includes('javascript:'), false)
})

Deno.test('bad JSON, oversize body (declared and actual), unknown action, DB down', async () => {
  assertEquals((await handle(post('{not json'), env(), stub(() => ({})))).status, 400)
  assertEquals((await handle(post('x'.repeat(20_000)), env(), stub(() => ({})))).status, 413)
  assertEquals((await handle(post('{}', ORIGIN, { 'content-length': '10000000' }), env(), stub(() => ({})))).status, 413)
  assertEquals((await handle(post({ action: 'delete' }), env(), stub(() => ({})))).status, 400)
  const down = (async () => new Response('boom', { status: 500 })) as typeof fetch
  assertEquals((await handle(post({ ...START, ticket: await oldTicket() }), env(), down)).status, 503)
})

// ---------- end-to-end against local PG17 ----------
const DB = Deno.env.get('MRN_PG_DB')

function pgFetch(db: string) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const name = String(input).split('/rpc/')[1]
    const a = JSON.parse(String(init?.body))
    const lit = (v: unknown) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
    const sql = name === 'directory_registration_step1'
      ? `select public.directory_registration_step1(${lit(a.p_name)},${lit(a.p_kind)},${lit(a.p_email)},${lit(a.p_state)},${lit(a.p_zip)},${lit(a.p_ip_hash)},${lit(a.p_ticket_nonce)}::uuid)`
      : `select public.directory_registration_step2(${lit(a.p_registration_id)}::uuid,${lit(JSON.stringify(a.p_fields))}::jsonb)`
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

Deno.test({ name: 'e2e: start + complete creates one pending unlisted org; token and ticket are single use', ignore: !DB, fn: async () => {
  await q(DB!, "delete from directory_registration_attempts where key_kind='global'")
  const fx = pgFetch(DB!)
  const name = `E2E Co ${crypto.randomUUID().slice(0, 8)}`
  const ticket = await oldTicket()
  const r1 = await handle(post({ ...START, name, email: `a@${name.slice(7)}.example`, ticket }, ORIGIN, { 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200)}` }), env(), fx)
  const j1 = await r1.json()
  assertEquals(j1.status, 'created')
  const again = await handle(post({ ...START, name: name + ' 2', email: `b@${name.slice(7)}.example`, ticket }), env(), fx)
  assertEquals(again.status, 400, 'same ticket twice')
  const r2 = await handle(post({ action: 'complete', token: j1.token, contact_name: 'Pat', website: 'e2e.example', brands: ['Candela'] }), env(), fx)
  assertEquals((await r2.json()).status, 'received')
  assertEquals(await q(DB!, `select type||'|'||is_active||'|'||list_in_directory||'|'||website||'|'||supported_brands::text from organizations where name='${name}'`),
    'service_company|false|false|https://e2e.example|{Candela}')
  assertEquals((await handle(post({ action: 'complete', token: j1.token, contact_name: 'Again' }), env(), fx)).status, 400)
}})

Deno.test({ name: 'e2e M-2: known company -> same created reply, no org; step 2 saved for review only', ignore: !DB, fn: async () => {
  const fx = pgFetch(DB!)
  const before = await q(DB!, 'select count(*) from organizations')
  const email = `zz${crypto.randomUUID().slice(0, 6)}@acmelaser.com`
  const r = await handle(post({ ...START, name: 'Acme Laser Service', email, ticket: await oldTicket() }, ORIGIN, { 'cf-connecting-ip': '192.0.2.77' }), env(), fx)
  const j = await r.json()
  assertEquals(Object.keys(j).sort(), ['ok', 'status', 'token'])
  assertEquals(j.status, 'created')
  assertEquals(await q(DB!, 'select count(*) from organizations'), before)
  const r2 = await handle(post({ action: 'complete', token: j.token, contact_name: 'Mallory', phone: '602-555-0000' }), env(), fx)
  assertEquals((await r2.json()).status, 'received')
  assertEquals(await q(DB!, `select details->>'contact_name' from directory_registrations where email_norm='${email}'`), 'Mallory')
  assertEquals(await q(DB!, 'select coalesce(contact_name,\'-\') from organizations where id=1'), '-')
}})
