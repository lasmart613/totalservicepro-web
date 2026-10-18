import {
  checkFormTicket,
  checkStep2Token,
  clientIp,
  corsHeadersFor,
  hashIp,
  honeypotTripped,
  issueFormTicket,
  issueStep2Token,
  MAX_BODY_CHARS,
  NEUTRAL_REVIEW_MESSAGE,
  parseAllowedOrigins,
  parseStep1,
  parseStep2,
  turnstileEnabled,
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

async function turnstileOk(env: Env, fx: Fetch, token: unknown, ip: string): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false
  const form = new URLSearchParams({ secret: env('TURNSTILE_SECRET_KEY') || '', response: token, remoteip: ip })
  try {
    const r = await fx(TURNSTILE_URL, { method: 'POST', body: form })
    const j = (await r.json()) as { success?: boolean }
    return j.success === true
  } catch {
    return false
  }
}

/**
 * GET  -> { ticket }   form ticket (minimum fill time). Call when the form loads.
 * POST { action: 'start', ticket, name, kind, email, state?, zip?, company_url (honeypot), turnstile? }
 *      -> { ok, status: 'created', token } | { ok, status: 'review', message }
 * POST { action: 'complete', token, contact_name, phone, ... }
 *      -> { ok, status: 'received' }
 */
export async function handle(req: Request, env: Env, fx: Fetch = fetch): Promise<Response> {
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

  // Bots that fill the hidden field get the same answer a real duplicate gets. Nothing is written.
  if (honeypotTripped(body)) return json(200, { ok: true, status: 'review', message: NEUTRAL_REVIEW_MESSAGE }, cors)

  const ip = clientIp(req.headers)

  try {
    if (body.action === 'start') {
      const t = await checkFormTicket(secret, body.ticket)
      if (t === 'too_fast') return json(400, { ok: false, error: 'Please take a moment to check your details, then submit again.' }, cors)
      if (t !== 'ok') return json(400, { ok: false, error: 'This form expired. Reload the page and try again.', reload: true }, cors)
      if (turnstileEnabled(env) && !(await turnstileOk(env, fx, body.turnstile, ip))) {
        return json(400, { ok: false, error: 'Please complete the verification check.' }, cors)
      }
      const p = parseStep1(body)
      if (!p.ok) return json(400, { ok: false, error: 'Please check this field.', field: p.field }, cors)
      const r = await rpc(env, fx, 'directory_registration_step1', {
        p_name: p.value.name,
        p_kind: p.value.kind,
        p_email: p.value.email,
        p_state: p.value.state,
        p_zip: p.value.zip,
        p_ip_hash: await hashIp(secret, ip),
      })
      if (r.ok !== true) {
        if (r.reason === 'rate_limited') return json(429, { ok: false, error: 'Too many sign-ups from here. Please try again later.' }, cors)
        return json(400, { ok: false, error: 'Please check your details and try again.' }, cors)
      }
      if (r.status === 'created' && typeof r.registration_id === 'string' && typeof r.organization_id === 'number') {
        const token = await issueStep2Token(secret, r.registration_id, r.organization_id)
        return json(200, { ok: true, status: 'created', token }, cors)
      }
      return json(200, { ok: true, status: 'review', message: NEUTRAL_REVIEW_MESSAGE }, cors)
    }

    if (body.action === 'complete') {
      const bound = await checkStep2Token(secret, body.token)
      if (!bound) return json(400, { ok: false, error: 'This link expired. Start again from the front page.', restart: true }, cors)
      const p = parseStep2(body)
      if (!p.ok) return json(400, { ok: false, error: 'Please check this field.', field: p.field }, cors)
      const r = await rpc(env, fx, 'directory_registration_step2', {
        p_registration_id: bound.rid,
        p_organization_id: bound.oid,
        p_fields: p.fields,
      })
      if (r.ok !== true) {
        return json(400, { ok: false, error: 'This registration was already completed or has expired.', restart: true }, cors)
      }
      return json(200, { ok: true, status: 'received' }, cors)
    }
  } catch (e) {
    console.error('register-directory-org', e instanceof Error ? e.message : 'error')
    return json(503, { ok: false, error: 'Something went wrong. Please try again in a few minutes.' }, cors)
  }

  return json(400, { ok: false, error: 'Invalid request.' }, cors)
}
