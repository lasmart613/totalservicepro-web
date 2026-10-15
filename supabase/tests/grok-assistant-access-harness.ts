/**
 * End-to-end proof for the grok-assistant Repair AI gate (not part of npm test;
 * needs Deno). Boots the real supabase/functions/grok-assistant/index.ts with
 * fetch stubbed: Supabase auth/REST/storage answer from the fixture below and
 * every x.ai call returns a canned reply. Nothing leaves the machine.
 *
 *   deno run -A supabase/tests/grok-assistant-access-harness.ts
 *
 * Prints one line per case and exits 1 on any mismatch.
 */
const SUPA = 'http://supabase.test'
const PORT = 54339
Deno.env.set('SUPABASE_URL', SUPA)
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
Deno.env.set('XAI_API_KEY', 'xai-test')

type Row = Record<string, unknown>
const SHARED = 'shared/Candela/GentleMAX Pro/GentleMAX Pro Service Manual.pdf'
const PRIVATE_20 = 'orgs/20/private/Clinic Notes.pdf'
const UNPUBLISHED = 'shared/quanta-system/litho-evo/DGM001435.pdf'
const tables: Record<string, Row[]> = {
  user_profiles: [
    { id: 'tech', organization_id: 10, role: 'fse' },
    { id: 'clinic', organization_id: 20, role: 'owner' },
    { id: 'supplier', organization_id: 30, role: 'parts_supplier' },
    { id: 'noorg', organization_id: null, role: 'fse' },
    { id: 'svcowner', organization_id: 10, role: 'owner' },
  ],
  organization_memberships: [
    { user_id: 'tech', organization_id: 10, role: 'fse' },
    { user_id: 'clinic', organization_id: 20, role: 'owner' },
    { user_id: 'supplier', organization_id: 30, role: 'parts_supplier' },
    { user_id: 'svcowner', organization_id: 10, role: 'owner' },
  ],
  organizations: [
    { id: 10, type: 'service_company', is_premium: true, subscription_tier: 'premium', plan: 'premium' },
    { id: 20, type: 'customer' },
    { id: 30, type: 'parts_supplier' },
  ],
  organization_manuals: [{ organization_id: 20, manual_id: 2001, manuals: { id: 2001, storage_path: PRIVATE_20 } }],
  user_manuals: [],
  subscriptions: [],
  api_usage: [],
  manuals: [
    { id: 1086, title: 'GentleMAX Pro Service Manual', brand: 'Candela', model: 'GentleMAX Pro', storage_path: SHARED, published: true, is_folder: false },
    { id: 2001, title: 'Clinic Notes', brand: 'Candela', model: 'GentleMAX Pro', storage_path: PRIVATE_20, published: true, is_folder: false },
    { id: 764, title: 'Litho EVO', brand: 'Quanta System', model: 'Litho EVO', storage_path: UNPUBLISHED, published: false, is_folder: false },
  ],
  manual_search_index: [
    { manual_id: 1086, chunk_index: 0, search_text: '[[page 12]] Lamp housing torque 4 Nm. Fault 1020 means handpiece temperature.' },
    { manual_id: 2001, chunk_index: 0, search_text: '[[page 1]] PRIVATE CLINIC TEXT' },
  ],
}
const tokens: Record<string, string> = { 'tok-tech': 'tech', 'tok-clinic': 'clinic', 'tok-supplier': 'supplier', 'tok-noorg': 'noorg', 'tok-svcowner': 'svcowner' }
const reads: string[] = []
let modelCalls = 0
let lastSystem = ''

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
    else if (v.startsWith('in.(')) {
      const set = v.slice(4, -1).split(',').map((s) => s.replace(/"/g, ''))
      rows = rows.filter((r) => set.includes(String(r[k])))
    }
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
    if (url.pathname.endsWith('/chat/completions')) {
      modelCalls++
      const body = JSON.parse(String(init?.body || '{}'))
      lastSystem = String(body.messages?.[0]?.content || '')
      const asked = JSON.stringify(body.messages?.slice(-1) || '')
      if (/Bluetooth/.test(asked)) {
        return json({ choices: [{ message: { role: 'assistant', content:
          'The retrieved passages from the GentleMAX Pro Service Manual contain no Bluetooth pairing PIN.\n\n' +
          '— Source: Candela GentleMAX Pro, p. 12, §8.2\n[[cite:id=1086&p=12&s=8.2&t=GentleMAX]]' } }] })
      }
      return json({ choices: [{ message: { role: 'assistant', content: 'Torque the lamp housing to 4 Nm (page 12).' } }] })
    }
    if (url.pathname.endsWith('/documents/search')) return json({ matches: [] })
    if (url.pathname.endsWith('/responses')) return json({ output: [], output_text: '' })
    return json({ documents: [], data: [] })
  }
  return json({ error: `unexpected ${url}` }, 599)
}) as typeof fetch

