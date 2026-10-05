/**
 * grok-tts
 *
 * Server-side xAI text-to-speech for Android / iOS voice mode.
 * The xAI key stays a Supabase function secret (same XAI_API_KEY as grok-assistant).
 * It is not a Netlify env var and must never be shipped in a mobile client.
 *
 *   POST https://<project>.supabase.co/functions/v1/grok-tts
 *   GET  https://<project>.supabase.co/functions/v1/grok-tts
 *   Authorization: Bearer <supabase user access token>
 *
 * Deploy with JWT verification off, same as grok-assistant — this function
 * checks the user session itself:
 *   supabase functions deploy grok-tts --project-ref yljztfajyvjzqikxdddf --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  dailyLimitMessage,
  dailyVoiceLimit,
  effectiveTier,
  MAX_TTS_CHARS,
  parseTtsBody,
  RATE_WINDOW_MS,
  redactSecrets,
  TTS_REQUEST_TYPE,
  TTS_REQUESTS_PER_MINUTE,
  VOICES_REQUEST_TYPE,
  VOICES_REQUESTS_PER_MINUTE,
} from './contract.ts'

const XAI_TTS_URL = 'https://api.x.ai/v1/tts'
const XAI_VOICES_URL = 'https://api.x.ai/v1/tts/voices'
const XAI_TIMEOUT_MS = 50_000
const MAX_BODY_CHARS = 48_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  })
}

async function countUsage(
  db: any,
  uid: string,
  requestType: string,
  sinceIso: string
): Promise<{ count: number; error: boolean }> {
  const { data, error } = await db
    .from('api_usage')
    .select('id')
    .eq('user_id', uid)
    .eq('request_type', requestType)
    .gte('created_at', sinceIso)
  if (error) return { count: 0, error: true }
  return { count: Array.isArray(data) ? data.length : 0, error: false }
}

async function logUsage(db: any, uid: string, requestType: string, n: number) {
  try {
    await db.from('api_usage').insert({ user_id: uid, request_type: requestType, tokens_used: n })
  } catch (_e) {
    console.warn('api_usage insert failed', requestType)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { error: 'method_not_allowed', message: 'Use POST to synthesize or GET to list voices.' })
  }

  let xaiKey = ''
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader)
      return json(401, { error: 'No auth' })
    const userToken = authHeader.replace('Bearer ', '')
    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    })
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()
    if (authError || !user) return json(401, { error: 'Unauthorized' })

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const uid = user.id
    xaiKey = Deno.env.get('XAI_API_KEY') ?? ''
    if (!xaiKey) return json(500, { error: 'AI not configured' })

    if (req.method === 'GET') {
      const recent = await countUsage(
        db,
        uid,
        VOICES_REQUEST_TYPE,
        new Date(Date.now() - RATE_WINDOW_MS).toISOString()
      )
      if (recent.error) {
        return json(503, { error: 'usage_unavailable', message: 'Could not check voice limits. Try again.' })
      }
      if (recent.count >= VOICES_REQUESTS_PER_MINUTE) {
        return json(
          429,
          {
            error: 'rate_limited',
            message: `Voice list limit: ${VOICES_REQUESTS_PER_MINUTE} requests per minute.`,
            limit: VOICES_REQUESTS_PER_MINUTE,
            retry_after_seconds: 60,
          },
          { 'Retry-After': '60' }
        )
      }
      const vr = await fetch(XAI_VOICES_URL, {
        headers: { Authorization: `Bearer ${xaiKey}` },
        signal: AbortSignal.timeout(15_000),
      })
      const raw = await vr.text()
      if (!vr.ok) {
        console.warn('xAI voices failed', vr.status)
        return json(vr.status === 429 ? 429 : 502, {
          error: vr.status === 429 ? 'upstream_rate_limited' : 'TTS voices error',
          message: vr.status === 429 ? 'Voice service is busy. Try again shortly.' : 'Could not list voices.',
          details: redactSecrets(raw, xaiKey),
        })
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (_e) {
        return json(502, { error: 'TTS voices error', message: 'Voice list was not JSON.' })
      }
      await logUsage(db, uid, VOICES_REQUEST_TYPE, 0)
      return json(200, parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { voices: parsed })
    }

    const declared = Number(req.headers.get('Content-Length') || 0)
    if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) {
      return json(413, {
        error: 'text_too_long',
        message: `Text exceeds ${MAX_TTS_CHARS} characters.`,
        max_characters: MAX_TTS_CHARS,
      })
    }
    const rawBody = await req.text()
    if (rawBody.length > MAX_BODY_CHARS) {
      return json(413, {
        error: 'text_too_long',
        message: `Text exceeds ${MAX_TTS_CHARS} characters.`,
        max_characters: MAX_TTS_CHARS,
      })
    }
    let body: unknown
    try {
      body = rawBody ? JSON.parse(rawBody) : null
    } catch (_e) {
      return json(400, { error: 'invalid_body', message: 'JSON object required.' })
    }
    const parsed = parseTtsBody(body)
    if (!parsed.ok) return json(parsed.error.status, parsed.error.body)

    const { data: sub } = await db.from('subscriptions').select('tier,status,expires_at').eq('user_id', uid).single()
    const tier = effectiveTier(sub as { tier?: string | null; status?: string | null; expires_at?: string | null } | null)
    const limit = dailyVoiceLimit(tier)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const daily = await countUsage(db, uid, TTS_REQUEST_TYPE, today.toISOString())
    if (daily.error) {
      return json(503, { error: 'usage_unavailable', message: 'Could not check voice limits. Try again.' })
    }
    if (daily.count >= limit) {
      return json(429, {
        error: 'daily_limit_reached',
        message: dailyLimitMessage(tier, limit),
        used: daily.count,
        limit,
      })
    }
    const burst = await countUsage(db, uid, TTS_REQUEST_TYPE, new Date(Date.now() - RATE_WINDOW_MS).toISOString())
    if (burst.error) {
      return json(503, { error: 'usage_unavailable', message: 'Could not check voice limits. Try again.' })
    }
    if (burst.count >= TTS_REQUESTS_PER_MINUTE) {
      return json(
        429,
        {
          error: 'rate_limited',
          message: `Voice limit: ${TTS_REQUESTS_PER_MINUTE} requests per minute.`,
          limit: TTS_REQUESTS_PER_MINUTE,
          retry_after_seconds: 60,
        },
        { 'Retry-After': '60' }
      )
    }

    const { text, voiceId, language } = parsed.value
    let tr: Response
    try {
      tr = await fetch(XAI_TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify({
          text,
          voice_id: voiceId,
          language,
        }),
        signal: AbortSignal.timeout(XAI_TIMEOUT_MS),
      })
    } catch (e) {
      const name = (e as Error)?.name
      const aborted = name === 'TimeoutError' || name === 'AbortError'
      console.warn('xAI tts fetch failed', aborted ? 'timeout' : (e as Error)?.name)
      return json(aborted ? 504 : 502, {
        error: aborted ? 'tts_timeout' : 'TTS error',
        message: aborted ? 'Voice synthesis timed out.' : 'Voice synthesis failed.',
      })
    }

    if (!tr.ok) {
      const detail = redactSecrets(await tr.text(), xaiKey)
      console.warn('xAI tts failed', tr.status)
      if (tr.status === 401 || tr.status === 403) {
        return json(502, { error: 'TTS error', message: 'Voice service rejected the server credential.' })
      }
      if (tr.status === 429) {
        return json(429, {
          error: 'upstream_rate_limited',
          message: 'Voice service is busy. Try again shortly.',
          details: detail,
        }, { 'Retry-After': '60' })
      }
      return json(tr.status >= 400 && tr.status < 500 ? 400 : 502, {
        error: 'TTS error',
        message: 'Voice synthesis failed.',
        details: detail,
      })
    }

    const contentType = (tr.headers.get('Content-Type') || '').toLowerCase()
    if (contentType && !contentType.includes('audio/') && !contentType.includes('application/octet-stream')) {
      const detail = redactSecrets(await tr.text(), xaiKey)
      return json(502, { error: 'TTS error', message: 'Voice service did not return audio.', details: detail })
    }
    const audio = await tr.arrayBuffer()
    if (!audio.byteLength) {
      return json(502, { error: 'TTS error', message: 'Voice service returned empty audio.' })
    }
    await logUsage(db, uid, TTS_REQUEST_TYPE, Math.min(text.length, MAX_TTS_CHARS))
    return new Response(audio, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
        'Content-Length': String(audio.byteLength),
      },
    })
  } catch (error) {
    return json(500, { error: redactSecrets((error as Error).message || 'TTS failed', xaiKey) || 'TTS failed' })
  }
})
