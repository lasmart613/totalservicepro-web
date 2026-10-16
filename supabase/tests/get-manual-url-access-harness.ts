/**
 * End-to-end proof for get-manual-url's AI catalog gate (not part of npm test;
 * needs Deno). Boots the real supabase/functions/get-manual-url/index.ts with
 * fetch stubbed: Supabase auth/REST/storage answer from the fixture below.
 * Nothing leaves the machine.
 *
 *   deno run -A supabase/tests/get-manual-url-access-harness.ts
 *
 * The caller comes from the membership-checked loadAiCaller: a removed owner
 * whose user_profiles row still says role owner/company_admin and org 10 is
 * refused. Prints one line per case and exits 1 on any mismatch.
 */
const SUPA = 'http://supabase.test'
Deno.env.set('SUPABASE_URL', SUPA)
Deno.env.set('SUPABASE_ANON_KEY', 'anon')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')

type Row = Record<string, unknown>
const SHARED = 'shared/Candela/GentleMAX Pro/GentleMAX Pro Service Manual.pdf'
const tables: Record<string, Row[]> = {
  user_profiles: [
    { id: 'tech', organization_id: 10, role: 'fse' },
    { id: 'svcowner', organization_id: 10, role: 'owner' },
    // Removed from org 10: profile still points there and still says owner / company_admin.
    { id: 'removedowner', organization_id: 10, role: 'owner' },
    { id: 'removedadmin', organization_id: 10, role: 'company_admin' },
    { id: 'clinic', organization_id: 20, role: 'owner' },
    { id: 'noorg', organization_id: null, role: 'fse' },
  ],
  organization_memberships: [
    { user_id: 'tech', organization_id: 10, role: 'fse' },
    { user_id: 'svcowner', organization_id: 10, role: 'owner' },
    { user_id: 'clinic', organization_id: 20, role: 'owner' },
  ],
  organizations: [
    { id: 10, type: 'service_company' },
    { id: 20, type: 'customer' },
  ],
  manuals: [
    { id: 1086, title: 'GentleMAX Pro Service Manual', storage_path: SHARED, published: true, is_folder: false },
  ],
  organization_manuals: [],
  user_manuals: [],
}
const tokens: Record<string, string> = Object.fromEntries(
  ['tech', 'svcowner', 'removedowner', 'removedadmin', 'clinic', 'noorg'].map((u) => [`tok-${u}`, u]),
)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function rest(url: URL, init: RequestInit | undefined, headers: Headers) {
  const table = url.pathname.replace('/rest/v1/', '')
  const method = (init?.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return json([], 201)
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
    if (rows.length === 0 && method === 'GET') return json({ code: 'PGRST116', message: 'no rows' }, 406)
    return json({ code: 'PGRST116', message: 'no rows' }, 406)
  }
  return json(rows)
}

const unexpected: string[] = []
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : null
  const url = new URL(req ? req.url : String(input))
  const headers = new Headers(init?.headers || req?.headers)
  const merged = req && !init ? { method: req.method } : init
  if (url.origin === SUPA) {
    if (url.pathname === '/auth/v1/user') {
      const uid = tokens[(headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')]
      return uid ? json({ id: uid, aud: 'authenticated', email: `${uid}@example.test` }) : json({ msg: 'bad jwt' }, 401)
    }
    if (url.pathname.startsWith('/rest/v1/')) return rest(url, merged, headers)
    if (url.pathname.startsWith('/storage/v1/object/info/')) return json({ name: 'x.pdf', size: 1234 })
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      return json({ signedURL: `/storage/v1/object/sign/manuals/x.pdf?token=t` })
    }
    if (url.pathname.startsWith('/storage/v1/object/list/')) {
      return json([{ name: SHARED.split('/').pop(), id: 'obj', metadata: { size: 1234 } }])
    }
  }
  unexpected.push(`${(merged?.method || 'GET')} ${url}`)
  return json({ error: `unexpected ${url}` }, 599)
}) as typeof fetch

let handler: ((req: Request) => Response | Promise<Response>) | null = null
;(Deno as any).serve = (h: any) => {
  handler = typeof h === 'function' ? h : h.handler
  return { finished: Promise.resolve(), shutdown: async () => {} }
}
await import('../functions/get-manual-url/index.ts')
if (!handler) throw new Error('get-manual-url did not register a handler')

let failed = 0
async function expectCase(name: string, user: string, body: Record<string, unknown>, status: number, check?: (d: any) => boolean) {
  const res = await handler!(new Request('http://fn.test/get-manual-url', {
    method: 'POST',
    headers: { Authorization: 'Bearer anon', 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: `tok-${user}`, ...body }),
  }))
  const data = await res.json().catch(() => null)
  const ok = res.status === status && (!check || check(data))
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${res.status} ${data?.error ?? data?.source ?? ''}`)
}

const cite = { manual_id: 1086, ai_context: true }
await expectCase('service-company fse opens shared PDF from an AI cite', 'tech', cite, 200, (d) => /sign/.test(String(d?.url || '')))
await expectCase('service-company owner opens shared PDF from an AI cite', 'svcowner', cite, 200)
await expectCase('removed owner (profile still owner/org 10) refused', 'removedowner', cite, 403, (d) => d?.organization_id == null)
await expectCase('removed company_admin (profile still company_admin/org 10) refused', 'removedadmin', cite, 403)
await expectCase('clinic owner refused', 'clinic', cite, 403)
await expectCase('no-org caller refused', 'noorg', cite, 403)
await expectCase('service member without ai_context still needs the library', 'tech', { manual_id: 1086 }, 403, (d) => d?.requires_add === true)
await expectCase('bad token 401', 'nobody', cite, 401)

if (unexpected.length) console.log('unexpected fetches:', unexpected.slice(0, 5))
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
Deno.exit(failed ? 1 : 0)
