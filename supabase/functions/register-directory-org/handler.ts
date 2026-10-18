import {
  checkFormTicket,
  checkStep2Token,
  clientIp,
  clientIpSource,
  corsHeadersFor,
  hashIp,
  honeypotTripped,
  issueFormTicket,
  issueStep2Token,
  MAX_BODY_CHARS,
  DEFAULT_MIN_RESPONSE_MS,
  RESPONSE_JITTER_MS,
  fieldError,
  parseAllowedOrigins,
  parseStep1,
  parseStep2,
  turnstileEnabled,
  buildReviewNotice,
  DEFAULT_NOTICE_FROM,
  DEFAULT_REVIEW_URL,
  reviewInbox,
} from './contract.ts'

export type Env = (key: string) => string | undefined
type Fetch = typeof fetch

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

function json(status: number, body: Record<string, unknown>, cors: Record<string, string> | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(cors ?? {}), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function rpc(env: Env, fx: Fetch, name: string, args: Record<string, unknown>) {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('not configured')
  const r = await fx(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}`)
  return (await r.json()) as Record<string, unknown>
}

/**
 * Review notice, once per org: sent on step-2 completion (that's when contact
 * name and city exist). directory_registration_take_notice returns the payload
 * only the first time. Any failure is logged and never fails the registration.
 */
async function sendReviewNotice(env: Env, fx: Fetch, rid: string): Promise<void> {
  try {
    const to = reviewInbox(env)
    const key = env('RESEND_API_KEY')
    if (!to || !key) return
    const n = await rpc(env, fx, 'directory_registration_take_notice', { p_registration_id: rid })
    if (n.ok !== true) return
    const mail = buildReviewNotice(n, env('DIRECTORY_REVIEW_URL') || DEFAULT_REVIEW_URL)
    const r = await fx('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('DIRECTORY_NOTICE_FROM') || DEFAULT_NOTICE_FROM, to: [to], ...mail }),
    })
    if (!r.ok) console.error('register-directory-org notice', r.status)
  } catch (e) {
    console.error('register-directory-org notice', e instanceof Error ? e.message : 'error')
  }
}

/** Cloudflare siteverify. Fails closed: no secret, no token, HTTP error, timeout or bad JSON -> false. */
async function turnstileOk(env: Env, fx: Fetch, token: unknown, ip: string | null): Promise<boolean> {
  const secret = env('TURNSTILE_SECRET_KEY') || ''
  if (!secret) {
    console.error('register-directory-org: Turnstile is on but TURNSTILE_SECRET_KEY is not set; refusing')
    return false
  }
  if (typeof token !== 'string' || !token || token.length > 2048) return false
  const form = new URLSearchParams({ secret, response: token })
  if (ip) form.set('remoteip', ip)
  try {
    const r = await fx(TURNSTILE_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return false
    const j = (await r.json()) as { success?: unknown }
    return j.success === true
  } catch {
    return false
  }
}

let coldStartLogged = false
/** Once per cold start: which IP header is used (never an IP) and Turnstile config problems. */
export function logConfigOnce(env: Env, log: (m: string) => void = console.log, warn: (m: string) => void = console.warn): void {
  if (coldStartLogged) return
  coldStartLogged = true
  const ip = clientIpSource(env)
  log(`register-directory-org: client IP source header = ${ip.source}`)
  if (ip.invalid) warn(`register-directory-org: unknown DIRECTORY_CLIENT_IP_HEADER value; using ${ip.source}`)
  if (turnstileEnabled(env) && !env('TURNSTILE_SECRET_KEY')) {
    warn('register-directory-org: DIRECTORY_TURNSTILE_ENABLED is on but TURNSTILE_SECRET_KEY is missing; every sign-up will be refused')
  }
}
/** Tests only. */
export function resetColdStart(): void {
  coldStartLogged = false
}

export type Deps = { sleep?: (ms: number) => Promise<void>; now?: () => number; random?: () => number }

/**
 * GET  -> { ticket, turnstile }   single-use form ticket (minimum fill time).
 * POST { action: 'start', ticket, name, kind, email, state?, zip?, company_url (honeypot), turnstile? }
 *      -> { ok, status: 'created', token }   for a new sign-up, a dedupe match and the honeypot alike (QA M-2)
 * POST { action: 'complete', token, contact_name, phone, ... }
 *      -> { ok, status: 'received' }
 */
export async function handle(req: Request, env: Env, fx: Fetch = fetch, deps: Deps = {}): Promise<Response> {
  logConfigOnce(env)
  const allowed = parseAllowedOrigins(env('DIRECTORY_ALLOWED_ORIGINS'))
  const origin = req.headers.get('origin')
  const cors = corsHeadersFor(origin, allowed)

  if (!cors) return json(403, { ok: false, error: 'origin not allowed' }, null)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const secret = env('DIRECTORY_FORM_SECRET') || ''
  if (secret.length < 32) return json(503, { ok: false, error: 'Registration is not open yet.' }, cors)

  if (req.method === 'GET') {
    return json(200, { ok: true, ticket: await issueFormTicket(secret), turnstile: turnstileEnabled(env) }, cors)
  }
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method not allowed' }, cors)

  const declared = Number(req.headers.get('content-length') || '0')
  if (declared > MAX_BODY_CHARS * 4) return json(413, { ok: false, error: 'Too much data.' }, cors)
  const raw = await req.text()
  if (raw.length > MAX_BODY_CHARS) return json(413, { ok: false, error: 'Too much data.' }, cors)
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    body = parsed
  } catch {
    return json(400, { ok: false, error: 'Invalid request.' }, cors)
  }

  const ip = clientIp(req.headers, clientIpSource(env).source)
  const now = deps.now ?? (() => Date.now())
  const started = now()
  const minMs = Number(env('DIRECTORY_MIN_RESPONSE_MS') ?? DEFAULT_MIN_RESPONSE_MS)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const random = deps.random ?? Math.random
  // Every step-1 answer takes about the same time (honeypot, match, miss, refusal).
  const padded = async (res: Response) => {
    const target = (Number.isFinite(minMs) ? Math.max(0, minMs) : DEFAULT_MIN_RESPONSE_MS) + (minMs > 0 ? random() * RESPONSE_JITTER_MS : 0)
    const wait = target - (now() - started)
    if (wait > 0) await sleep(wait)
    return res
  }

  try {
    if (body.action === 'start') {
      // Bots that fill the hidden field get a decoy that looks exactly like a new sign-up. Nothing is written.
      if (honeypotTripped(body)) {
        return padded(json(200, { ok: true, status: 'created', token: await issueStep2Token(secret, crypto.randomUUID()) }, cors))
      }
      const t = await checkFormTicket(secret, body.ticket)
      if (t.status === 'too_fast') return padded(json(400, { ok: false, error: 'Please take a moment to check your details, then submit again.' }, cors))
      if (t.status !== 'ok') return padded(json(400, { ok: false, error: 'This form expired. Reload the page and try again.', reload: true }, cors))
      if (turnstileEnabled(env) && !(await turnstileOk(env, fx, body.turnstile, ip))) {
        return padded(json(400, { ok: false, error: 'Please complete the verification check.', turnstile: true }, cors))
      }
      const p = parseStep1(body)
      if (!p.ok) return padded(json(400, { ok: false, error: fieldError(p.field, p.reason), field: p.field, reason: p.reason }, cors))
      const r = await rpc(env, fx, 'directory_registration_step1', {
        p_name: p.value.name,
        p_kind: p.value.kind,
        p_email: p.value.email,
        p_state: p.value.state,
        p_zip: p.value.zip,
        p_ip_hash: await hashIp(secret, ip),
        p_ticket_nonce: t.nonce,
      })
      if (r.ok !== true) {
        if (r.reason === 'rate_limited') return padded(json(429, { ok: false, error: 'We are getting a lot of sign-ups right now. Please try again later.', reload: true }, cors))
        if (r.reason === 'ticket_used') return padded(json(400, { ok: false, error: 'This form was already submitted. Reload the page and try again.', reload: true }, cors))
        return padded(json(400, { ok: false, error: 'Please check your details and try again.', reload: true }, cors))
      }
      if (r.status === 'created' && typeof r.registration_id === 'string') {
        return padded(json(200, { ok: true, status: 'created', token: await issueStep2Token(secret, r.registration_id) }, cors))
      }
      throw new Error('unexpected step1 reply')
    }

    if (body.action === 'complete') {
      const bound = await checkStep2Token(secret, body.token)
      if (!bound) return json(400, { ok: false, error: 'This link expired. Start again from the front page.', restart: true }, cors)
      const p = parseStep2(body)
      if (!p.ok) return json(400, { ok: false, error: fieldError(p.field, p.reason), field: p.field, reason: p.reason }, cors)
      const r = await rpc(env, fx, 'directory_registration_step2', {
        p_registration_id: bound.rid,
        p_fields: p.fields,
      })
      if (r.ok !== true) {
        return json(400, { ok: false, error: 'This registration was already completed or has expired.', restart: true }, cors)
      }
      await sendReviewNotice(env, fx, bound.rid)
      return json(200, { ok: true, status: 'received' }, cors)
    }
  } catch (e) {
    console.error('register-directory-org', e instanceof Error ? e.message : 'error')
    const res = json(503, { ok: false, error: 'Something went wrong. Please try again in a few minutes.', reload: body.action === 'start' }, cors)
    return body.action === 'start' ? padded(res) : res
  }

  return json(400, { ok: false, error: 'Invalid request.' }, cors)
}
