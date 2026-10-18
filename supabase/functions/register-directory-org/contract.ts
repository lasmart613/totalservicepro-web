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
  "Thanks. We'll review this and be in touch by email."
/** Every step-1 answer (created, match, honeypot, refusal) takes at least this long, plus jitter. */
export const DEFAULT_MIN_RESPONSE_MS = 450
export const RESPONSE_JITTER_MS = 150
/** Friendly labels for the field hint returned with a 400. */
export const FIELD_LABELS: Record<string, string> = {
  name: 'Company name',
  kind: 'Company type',
  email: 'Contact email',
  state: 'State',
  zip: 'ZIP code',
  contact_name: 'Contact name',
  phone: 'Phone',
  alt_phone: 'Other phone',
  website: 'Website',
  address: 'Street address',
  city: 'City',
  description: 'Description',
  services_offered: 'Services offered',
  brands: 'Brands',
  modalities: 'Modalities',
  coverage: 'Coverage area',
}
export const FIELD_MAX: Record<string, number> = {
  name: 160, email: 254, contact_name: 120, phone: 40, alt_phone: 40, website: 200,
  address: 200, city: 80, description: 1000, services_offered: 500,
}
export function fieldError(field: string, reason: 'invalid' | 'too_long'): string {
  const label = FIELD_LABELS[field] || 'This field'
  if (reason === 'too_long') return `${label} is too long (${FIELD_MAX[field] ?? 80} characters max).`
  return `Please check: ${label}.`
}
export const US_STATES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY ' +
    'NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP').split(' ')
)

export function parseAllowedOrigins(raw: string | undefined | null, warn: (m: string) => void = console.warn): string[] {
  const entries = String(raw ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
  const bad = entries.filter((s) => !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s))
  if (bad.length) warn(`register-directory-org: ignoring invalid DIRECTORY_ALLOWED_ORIGINS entries: ${bad.join(', ')}`)
  const list = entries.filter((s) => !bad.includes(s))
  if (!list.length && entries.length) warn('register-directory-org: no valid DIRECTORY_ALLOWED_ORIGINS; using the defaults')
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

export type TicketCheck = { status: 'ok'; nonce: string } | { status: 'too_fast' | 'expired' | 'invalid' }
/** The nonce makes the ticket single-use: step 1 records it in directory_form_tickets. */
export async function checkFormTicket(secret: string, ticket: unknown, nowMs = Date.now()): Promise<TicketCheck> {
  const v = await verify(secret, 'mrn-form', ticket)
  if (!v || typeof v.iat !== 'number' || typeof v.n !== 'string' || !UUID_RE.test(v.n)) return { status: 'invalid' }
  const age = nowMs - v.iat
  if (age < FORM_MIN_FILL_MS) return { status: 'too_fast' }
  if (age > FORM_MAX_AGE_MS) return { status: 'expired' }
  return { status: 'ok', nonce: v.n }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Step-2 token: binds the browser to the one registration created in step 1.
 * Only {rid, exp}: the org (if any) is looked up server-side, so a real
 * sign-up, a dedupe match and the honeypot decoy all get the same token shape.
 */
export function issueStep2Token(secret: string, rid: string, nowMs = Date.now()): Promise<string> {
  if (!UUID_RE.test(rid)) throw new Error('bad binding')
  return sign(secret, 'mrn-step2', { rid: rid.toLowerCase(), exp: Math.floor(nowMs / 1000) + STEP2_TOKEN_TTL_SEC })
}

export async function checkStep2Token(secret: string, token: unknown, nowMs = Date.now()): Promise<{ rid: string } | null> {
  const v = await verify(secret, 'mrn-step2', token)
  if (!v) return null
  const { rid, exp } = v as { rid?: unknown; exp?: unknown }
  if (typeof rid !== 'string' || !UUID_RE.test(rid)) return null
  if (typeof exp !== 'number' || exp * 1000 <= nowMs) return null
  return { rid }
}

export async function hashIp(secret: string, ip: string | null): Promise<string | null> {
  return ip ? hmac(secret, 'mrn-ip', ip) : null
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6_RE = /^[0-9a-f:]{2,39}$/i

/**
 * Client IP for the per-IP rate limit (QA M-1).
 *
 * Supabase doesn't document a trusted client-IP header for Edge Functions.
 * Its gateway APPENDS the address it saw to X-Forwarded-For, so the leftmost
 * entries are whatever the caller sent and only the RIGHTMOST entry is set by
 * the platform. We use that one, and only if it's an IP literal.
 * CF-Connecting-IP, X-Real-IP and the leftmost XFF hop are ignored (they are
 * caller-controlled or undocumented). No usable IP -> null: the per-IP limit
 * is skipped and the per-email and global caps (in SQL) still apply, so
 * no-IP callers never share one bucket.
 */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for')
  if (!xff) return null
  const last = xff.split(',').map((s) => s.trim()).filter(Boolean).pop() || ''
  return IPV4_RE.test(last) || (IPV6_RE.test(last) && last.includes(':')) ? last.toLowerCase() : null
}

// ---------- validation ----------

/** Bidi overrides/isolates (U+202A-202E, U+2066-2069), LRM/RLM and C0/DEL controls. */
export const STRIP_RE = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

export function cleanText(v: string): string {
  return v.normalize('NFKC').replace(STRIP_RE, '').trim()
}

/** Length in code points (an emoji counts once; never split). */
export function cpLength(s: string): number {
  return [...s].length
}

class FieldError extends Error {
  constructor(public field: string, public reason: 'invalid' | 'too_long') {
    super(field)
  }
}

/** Cleaned string, or throws too_long / invalid (lone surrogates). Never truncates. */
function str(v: unknown, field: string, max = FIELD_MAX[field] ?? 80): string {
  if (typeof v !== 'string') return ''
  if (!v.isWellFormed()) throw new FieldError(field, 'invalid')
  const s = cleanText(v)
  if (cpLength(s) > max) throw new FieldError(field, 'too_long')
  return s
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** ASCII only after NFKC + lowercase: look-alike letters from other scripts and <>" are refused. */
export function isValidEmail(e: string): boolean {
  return e.length >= 6 && e.length <= 254 && EMAIL_RE.test(e)
}

export function normalizeEmail(v: string): string {
  return v.normalize('NFKC').trim().toLowerCase()
}

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

export type Step1 = { name: string; kind: Kind; email: string; state: string | null; zip: string | null }

export type ParseFail = { ok: false; field: string; reason: 'invalid' | 'too_long' }

export function parseStep1(body: Record<string, unknown>): { ok: true; value: Step1 } | ParseFail {
  try {
    const name = str(body.name, 'name')
    if (cpLength(name) < 2 || !HAS_LETTER_OR_DIGIT.test(name)) return { ok: false, field: 'name', reason: 'invalid' }
    const kind = str(body.kind, 'kind', 20).toLowerCase() as Kind
    if (!KINDS.includes(kind)) return { ok: false, field: 'kind', reason: 'invalid' }
    const email = normalizeEmail(str(body.email, 'email'))
    if (!isValidEmail(email)) return { ok: false, field: 'email', reason: 'invalid' }
    const state = str(body.state, 'state', 2).toUpperCase() || null
    if (state && !US_STATES.has(state)) return { ok: false, field: 'state', reason: 'invalid' }
    const zip = str(body.zip, 'zip', 10) || null
    if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) return { ok: false, field: 'zip', reason: 'invalid' }
    return { ok: true, value: { name, kind, email, state, zip } }
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, field: e.field, reason: e.reason }
    throw e
  }
}

function list(v: unknown, maxItems: number, maxLen: number, field: string): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []
  const out: string[] = []
  for (const item of raw) {
    const s = str(item, field, maxLen)
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s)
    if (out.length >= maxItems) break
  }
  return out
}