const origListen = Deno.listen
;(Deno as any).listen = (opts: Deno.ListenOptions) => origListen({ ...opts, port: PORT })
await import('../functions/grok-assistant/index.ts')
await new Promise((r) => setTimeout(r, 300))

async function call(token: string, body: Record<string, unknown>) {
  const res = await realFetch(`http://127.0.0.1:${PORT}/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = text
  try { data = JSON.parse(text) } catch { /* audio or text */ }
  return { status: res.status, data }
}

const chat = (manualId?: number) => ({
  action: 'chat',
  messages: [{ role: 'user', content: 'What torque for the lamp housing?' }],
  ...(manualId ? { manualId } : {}),
})

let failed = 0
async function expectCase(name: string, token: string, body: Record<string, unknown>, status: number, check?: (d: any) => boolean) {
  reads.length = 0
  const before = modelCalls
  const r = await call(token, body)
  const indexRead = reads.includes('manual_search_index')
  const ok = r.status === status && (!check || check(r.data))
  if (!ok) failed++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name}: ${r.status} ${r.status === 200 ? '' : JSON.stringify(r.data)}` +
      ` model_calls=${modelCalls - before} index_read=${indexRead}`
  )
  return { r, indexRead, model: modelCalls - before }
}

await expectCase('clinic owner, shared manual', 'tok-clinic', chat(1086), 403, (d) => d.error === 'repair_ai_forbidden')
await expectCase('clinic owner, own clinic manual', 'tok-clinic', chat(2001), 403)
await expectCase('clinic owner, usage', 'tok-clinic', { action: 'usage' }, 403)
await expectCase('parts supplier', 'tok-supplier', chat(1086), 403, (d) => d.error === 'repair_ai_forbidden')
await expectCase('no-org caller (profile role fse)', 'tok-noorg', chat(1086), 403, (d) => d.error === 'repair_ai_forbidden')
await expectCase('no-org caller, tts', 'tok-noorg', { action: 'tts', text: 'hi' }, 403)
const denied = await expectCase(
  'service member, another org private manual',
  'tok-tech',
  chat(2001),
  403,
  (d) => d.error === 'manual_not_accessible'
)
if (denied.indexRead || denied.model) { failed++; console.log('FAIL private manual: index or model was reached') }
const ok = await expectCase('service member, shared catalog manual', 'tok-tech', chat(1086), 200, (d) =>
  /4 Nm/.test(d.choices?.[0]?.message?.content || '')
)
if (!ok.indexRead || !/Lamp housing torque 4 Nm/.test(lastSystem)) { failed++; console.log('FAIL shared manual: index text not in prompt') }
await expectCase('service member, unscoped question', 'tok-tech', chat(), 200)
await expectCase('service-company owner, shared manual', 'tok-svcowner', chat(1086), 200)
// QA lows (d): no silent unscoped run for these.
for (const [name, body] of [
  ['unpublished manual id', { ...chat(764), manualPath: UNPUBLISHED }],
  ['unpublished manual id only', chat(764)],
  ['non-shared path, no id', { ...chat(), manualPath: 'org/2655/uploads/manual.pdf' }],
] as Array<[string, Record<string, unknown>]>) {
  const r = await expectCase(`service member, ${name}`, 'tok-tech', body, 403, (d) => d.error === 'manual_not_accessible')
  if (r.indexRead || r.model) { failed++; console.log(`FAIL ${name}: index or model was reached`) }
}
await expectCase('service member, shared path with no id still answers', 'tok-tech', { ...chat(), manualPath: SHARED }, 200)
// QA lows (b): a refusal attaches no chip.
await expectCase(
  'service member, refusal carries no chip',
  'tok-tech',
  { ...chat(1086), messages: [{ role: 'user', content: 'What is the Bluetooth pairing PIN?' }] },
  200,
  (d) => {
    const c = d.choices?.[0]?.message?.content || ''
    return /contain no Bluetooth/.test(c) && !/\[\[cite:/.test(c) && !/Source:/.test(c) && !(d._meta?.citations || []).length
  }
)
await expectCase('service member, usage uses company Premium cap', 'tok-tech', { action: 'usage' }, 200, (d) =>
  d.text?.limit === 50 && d.tier === 'premium'
)
await expectCase('bad token', 'tok-nope', chat(1086), 401)

console.log(failed ? `${failed} FAILED` : 'all ok')
Deno.exit(failed ? 1 : 0)
