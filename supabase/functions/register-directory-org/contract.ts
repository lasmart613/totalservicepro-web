/**
 * register-directory-org: pure helpers (no Deno/Node APIs beyond Web Crypto),
 * so the same file runs in the Edge Function and in tests.
 */

export const FORM_MIN_FILL_MS = 3_000
export const FORM_MAX_AGE_MS = 2 * 60 * 60 * 1000
export const STEP2_TOKEN_TTL_SEC = 60 * 60
export const MAX_BODY_CHARS = 16_000
export const HONEYPOT_FIELD = 'company_url'

/** Documented default. Production sets DIRECTORY_ALLOWED_ORIGINS explicitly. */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://medicalrepairnetwork.com',
  'https://www.medicalrepairnetwork.com',
]

export const KINDS = ['service', 'supplier', 'rental', 'clinic'] as const
export type Kind = (typeof KINDS)[number]

export const KIND_TO_ORG_TYPE: Record<Kind, string> = {
  service: 'service_company',
  supplier: 'parts_supplier',
  rental: 'laser_rental',
  clinic: 'laser_clinic',
}

export const NEUTRAL_REVIEW_MESSAGE =
  "Thanks. We may already have your company on file, so we'll review this and be in touch by email."

export const US_STATES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY ' +
    'NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP').split(' ')
)

export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s))
  return list.length ? list : [...DEFAULT_ALLOWED_ORIGINS]
}