function count(v: unknown, max: number): string | undefined {
  const s = str(typeof v === 'number' ? String(v) : v, 'count', 6)
  return /^\d+$/.test(s) && Number(s) <= max ? String(Number(s)) : undefined
}

export function normalizeWebsite(v: unknown): string | null {
  const s = str(v, 'website')
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

function phoneOk(p: string): boolean {
  const digits = p.replace(/\D/g, '').length
  return /^[0-9+().\-\s]+(\s*(x|ext\.?)\s*\d{1,6})?$/i.test(p) && digits >= 7 && digits <= 20
}

/** Allow-listed step-2 fields. Anything else in the body is dropped here and again in SQL. */
export function parseStep2(body: Record<string, unknown>): { ok: true; fields: Record<string, unknown> } | ParseFail {
  try {
    const f: Record<string, unknown> = {}
    const contact = str(body.contact_name, 'contact_name')
    if (cpLength(contact) < 2 || !HAS_LETTER_OR_DIGIT.test(contact)) return { ok: false, field: 'contact_name', reason: 'invalid' }
    f.contact_name = contact
    for (const k of ['phone', 'alt_phone'] as const) {
      const p = str(body[k], k)
      if (p && !phoneOk(p)) return { ok: false, field: k, reason: 'invalid' }
      if (p) f[k] = p
    }
    if (str(body.website, 'website')) {
      const w = normalizeWebsite(body.website)
      if (!w) return { ok: false, field: 'website', reason: 'invalid' }
      f.website = w
    }
    for (const k of ['address', 'city', 'description', 'services_offered'] as const) {
      const s = str(body[k], k)
      if (s) f[k] = s
    }
    const state = str(body.state, 'state', 2).toUpperCase()
    if (state) {
      if (!US_STATES.has(state)) return { ok: false, field: 'state', reason: 'invalid' }
      f.state = state
    }
    const zip = str(body.zip, 'zip', 10)
    if (zip) {
      if (!/^\d{5}(-\d{4})?$/.test(zip)) return { ok: false, field: 'zip', reason: 'invalid' }
      f.zip = zip
    }
    f.brands = list(body.brands, 40, 80, 'brands')
    f.modalities = list(body.modalities, 40, 80, 'modalities')
    f.coverage = list(body.coverage, 60, 80, 'coverage')
    const y = count(body.years_in_business, 200)
    if (y) f.years_in_business = y
    const t = count(body.num_techs, 9999)
    if (t) f.num_techs = t
    const l = count(body.num_locations, 9999)
    if (l) f.num_locations = l
    return { ok: true, fields: f }
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, field: e.field, reason: e.reason }
    throw e
  }
}

