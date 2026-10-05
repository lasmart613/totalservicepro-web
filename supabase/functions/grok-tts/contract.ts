/**
 * Pure request checks for grok-tts. No Deno imports — node tests load this file.
 * Daily voice numbers stay aligned with grok-assistant LIMITS.voice.
 */

export const MAX_TTS_CHARS = 4000
export const TTS_REQUESTS_PER_MINUTE = 8
export const VOICES_REQUESTS_PER_MINUTE = 30
export const RATE_WINDOW_MS = 60_000
/** Same built-in voices as grok-assistant TTS. Unknown ids are rejected. */
export const ALLOWED_VOICE_IDS = ['eve', 'ara', 'rex', 'sal', 'leo', 'sage'] as const
export const DEFAULT_VOICE_ID = 'sage'
export const DEFAULT_LANGUAGE = 'en'
export const TTS_REQUEST_TYPE = 'grok_tts'
export const VOICES_REQUEST_TYPE = 'grok_tts_voices'

/** Same voice budgets as grok-assistant (free 1/day, paid 10/day). */
export const VOICE_DAILY_LIMITS: Record<string, number> = {
  free: 1,
  premium: 10,
  team: 10,
  enterprise: 10,
}

const LANGUAGE_RE = /^(auto|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2})$/

export type SubscriptionRow = {
  tier?: string | null
  status?: string | null
  expires_at?: string | null
} | null

export type TtsRequest = {
  text: string
  voiceId: string
  language: string
}

export type TtsParseFailure = {
  status: number
  body: Record<string, unknown>
}

export function effectiveTier(sub: SubscriptionRow, now = new Date()): string {
  const tier = sub?.status === 'active' && sub?.tier ? String(sub.tier) : 'free'
  if (sub?.expires_at && new Date(sub.expires_at) < now) return 'free'
  return tier
}

export function dailyVoiceLimit(tier: string): number {
  return VOICE_DAILY_LIMITS[tier] ?? VOICE_DAILY_LIMITS.free
}

export function dailyLimitMessage(tier: string, limit: number): string {
  return tier === 'free' ? `Free limit: ${limit} voice/day.` : `Daily voice limit: ${limit}/day.`
}

export function parseTtsBody(input: unknown): { ok: true; value: TtsRequest } | { ok: false; error: TtsParseFailure } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: { status: 400, body: { error: 'invalid_body', message: 'JSON object required.' } },
    }
  }
  const rec = input as Record<string, unknown>
  const text = rec.text
  if (typeof text !== 'string' || !text.trim()) {
    return {
      ok: false,
      error: { status: 400, body: { error: 'Missing text', message: 'text is required.' } },
    }
  }
  if (text.length > MAX_TTS_CHARS) {
    return {
      ok: false,
      error: {
        status: 413,
        body: {
          error: 'text_too_long',
          message: `Text exceeds ${MAX_TTS_CHARS} characters.`,
          max_characters: MAX_TTS_CHARS,
          length: text.length,
        },
      },
    }
  }

  const rawVoice = rec.voice_id !== undefined ? rec.voice_id : rec.voiceId
  let voiceId: string = DEFAULT_VOICE_ID
  if (rawVoice != null && rawVoice !== '') {
    const candidate = typeof rawVoice === 'string' ? rawVoice.trim().toLowerCase() : ''
    if (!ALLOWED_VOICE_IDS.includes(candidate as (typeof ALLOWED_VOICE_IDS)[number])) {
      return {
        ok: false,
        error: {
          status: 400,
          body: {
            error: 'invalid_voice_id',
            message: `voice_id must be one of: ${ALLOWED_VOICE_IDS.join(', ')}.`,
          },
        },
      }
    }
    voiceId = candidate
  }

  const rawLang = rec.language
  let language = DEFAULT_LANGUAGE
  if (rawLang != null && rawLang !== '') {
    if (typeof rawLang !== 'string' || !LANGUAGE_RE.test(rawLang)) {
      return {
        ok: false,
        error: {
          status: 400,
          body: {
            error: 'invalid_language',
            message: 'language must be a BCP-47 code (for example "en" or "pt-BR") or "auto".',
          },
        },
      }
    }
    language = rawLang
  }

  return { ok: true, value: { text, voiceId, language } }
}

/** Strip a secret and common key shapes before any upstream body is returned. */
export function redactSecrets(raw: string, secret = ''): string {
  let s = String(raw || '').slice(0, 300)
  const key = String(secret || '')
  if (key.length >= 8) s = s.split(key).join('[redacted]')
  return s.replace(/\b(?:sk|xai)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
}
