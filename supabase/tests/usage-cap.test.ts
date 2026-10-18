// Deno tests for the shared atomic AI cap (000927) and its use in grok-tts
// and grok-assistant. Run: deno test -A supabase/tests
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
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
  assertEquals((post.match(/await refund\(\)/g) || []).length, 5)
  assert(!/countUsage\(db, uid, TTS_REQUEST_TYPE, today/.test(src), 'old racy daily count removed')
  assert(post.includes('finalizeUsage(db, slot.id'))
})