export function honeypotTripped(body: Record<string, unknown>): boolean {
  const v = body[HONEYPOT_FIELD]
  return typeof v === 'string' ? v.trim() !== '' : v != null
}

/**
 * Turnstile is required when DIRECTORY_TURNSTILE_ENABLED is 'true' or '1'.
 * It fails closed: flag on with no TURNSTILE_SECRET_KEY, a missing/bad
 * token, a Cloudflare error or timeout all refuse step 1.
 */
export function turnstileEnabled(env: (k: string) => string | undefined): boolean {
  const v = String(env('DIRECTORY_TURNSTILE_ENABLED') || '').trim().toLowerCase()
  return v === 'true' || v === '1'
}

// ---------- review notice ----------

export const REVIEW_NOTICE_SUBJECT = 'New Medical Repair Network sign-up to review'
export const DEFAULT_REVIEW_URL = 'https://repairplanet.net/admin/god/directory'
export const DEFAULT_NOTICE_FROM = 'Medical Repair Network <contact@medicalrepairnetwork.com>'
/** Never send directory notices to Larry's personal admin inbox. */
export const FORBIDDEN_NOTICE_RECIPIENTS = ['larrysmart@gmail.com']

export function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const TYPE_LABEL: Record<string, string> = {
  service_company: 'Service and repair provider',
  parts_supplier: 'Parts supplier',
  laser_rental: 'Rental company',
  laser_clinic: 'Device owner or clinic',
}

export type NoticePayload = {
  company?: unknown
  org_type?: unknown
  contact_name?: unknown
  email?: unknown
  city?: unknown
  state?: unknown
  status?: unknown
  held_back?: unknown
}

export function reviewInbox(env: (k: string) => string | undefined): string | null {
  const v = String(env('DIRECTORY_REVIEW_INBOX') || '').trim().toLowerCase()
  if (!isValidEmail(v) || FORBIDDEN_NOTICE_RECIPIENTS.includes(v)) return null
  return v
}

export function buildReviewNotice(p: NoticePayload, reviewUrl: string) {
  const t = (v: unknown) => (typeof v === 'string' ? v.replace(STRIP_RE, '') : v)
  p = { ...p, company: t(p.company), contact_name: t(p.contact_name), email: t(p.email), city: t(p.city), state: t(p.state) }
  const line = (k: string, v: unknown) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${k}</td><td style="padding:4px 0">${escHtml(v || '—')}</td></tr>`
  const type = TYPE_LABEL[String(p.org_type)] || String(p.org_type || '')
  const where = [p.city, p.state].filter((x) => typeof x === 'string' && x).join(', ')
  const dup = p.status === 'possible_duplicate'
  const held = typeof p.held_back === 'number' && p.held_back > 0 ? p.held_back : 0
  const heldLine = held ? `${held} more sign-up${held === 1 ? '' : 's'} arrived while notices were paused (6 per hour max). They're on the review page.` : ''
  const url = /^https:\/\/[^\s"'<>]+$/.test(reviewUrl) ? reviewUrl : DEFAULT_REVIEW_URL
  const html =
    `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:560px">` +
    `<p>A company registered in the Medical Repair Network directory and is waiting for review.</p>` +
    (dup ? `<p><strong>Flagged as a possible duplicate of an existing company.</strong></p>` : '') +
    `<table>${line('Company', p.company)}${line('Type', type)}${line('Contact', p.contact_name)}${line('Email', p.email)}${line('City / state', where)}</table>` +
    (heldLine ? `<p>${escHtml(heldLine)}</p>` : '') +
    `<p>The email address has not been verified, and the details are as typed by the registrant.</p>` +
    `<p><a href="${escHtml(url)}">Open the review page</a></p></div>`
  const text =
    `A company registered in the Medical Repair Network directory and is waiting for review.\n` +
    (dup ? `Flagged as a possible duplicate of an existing company.\n` : '') +
    `\nCompany: ${String(p.company || '—')}\nType: ${type}\nContact: ${String(p.contact_name || '—')}\n` +
    `Email: ${String(p.email || '—')} (not verified)\nCity / state: ${where || '—'}\n` +
    (heldLine ? `\n${heldLine}\n` : '') + `\nReview: ${url}\n`
  return { subject: REVIEW_NOTICE_SUBJECT, html, text }
}
