// Deno tests for the shared atomic AI cap (000927) and its use in grok-tts
// and grok-assistant. Run: deno test -A supabase/tests
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { finalizeUsage, releaseUsage, reserveUsage } from '../functions/_shared/usage-cap.ts'

function fakeDb(fail?: 'error' | 'throw' | 'garbage') {
  const rows: Array<{ id: string; user_id: string; type: string; tokens: number }> = []
  let n = 0
  let chain: Promise<unknown> = Promise.resolve()
  return {
    rows,
    rpc(fn: string, a: Record<string, any>) {
      if (fail === 'throw') throw new Error('down')
      if (fail === 'error') return Promise.resolve({ data: null, error: { message: 'boom' } })
      if (fail === 'garbage') return Promise.resolve({ data: 42, error: null })
      const run = chain.then(async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 3))
        if (fn === 'ai_usage_reserve') {
          const used = rows.filter((r) => r.user_id === a.p_user_id && r.type === a.p_request_type).length
          if (used >= a.p_limit) return { data: { ok: false, used, limit: a.p_limit }, error: null }
          const id = `id-${++n}`
          rows.push({ id, user_id: a.p_user_id, type: a.p_request_type, tokens: 0 })
          return { data: { ok: true, used: used + 1, limit: a.p_limit, id }, error: null }
        }
        const i = rows.findIndex((r) => r.id === a.p_id && r.user_id === a.p_user_id && r.tokens === 0)
        if (i >= 0) rows.splice(i, 1)
        return { data: i >= 0, error: null }
      })
      chain = run
      return run as Promise<{ data: unknown; error: null }>
    },
    from(_t: string) {
      return {
        update: (p: Record<string, any>) => ({
          eq: (_c: string, id: unknown) => {
            const r = rows.find((x) => x.id === id)
            if (r) r.tokens = p.tokens_used
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  }
}

Deno.test('tts: concurrent reserves never exceed the cap', async () => {
  const db = fakeDb()
  const out = await Promise.all(Array.from({ length: 9 }, () => reserveUsage(db, 'u', 'grok_tts', 4)))
  assertEquals(out.filter((r) => r.status === 'reserved').length, 4)
  assertEquals(db.rows.length, 4)
})

Deno.test('tts: cap check errors fail closed', async () => {
  for (const f of ['error', 'throw', 'garbage'] as const) {
    assertEquals((await reserveUsage(fakeDb(f), 'u', 'grok_tts', 4)).status, 'unavailable')
  }
})

Deno.test('tts: release refunds, finalize locks the slot', async () => {
  const db = fakeDb()
  const a = await reserveUsage(db, 'u', 'grok_tts', 1)
  assert(a.status === 'reserved')
  assertEquals(await releaseUsage(db, a.id, 'u'), true)
  const b = await reserveUsage(db, 'u', 'grok_tts', 1)
  assert(b.status === 'reserved')
  await finalizeUsage(db, b.id, 0)
  assertEquals(await releaseUsage(db, b.id, 'u'), false)
  assertEquals((await reserveUsage(db, 'u', 'grok_tts', 1)).status, 'limit')
})

Deno.test('grok-tts index: reserve before xAI, 503 on unavailable, refund on every failure path', async () => {
  const src = await Deno.readTextFile(new URL('../functions/grok-tts/index.ts', import.meta.url))
  const post = src.slice(src.indexOf('const parsed = parseTtsBody(body)'))
  const reserveAt = post.indexOf("reserveUsage(db, uid, 'grok_tts', limit)")
  assert(reserveAt > 0 && reserveAt < post.indexOf('fetch(XAI_TTS_URL'))
  assert(/slot\.status === 'unavailable'[\s\S]{0,160}json\(503/.test(post))
  // 5 explicit failure paths + the finally.
  assertEquals((post.match(/await refund\(\)/g) || []).length, 6)
  assert(!/countUsage\(db, uid, TTS_REQUEST_TYPE, today/.test(src), 'old racy daily count removed')
  assert(post.includes('finalizeUsage(db, slot.id'))
})

Deno.test('grok-tts index (QA L-2): release always runs, before any upstream body read', async () => {
  const src = await Deno.readTextFile(new URL('../functions/grok-tts/index.ts', import.meta.url))
  const post = src.slice(src.indexOf("const slot = await reserveUsage(db, uid, 'grok_tts', limit)"))
  // No raw upstream body read that could throw before the refund.
  assert(!/await tr\.text\(\)/.test(post), 'upstream body only read via readDetail')
  // Every readDetail(tr) is immediately preceded by await refund().
  const reads = [...post.matchAll(/const detail = await readDetail\(tr\)/g)]
  assertEquals(reads.length, 2)
  for (const m of reads) {
    const before = post.slice(0, m.index).trimEnd()
    assert(before.endsWith('await refund()'), 'refund before reading the error body')
  }
  // readDetail swallows stream errors.
  assert(/const readDetail = async[\s\S]{0,160}catch \(_e\)[\s\S]{0,30}return ''/.test(post))
  // try/finally around everything after the reserve, refunding unless finalized.
  assert(/\} finally \{\s*await refund\(\)\s*\}/.test(post), 'finally refunds')
  assert(/if \(settled\) return\s*settled = true\s*await releaseUsage\(db, slot\.id, uid\)/.test(post), 'refund runs once')
  assert(/settled = true\s*await finalizeUsage\(db, slot\.id/.test(post), 'success path is not refunded')
})

Deno.test('refund-once + finally pattern: a throwing body read still releases exactly once', async () => {
  const releases: string[] = []
  const handler = async (bodyThrows: boolean, ok: boolean) => {
    let settled = false
    const refund = async () => {
      if (settled) return
      settled = true
      releases.push('r')
    }
    try {
      if (!ok) {
        if (bodyThrows) throw new Error('stream reset')
        await refund()
        return 502
      }
      settled = true
      return 200
    } finally {
      await refund()
    }
  }
  await assertRejects(() => handler(true, false))
  assertEquals(releases.length, 1)
  assertEquals(await handler(false, false), 502)
  assertEquals(releases.length, 2)
  assertEquals(await handler(false, true), 200)
  assertEquals(releases.length, 2)
})
