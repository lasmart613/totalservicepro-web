/**
 * End-to-end proof for the grok-tts Repair AI gate (not part of npm test;
 * needs Deno). Boots the real supabase/functions/grok-tts/index.ts with fetch
 * stubbed: Supabase auth/REST answer from the fixture below and x.ai TTS calls
 * return canned audio. Nothing leaves the machine.
 *
 *   deno run -A supabase/tests/grok-tts-access-harness.ts
 *
 * Prints one line per case and exits 1 on any mismatch.
 */
const SUPA = 'http://supabase.test'
const PORT = 54340
Deno.env.set('SUPABASE_URL', SUPA)
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('XAI_API_KEY', 'xai-test')

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {
  user_profiles: [
    { id: 'tech', organization_id: 10 },
    { id: 'clinic', organization_id: 20 },
    { id: 'supplier', organization_id: 30 },
    { id: 'noorg', organization_id: null },
    { id: 'removed', organization_id: 10 },
    { id: 'svcowner', organization_id: 10 },
  ],
  organization_memberships: [
    { user_id: 'tech', organization_id: 10, role: 'fse' },
    { user_id: 'clinic', organization_id: 20, role: 'owner' },
    { user_id: 'supplier', organization_id: 30, role: 'parts_supplier' },
    { user_id: 'svcowner', organization_id: 10, role: 'owner' },
  ],
  organizations: [
    { id: 10, type: 'service_company' },
    { id: 20, type: 'customer' },
    { id: 30, type: 'parts_supplier' },
  ],
  subscriptions: [],
  api_usage: [],
}
const tokens: Record<string, string> = { 'tok-tech': 'tech', 'tok-clinic': 'clinic', 'tok-supplier': 'supplier', 'tok-noorg': 'noorg', 'tok-removed': 'removed', 'tok-svcowner': 'svcowner' }
const reads: string[] = []
let xaiCalls = 0

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function rest(url: URL, init: RequestInit | undefined, headers: Headers) {
  const table = url.pathname.replace('/rest/v1/', '')
  const method = (init?.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return json([], 201)
  reads.push(table)
  let rows = [...(tables[table] || [])]
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue
    if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3))
  }
  const limit = Number(url.searchParams.get('limit') || 0)
  if (limit) rows = rows.slice(0, limit)
  if ((headers.get('Accept') || '').includes('vnd.pgrst.object')) {
    if (rows.length === 1) return json(rows[0])
    return json({ code: 'PGRST116', message: 'no rows' }, 406)
  }
  return json(rows)
}

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : null
  const url = new URL(req ? req.url : String(input))
  const headers = new Headers(init?.headers || req?.headers)
  if (url.hostname === '127.0.0.1') return realFetch(input as any, init)
  if (url.origin === SUPA) {
    if (url.pathname === '/auth/v1/user') {
      const uid = tokens[(headers.get('Authorization') || '').replace('Bearer ', '')]
      return uid ? json({ id: uid, aud: 'authenticated', email: `${uid}@example.test` }) : json({ msg: 'bad jwt' }, 401)
    }
    if (url.pathname.startsWith('/rest/v1/')) return rest(url, init, headers)
    return json({ error: 'not found' }, 404)
  }
  if (url.hostname.endsWith('x.ai')) {
    xaiCalls++
    if (url.pathname.endsWith('/voices')) return json({ voices: [{ voice_id: 'eve', name: 'Eve' }] })
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
  }
  return json({ error: `unexpected ${url}` }, 599)
}) as typeof fetch

const origListen = Deno.listen
;(Deno as any).listen = (opts: Deno.ListenOptions) => origListen({ ...opts, port: PORT })
await import('../functions/grok-tts/index.ts')
await new Promise((r) => setTimeout(r, 300))

let failed = 0
async function expectCase(name: string, token: string, method: 'GET' | 'POST', status: number, error?: string) {
  reads.length = 0
  const before = xaiCalls
  const res = await realFetch(`http://127.0.0.1:${PORT}/`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ text: 'Torque the lamp housing to 4 Nm.' }) } : {}),
  })
  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { /* audio */ }
  const usageRead = reads.includes('api_usage')
  const denied = status !== 200
  const ok = res.status === status && (!error || data?.error === error) && (!denied || (xaiCalls === before && !usageRead))
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${res.status} ${data?.error ?? '(audio/ok)'} xai=${xaiCalls - before} usageRead=${usageRead}`)
}

await expectCase('service-company fse speaks', 'tok-tech', 'POST', 200)
await expectCase('service-company fse lists voices', 'tok-tech', 'GET', 200)
await expectCase('clinic owner (customer org) denied', 'tok-clinic', 'POST', 403, 'repair_ai_forbidden')
await expectCase('clinic owner voice list denied', 'tok-clinic', 'GET', 403, 'repair_ai_forbidden')
await expectCase('parts supplier denied', 'tok-supplier', 'POST', 403, 'repair_ai_forbidden')
await expectCase('no org denied', 'tok-noorg', 'POST', 403, 'repair_ai_forbidden')
await expectCase('removed member (profile org kept, membership gone) denied', 'tok-removed', 'POST', 403, 'repair_ai_forbidden')
// Same as web/lib/roles.ts canAccessRepairAi: role 'owner' is owner-side even in a service org.
await expectCase('service-company member with role owner denied (matches web)', 'tok-svcowner', 'POST', 403, 'repair_ai_forbidden')
await expectCase('bad token still 401', 'tok-nobody', 'POST', 401)
await expectCase('missing Authorization header 401', '', 'POST', 401)

console.log(failed ? `${failed} FAILED` : 'ALL PASS')
Deno.exit(failed ? 1 : 0)
