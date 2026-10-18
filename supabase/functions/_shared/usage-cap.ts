/**
 * Atomic daily cap for grok-assistant and grok-tts (000927).
 *
 * reserveUsage calls public.ai_usage_reserve, which takes a per-user+type
 * advisory lock, counts today's (UTC) api_usage rows and inserts a
 * reservation row only when under the cap, all in one transaction. Two
 * concurrent requests can no longer both pass a stale count.
 *
 * Fail closed: any RPC error or malformed reply is 'unavailable' (HTTP 503),
 * never a pass. On an upstream xAI failure the caller refunds the slot with
 * releaseUsage; on success finalizeUsage records the token count.
 */

export type UsageType = 'grok_chat' | 'grok_tts'

export type UsageReservation =
  | { status: 'reserved'; id: string; used: number; limit: number }
  | { status: 'limit'; used: number; limit: number }
  | { status: 'unavailable'; reason: string }

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
}
type UpdateClient = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => { eq: (col: string, v: unknown) => PromiseLike<{ error: { message?: string } | null }> }
  }
}

export async function reserveUsage(
  db: RpcClient,
  uid: string,
  type: UsageType,
  limit: number
): Promise<UsageReservation> {
  try {
    const { data, error } = await db.rpc('ai_usage_reserve', {
      p_user_id: uid,
      p_request_type: type,
      p_limit: limit,
    })
    if (error) return { status: 'unavailable', reason: error.message || 'rpc error' }
    const row = (data && typeof data === 'object' ? data : null) as Record<string, unknown> | null
    if (!row) return { status: 'unavailable', reason: 'empty reply' }
    const used = Number(row.used)
    if (!Number.isFinite(used)) return { status: 'unavailable', reason: 'bad reply' }
    if (row.ok === true && typeof row.id === 'string' && row.id) {
      return { status: 'reserved', id: row.id, used, limit }
    }
    if (row.ok === false) return { status: 'limit', used, limit }
    return { status: 'unavailable', reason: 'bad reply' }
  } catch (e) {
    return { status: 'unavailable', reason: (e as Error)?.message || String(e) }
  }
}

/** Refund a reservation after an upstream failure. Best effort; never throws. */
export async function releaseUsage(db: RpcClient, id: string, uid: string): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('ai_usage_release', { p_id: id, p_user_id: uid })
    if (error) {
      console.warn('[ai-usage] usage release failed', error.message)
      return false
    }
    return data === true
  } catch (e) {
    console.warn('[ai-usage] usage release failed', e)
    return false
  }
}

/**
 * Record tokens on a used reservation. At least 1, so a finished call can
 * never be refunded by ai_usage_release (which only removes tokens_used = 0).
 */
export async function finalizeUsage(db: UpdateClient, id: string, tokens: number): Promise<void> {
  try {
    const n = Math.max(1, Math.floor(Number(tokens) || 0))
    const { error } = await db.from('api_usage').update({ tokens_used: n }).eq('id', id)
    if (error) console.warn('[ai-usage] usage finalize failed', error.message)
  } catch (e) {
    console.warn('[ai-usage] usage finalize failed', e)
  }
}

export const USAGE_UNAVAILABLE_BODY = {
  error: 'usage_unavailable',
  message: 'Could not check AI limits. Try again.',
}