export function corsHeadersFor(origin: string | null, allowed: string[]): Record<string, string> | null {
  if (!origin || !allowed.includes(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

// ---------- signing ----------

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToString(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function hmac(secret: string, purpose: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${purpose}\n${data}`))
  return b64url(new Uint8Array(sig))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

async function sign(secret: string, purpose: string, payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)))
  return `${body}.${await hmac(secret, purpose, body)}`
}

async function verify(secret: string, purpose: string, token: unknown): Promise<Record<string, unknown> | null> {
  if (typeof token !== 'string' || token.length > 1000) return null
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  if (!timingSafeEqual(sig, await hmac(secret, purpose, body))) return null
  try {
    const v = JSON.parse(b64urlToString(body))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

/** Form ticket: proves when the form was loaded (minimum fill time). */
export function issueFormTicket(secret: string, nowMs = Date.now()): Promise<string> {
  return sign(secret, 'mrn-form', { iat: nowMs, n: crypto.randomUUID() })
}

export async function checkFormTicket(
  secret: string,
  ticket: unknown,
  nowMs = Date.now()
): Promise<'ok' | 'too_fast' | 'expired' | 'invalid'> {
  const v = await verify(secret, 'mrn-form', ticket)
  if (!v || typeof v.iat !== 'number') return 'invalid'
  const age = nowMs - v.iat
  if (age < FORM_MIN_FILL_MS) return 'too_fast'
  if (age > FORM_MAX_AGE_MS) return 'expired'
  return 'ok'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Step-2 token: binds the browser to the one registration + org created in step 1. */
export function issueStep2Token(secret: string, rid: string, oid: number, nowMs = Date.now()): Promise<string> {
  if (!UUID_RE.test(rid) || !Number.isSafeInteger(oid) || oid <= 0) throw new Error('bad binding')
  return sign(secret, 'mrn-step2', { rid, oid, exp: Math.floor(nowMs / 1000) + STEP2_TOKEN_TTL_SEC })
}

export async function checkStep2Token(
  secret: string,
  token: unknown,
  nowMs = Date.now()
): Promise<{ rid: string; oid: number } | null> {
  const v = await verify(secret, 'mrn-step2', token)
  if (!v) return null
  const { rid, oid, exp } = v as { rid?: unknown; oid?: unknown; exp?: unknown }
  if (typeof rid !== 'string' || !UUID_RE.test(rid)) return null
  if (typeof oid !== 'number' || !Number.isSafeInteger(oid) || oid <= 0) return null
  if (typeof exp !== 'number' || exp * 1000 <= nowMs) return null
  return { rid, oid }
}

export async function hashIp(secret: string, ip: string): Promise<string> {
  return hmac(secret, 'mrn-ip', ip || 'unknown')
}

export function clientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  )
}

// ---------- validation ----------

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : ''
}

export function isValidEmail(e: string): boolean {
  return e.length >= 6 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

export type Step1 = { name: string; kind: Kind; email: string; state: string | null; zip: string | null }

export function parseStep1(body: Record<string, unknown>): { ok: true; value: Step1 } | { ok: false; field: string } {
  const name = str(body.name, 160)
  if (name.length < 2) return { ok: false, field: 'name' }
  const kind = str(body.kind, 20).toLowerCase() as Kind
  if (!KINDS.includes(kind)) return { ok: false, field: 'kind' }
  const email = str(body.email, 254).toLowerCase()
  if (!isValidEmail(email)) return { ok: false, field: 'email' }
  const state = str(body.state, 2).toUpperCase() || null
  if (state && !US_STATES.has(state)) return { ok: false, field: 'state' }
  const zip = str(body.zip, 10) || null
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) return { ok: false, field: 'zip' }
  return { ok: true, value: { name, kind, email, state, zip } }
}

function list(v: unknown, maxItems: number, maxLen: number): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []
  const out: string[] = []
  for (const item of raw) {
    const s = str(item, maxLen)
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s)
    if (out.length >= maxItems) break
  }
  return out
}

function count(v: unknown, max: number): string | undefined {
  const s = str(typeof v === 'number' ? String(v) : v, 6)
  return /^\d+$/.test(s) && Number(s) <= max ? String(Number(s)) : undefined
}

export function normalizeWebsite(v: unknown): string | null {
  const s = str(v, 200)
  if (!s) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null
    return u.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/** Allow-listed step-2 fields. Anything else in the body is dropped here and again in SQL. */
export function parseStep2(body: Record<string, unknown>): { ok: true; fields: Record<string, unknown> } | { ok: false; field: string } {
  const f: Record<string, unknown> = {}
  const contact = str(body.contact_name, 120)
  if (contact.length < 2) return { ok: false, field: 'contact_name' }
  f.contact_name = contact
  const phone = str(body.phone, 40)
  if (phone && phone.replace(/\D/g, '').length < 7) return { ok: false, field: 'phone' }
  if (phone) f.phone = phone
  const alt = str(body.alt_phone, 40)
  if (alt) f.alt_phone = alt
  if (str(body.website, 200)) {
    const w = normalizeWebsite(body.website)
    if (!w) return { ok: false, field: 'website' }
    f.website = w
  }
  for (const [k, max] of [['address', 200], ['city', 80], ['description', 1000], ['services_offered', 500]] as const) {
    const s = str(body[k], max)
    if (s) f[k] = s
  }
  const state = str(body.state, 2).toUpperCase()
  if (state) {
    if (!US_STATES.has(state)) return { ok: false, field: 'state' }
    f.state = state
  }
  const zip = str(body.zip, 10)
  if (zip) {
    if (!/^\d{5}(-\d{4})?$/.test(zip)) return { ok: false, field: 'zip' }
    f.zip = zip
  }
  f.brands = list(body.brands, 40, 80)
  f.modalities = list(body.modalities, 40, 80)
  f.coverage = list(body.coverage, 60, 80)
  const y = count(body.years_in_business, 200)
  if (y) f.years_in_business = y
  const t = count(body.num_techs, 9999)
  if (t) f.num_techs = t
  const l = count(body.num_locations, 9999)
  if (l) f.num_locations = l
  return { ok: true, fields: f }
}

export function honeypotTripped(body: Record<string, unknown>): boolean {
  const v = body[HONEYPOT_FIELD]
  return typeof v === 'string' ? v.trim() !== '' : v != null
}

export function turnstileEnabled(env: (k: string) => string | undefined): boolean {
  return env('DIRECTORY_TURNSTILE_ENABLED') === '1' && Boolean(env('TURNSTILE_SECRET_KEY'))
}
