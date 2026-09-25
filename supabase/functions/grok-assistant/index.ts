/**
 * grok-assistant
 *
 * Single-file raw.githubusercontent.com bootstrap of THIS file must boot even
 * when the isolate still has PR #129 sibling modules. Cite-scope helpers are
 * inlined (do not import ./collection-search.ts). manual-scope / xai-collection /
 * fault-codes stay relative — those files exist on the isolate from PR #129.
 *
 * Full folder deploy also works:
 *   supabase functions deploy grok-assistant --project-ref yljztfajyvjzqikxdddf
 *
 * Keep verify_jwt off. Soft beta — no ads.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  asManualId,
  excerptManualSearchText,
  folderPrefixForAiAttach,
  pdfPageCountFromBytes,
  pdfPathsForAiAttach,
  resolveManualFromCatalog,
  WHOLE_PDF_ATTACH_MAX_BYTES,
  wholePdfAttachAllowed,
  type PdfAttachStat,
} from './manual-scope.ts'
import { TSP_XAI_COLLECTION_ID, uploadPdfToTspCollection } from './xai-collection.ts'
import { extractFaultCodes } from './fault-codes.ts'
/**
 * INLINED from collection-search.ts for single-file raw-GitHub bootstrap.
 * Do not import ./collection-search.ts: a bootstrap that replaces only
 * index.ts leaves PR #129 siblings on the isolate. #131 named-imported
 * hasEnoughScopedIds / expectedFilenamesForPaths and the worker boot-crashed
 * (browser Failed to fetch immediately, no CORS). Keep collection-search.ts
 * in sync for unit tests.
 */

/**
 * Parse xAI Collections search + match hits to the selected manual.
 *
 * Live POST /v1/documents/search returns `{ matches: [{ chunk_content, file_id, fields }] }`.
 * PR #129 parsed that payload and resolved file_ids via the collection document
 * list, but `collectionNameFilters` included the brand token "cutera" and
 * `pickFileIdsForManual` accepted any `docMatchesManual` hit. That pulled
 * CoolGlide 15 (`Cutera CoolGlide Service Manual Complete.pdf`) into Xeo 105.
 * Scope to each folder’s Attached PDF names / file_ids only.
 * PR #130 listed every Attached filename serially (up to 8 GETs) then looked
 * up unnamed search hits one-by-one — that stacked with documents/search and
 * PDF attach and dropped the first Xeo 322 ask. Cap filters, compact-dedupe,
 * and treat one scoped file_id as enough.
 */

export type CollectionHit = {
  text: string
  source: string
  fileId: string
  page?: number
  section?: string
}

export type Retrieved = { text: string; source: string; page?: number; section?: string }

/** Heading-style section/chapter from a retrieved passage. */
export function extractSectionRef(text: string): string | undefined {
  const raw = String(text || '')
  const sect = raw.match(/\b(?:section|sect\.?|§)\s*([0-9]+(?:\.[0-9]+){0,3})\b/i)
  if (sect?.[1]) return sect[1]
  const ch = raw.match(/\b(?:ch(?:apter)?\.?)\s*([0-9]+(?:\.[0-9]+)?)\b/i)
  if (ch?.[1]) return `Ch.${ch[1]}`
  return undefined
}

/** First explicit page mention when xAI omits page_number. */
export function extractPageRef(text: string): number | undefined {
  const raw = String(text || '')
  const page = raw.match(/\b(?:pages?|pp?\.?)\s*(\d{1,4})\b/i)
  if (!page?.[1]) return undefined
  const n = Number(page[1])
  if (!Number.isFinite(n) || n < 1 || n > 9999) return undefined
  return Math.floor(n)
}

function hitPage(row: Record<string, unknown>, text = ''): number | undefined {
  const fields = row.fields && typeof row.fields === 'object' ? (row.fields as Record<string, unknown>) : {}
  for (const v of [row.page_number, row.page, fields.page_number, fields.page]) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0 && n < 10000) return Math.floor(n)
  }
  return extractPageRef(text)
}

function hitSection(row: Record<string, unknown>, text: string): string | undefined {
  const fields = row.fields && typeof row.fields === 'object' ? (row.fields as Record<string, unknown>) : {}
  for (const key of ['section', 'section_title', 'heading']) {
    const v = String(fields[key] ?? row[key] ?? '').trim()
    if (v) return v.slice(0, 80)
  }
  return extractSectionRef(text)
}

/** Storage basename with original case (Xeo Service Manual RevB.pdf). */
export function storageBasename(path: string): string {
  const s = String(path || '').replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

/** Same sanitizer attach-collection uses when uploading to xAI Files. */
export function collectionFilenameForPath(path: string): string {
  const base = storageBasename(path) || 'manual.pdf'
  return base.replace(/[^\w.\-]+/g, '_') || 'manual.pdf'
}

/** Storage + sanitized upload names for folder manuals (105 vs 15). */
export function expectedFilenamesForPaths(paths: string[]): string[] {
  const out: string[] = []
  for (const path of paths) {
    const base = storageBasename(path)
    const sanitized = collectionFilenameForPath(path)
    for (const n of [base, sanitized]) {
      if (n && !out.includes(n)) out.push(n)
    }
  }
  return out
}

export function compactDocKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** Full filename stems only — never "cutera" ⊆ "cuteracoolglide…". */
const NAME_ALIGN_MIN = 12

export function namesAlign(a: unknown, b: unknown): boolean {
  const na = compactDocKey(a)
  const nb = compactDocKey(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  return shorter.length >= NAME_ALIGN_MIN && longer.includes(shorter)
}

/** Cite the selected manual’s Attached PDF name, not a sibling collection title. */
export function displayAttachedName(source: string, expectedFilenames: string[] = []): string {
  const raw = String(source || '').trim()
  if (!raw) return ''
  for (const expected of expectedFilenames) {
    if (!namesAlign(expected, raw)) continue
    const base = storageBasename(expected)
    if (base) return base
  }
  return raw
}

const BRAND_TOKENS = new Set([
  'cutera',
  'candela',
  'cynosure',
  'lumenis',
  'sciton',
  'quanta',
  'coherent',
  'dornier',
  'syneron',
  'palomar',
  'hoyaconbio',
  'omniguide',
])

const GENERIC_TOKENS = new Set([
  'pdf',
  'manual',
  'service',
  'system',
  'shared',
  'operator',
  'section',
  'sect',
  'complete',
  'revb',
  'chapter',
  'error',
  'code',
  'codes',
  'table',
  'schematic',
  'schematics',
])

/** Sibling model markers — reject CoolGlide when Xeo 105 is selected. */
const FAMILY_MODEL_MARKERS = [
  'xeo',
  'coolglide',
  'excelv',
  'enlighten',
  'trusculpt',
  'limelight',
  'solera',
  'excelhr',
  'mpx',
]

export function docHasForeignModel(docName: string, tokens: string[]): boolean {
  const compact = compactDocKey(docName)
  if (!compact) return false
  const selected = new Set(tokens.map((t) => compactDocKey(t)).filter(Boolean))
  for (const model of FAMILY_MODEL_MARKERS) {
    if (!compact.includes(model)) continue
    if (selected.has(model) || [...selected].some((t) => t.includes(model))) continue
    return true
  }
  return false
}

export function documentNameFromFields(fields: unknown): string {
  if (!fields || typeof fields !== 'object') return ''
  const f = fields as Record<string, unknown>
  for (const key of ['name', 'filename', 'file_name', 'title', 'document_name', 'storage_path']) {
    const v = String(f[key] ?? '').trim()
    if (v) return v
  }
  return ''
}

function rowFileId(row: Record<string, unknown>): string {
  const meta = row.file_metadata
  if (meta && typeof meta === 'object') {
    const id = String((meta as { file_id?: unknown }).file_id || '').trim()
    if (id) return id
  }
  return String(row.file_id || row.fileId || row.id || '').trim()
}

function rowFileName(row: Record<string, unknown>): string {
  const meta = row.file_metadata
  if (meta && typeof meta === 'object') {
    const n = String((meta as { name?: unknown }).name || '').trim()
    if (n) return n
  }
  return (
    documentNameFromFields(row.fields) ||
    String(
      row.document_name ||
        row.filename ||
        row.name ||
        row.source ||
        (row.document && typeof row.document === 'object'
          ? (row.document as { name?: unknown }).name
          : '') ||
        row.file_name ||
        ''
    ).trim()
  )
}

function rowText(row: Record<string, unknown>): string {
  return String(row.chunk_content || row.text || row.content || row.chunk || row.passage || '').trim()
}

/** Accept the live xAI `matches` payload and older/aliased shapes. */
export function collectionHitsFromResponse(sd: unknown): CollectionHit[] {
  const obj = sd && typeof sd === 'object' ? (sd as Record<string, unknown>) : {}
  const rows = obj.matches || obj.results || obj.documents || obj.chunks || obj.data || []
  if (!Array.isArray(rows)) return []
  const out: CollectionHit[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const text = rowText(row)
    if (text.length <= 20) continue
    const page = hitPage(row, text)
    const section = hitSection(row, text)
    out.push({
      text,
      source: rowFileName(row),
      fileId: rowFileId(row),
      ...(page ? { page } : {}),
      ...(section ? { section } : {}),
    })
  }
  return out
}

export function applyFileNameMap(hits: CollectionHit[], names: Record<string, string>): CollectionHit[] {
  return hits.map((h) => {
    if (h.source) return h
    const mapped = h.fileId ? names[h.fileId] : ''
    return mapped ? { ...h, source: mapped } : h
  })
}

export function fileIdNameMapFromDocuments(docs: unknown): Record<string, string> {
  const rows = Array.isArray(docs)
    ? docs
    : docs && typeof docs === 'object'
      ? (docs as { documents?: unknown[] }).documents || []
      : []
  const map: Record<string, string> = {}
  if (!Array.isArray(rows)) return map
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = rowFileId(row)
    const name = rowFileName(row)
    if (id && name) map[id] = name
  }
  return map
}

const CHAPTER_KEY_STOP = new Set([...GENERIC_TOKENS, ...BRAND_TOKENS])

export function chapterFileKeys(chapters: Array<{ storage_path?: unknown; title?: unknown }> | null | undefined): string[] {
  const out: string[] = []
  for (const c of chapters || []) {
    const sp = String(c?.storage_path || '')
    const title = String(c?.title || '')
    const base = sp.replace(/\\/g, '/').split('/').pop() || ''
    const stem = base.replace(/\.pdf$/i, '')
    if (stem.length >= 6) out.push(stem)
    const noRev = stem.replace(/_[a-z0-9]+$/i, '')
    if (noRev.length >= 8 && !out.includes(noRev)) out.push(noRev)
    for (const t of `${sp} ${title}`.toLowerCase().split(/[\s_/.\-]+/)) {
      const x = t.replace(/[^a-z0-9+]/g, '')
      if (x.length >= 5 && !CHAPTER_KEY_STOP.has(x) && !out.includes(x)) out.push(x)
    }
  }
  return out
}

function isWeakToken(token: string): boolean {
  const t = compactDocKey(token)
  return !t || t.length < 4 || BRAND_TOKENS.has(t) || GENERIC_TOKENS.has(t)
}

export function docMatchesManual(docName: string, tokens: string[], chapterKeys: string[] = []): boolean {
  if (!docName) return false
  if (docHasForeignModel(docName, tokens)) return false
  const n = docName.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const compact = n.replace(/\s+/g, '')
  const base = compactDocKey((docName.replace(/\\/g, '/').split('/').pop() || '').replace(/\.pdf$/i, ''))
  for (const k of chapterKeys) {
    const ck = compactDocKey(k)
    if (ck.length < NAME_ALIGN_MIN) continue
    if (base.includes(ck) || compact.includes(ck)) return true
    if (base.length >= NAME_ALIGN_MIN && ck.includes(base)) return true
  }
  const distinctive = tokens.filter((t) => !isWeakToken(t) && (n.includes(t) || compact.includes(t)))
  if (distinctive.length >= 1) return true
  let hits = 0
  for (const t of tokens) {
    if (isWeakToken(t)) continue
    if (n.includes(t) || compact.includes(t)) hits++
  }
  if (hits >= 2) return true
  return false
}

export function pickFileIdsForManual(
  nameById: Record<string, string>,
  expectedFilenames: string[],
  tokens: string[],
  chapterKeys: string[]
): Set<string> {
  const ids = new Set<string>()
  const expected = expectedFilenames.filter(Boolean)
  const entries = Object.entries(nameById)
  if (expected.length) {
    for (const [id, name] of entries) {
      if (expected.some((e) => namesAlign(e, name))) ids.add(id)
    }
    // Short stems such as CO2RE.pdf compact to under NAME_ALIGN_MIN, so they
    // only exact-match. When nothing aligned, use model/manufacturer tokens.
    // Skip that fallback once a filename hit exists — Xeo's Attached names
    // must not also pull CoolGlide in via a loose token.
    if (ids.size) return ids
  }
  for (const [id, name] of entries) {
    if (docMatchesManual(name, tokens, chapterKeys)) ids.add(id)
  }
  return ids
}

export function filterHitsForManual(
  hits: CollectionHit[],
  opts: {
    tokens: string[]
    chapterKeys: string[]
    fileIds?: Set<string>
    expectedFilenames?: string[]
    requireMatch: boolean
  }
): { parts: CollectionHit[]; filteredOut: number } {
  if (!opts.requireMatch) {
    return { parts: hits.slice(0, 12), filteredOut: 0 }
  }
  const expected = (opts.expectedFilenames || []).filter(Boolean)
  if (opts.fileIds && opts.fileIds.size) {
    const matched = hits.filter((h) => h.fileId && opts.fileIds!.has(h.fileId))
    if (matched.length) {
      return { parts: matched.slice(0, 12), filteredOut: hits.length - matched.length }
    }
  }
  const named = expected.length
    ? hits.filter((p) => expected.some((e) => namesAlign(e, p.source)))
    : []
  if (named.length) {
    return { parts: named.slice(0, 12), filteredOut: hits.length - named.length }
  }
  // No filename hit (short CO2RE.pdf vs a longer collection name): model tokens.
  // Foreign-model markers still reject CoolGlide when Xeo is selected.
  const tokenMatched = hits.filter((p) => docMatchesManual(p.source, opts.tokens, opts.chapterKeys))
  if (tokenMatched.length) {
    return { parts: tokenMatched.slice(0, 12), filteredOut: hits.length - tokenMatched.length }
  }
  return { parts: [], filteredOut: hits.length }
}

export function retrievedFromHits(hits: CollectionHit[], expectedFilenames: string[] = []): Retrieved[] {
  return hits.map((h) => {
    const name = displayAttachedName(h.source || 'manual', expectedFilenames)
    const page = h.page && h.page > 0 ? h.page : undefined
    const section = h.section || extractSectionRef(h.text)
    const loc = [page ? `p.${page}` : '', section ? `§${section}` : ''].filter(Boolean).join(' ')
    return {
      text: h.text,
      source: loc ? `${name} ${loc}` : name,
      ...(page ? { page } : {}),
      ...(section ? { section } : {}),
    }
  })
}

export type ManualCitation = {
  manualId: number
  title?: string
  page?: number
  section?: string
}

export function embedCitationMarker(c: ManualCitation): string {
  const qs = new URLSearchParams()
  qs.set('id', String(c.manualId))
  if (c.page) qs.set('p', String(c.page))
  if (c.section) qs.set('s', String(c.section).slice(0, 80))
  if (c.title) qs.set('t', String(c.title).slice(0, 80))
  return `[[cite:${qs.toString()}]]`
}

export function citationsFromParts(
  parts: Retrieved[],
  manualId: number | null,
  fallbackTitle: string
): ManualCitation[] {
  if (manualId == null || manualId < 1) return []
  const out: ManualCitation[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const page = p.page && p.page > 0 ? p.page : extractPageRef(p.text)
    const section = p.section || extractSectionRef(p.text)
    const key = `${page || ''}|${section || ''}|${p.source}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      manualId,
      title: fallbackTitle || p.source,
      ...(page ? { page } : {}),
      ...(section ? { section } : {}),
    })
  }
  if (!out.length) out.push({ manualId, title: fallbackTitle })
  return out.slice(0, 8)
}

export function formatCitationLine(citations: ManualCitation[], fallback = ''): string {
  if (!citations.length) return fallback ? `\n\n— Source: ${fallback}` : ''
  const labels = [...new Set(citations.map((c) => {
    let s = c.title || 'Selected manual'
    if (c.page) s += `, p.${c.page}`
    if (c.section) s += `, §${c.section}`
    return s
  }))]
  const markers = citations.map((c) => embedCitationMarker(c)).join(' ')
  return `\n\n— Source: ${labels.join('; ')}\n${markers}`
}

/** Upgrade document-level cites when the model names "page N". */
export function attachProsePages(citations: ManualCitation[], text: string): ManualCitation[] {
  if (!citations.length) return []
  const pages: number[] = []
  const seen = new Set<number>()
  const re = /\b(?:pages?|pp?\.?)\s*(\d{1,4})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(String(text || '')))) {
    const n = Number(m[1])
    if (!Number.isFinite(n) || n < 1 || n > 9999 || seen.has(n)) continue
    seen.add(n)
    pages.push(Math.floor(n))
  }
  if (!pages.length) return citations
  const scoped = citations[0]
  const out = citations.map((c, i) => (c.page ? c : { ...c, page: pages[i] || pages[0] }))
  const have = new Set(out.map((c) => c.page).filter((p): p is number => !!p))
  for (const page of pages) {
    if (have.has(page)) continue
    out.push({ manualId: scoped.manualId, title: scoped.title, page })
    have.add(page)
  }
  return out.slice(0, 8)
}

export function preferServiceManualName(name: string): boolean {
  const n = String(name || '').toLowerCase()
  if (/schem|wiring|electrical|exploded/.test(n)) return false
  return /service|manual|rev/.test(n)
}

/** One scoped file_id is enough to keep Xeo hits and drop CoolGlide. */
export function hasEnoughScopedIds(fileIds: Set<string> | undefined | null): boolean {
  return !!fileIds && fileIds.size > 0
}

/** Max name-filter GETs — serial listing of every Attached filename times out the edge. */
export const COLLECTION_NAME_FILTER_MAX = 3

/** Distinctive name filters for GET /collections/{id}/documents?filter=name:"…" */
export function collectionNameFilters(expectedFilenames: string[], tokens: string[] = []): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const s = String(raw || '')
      .replace(/\.pdf$/i, '')
      .replace(/_/g, ' ')
      .trim()
    if (s.length < 3) return
    const key = compactDocKey(s)
    if (!key || BRAND_TOKENS.has(key) || seen.has(key)) return
    seen.add(key)
    out.push(s)
  }
  // Storage + sanitized stems collapse after '_' → space; prefer the service book.
  const names = [...expectedFilenames].sort((a, b) => {
    const as = preferServiceManualName(a) ? 1 : 0
    const bs = preferServiceManualName(b) ? 1 : 0
    return bs - as || String(b).length - String(a).length
  })
  for (const name of names) push(name)
  // Never add brand tokens (name:"cutera" lists CoolGlide 15 into a Xeo 105 resolve).
  if (!expectedFilenames.length) {
    for (const t of tokens) {
      if (!isWeakToken(t) && t.length <= 24) push(t)
    }
  }
  return out.slice(0, COLLECTION_NAME_FILTER_MAX)
}

export function collectionSearchBody(query: string, collectionId: string, mode: 'hybrid' | 'keyword' = 'hybrid') {
  return {
    query,
    source: { collection_ids: [collectionId] },
    retrieval_mode: { type: mode },
    limit: 20,
    max_num_results: 20,
  }
}

/** Pick collection file_ids to attach (service book first; schematics when asked). */
export function pickCollectionAttachments(
  nameById: Record<string, string>,
  selectedIds: Set<string>,
  schematic: boolean,
  limit = 2
): Array<{ fileId: string; name: string }> {
  const rows = [...selectedIds]
    .map((fileId) => ({ fileId, name: nameById[fileId] || fileId }))
    .sort((a, b) => {
      const as = preferServiceManualName(a.name) ? 1 : 0
      const bs = preferServiceManualName(b.name) ? 1 : 0
      if (schematic) return as - bs
      return bs - as
    })
  return rows.slice(0, schematic ? Math.max(limit, 2) : limit)
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TSP_COLLECTION_ID = TSP_XAI_COLLECTION_ID

/** Keep xAI listing/search inside the edge/client window (PR #130 serial GETs hung). */
const FETCH_MS = {
  list: 4000,
  lookup: 3000,
  search: 12000,
  resolve: 6500,
  model: 22000,
}

const COLLECTION_DOCS_TTL_MS = 5 * 60 * 1000
let collectionDocsCache: { at: number; map: Record<string, string>; complete: boolean } | null = null

function cachedCollectionDocs(): Record<string, string> {
  if (collectionDocsCache && Date.now() - collectionDocsCache.at < COLLECTION_DOCS_TTL_MS) {
    return { ...collectionDocsCache.map }
  }
  return {}
}

function rememberCollectionDocs(map: Record<string, string>, complete = false) {
  if (!map || !Object.keys(map).length) return
  const prevCache = collectionDocsCache
  const fresh = !!(prevCache && Date.now() - prevCache.at < COLLECTION_DOCS_TTL_MS)
  const prev = fresh && prevCache ? prevCache.map : {}
  collectionDocsCache = {
    at: Date.now(),
    map: { ...prev, ...map },
    complete: complete || !!(fresh && prevCache && prevCache.complete),
  }
}

function abortAfter(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  return {
    signal: ac.signal,
    cancel: () => clearTimeout(t),
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const { signal, cancel } = abortAfter(timeoutMs)
  try {
    return await fetch(url, { ...init, signal })
  } catch (e) {
    console.warn('fetch timeout/error', url, e)
    return null
  } finally {
    cancel()
  }
}

async function withBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: number | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        t = setTimeout(() => resolve(fallback), ms) as unknown as number
      }),
    ])
  } finally {
    if (t) clearTimeout(t)
  }
}

const LIMITS: Record<string, { text: number; voice: number }> = {
  free: { text: 5, voice: 1 },
  premium: { text: 50, voice: 10 },
  team: { text: 50, voice: 10 },
  enterprise: { text: 50, voice: 10 },
}

const FSE_SYSTEM_PROMPT = `You are Zapp, an AI assistant for Total Service Pro (TSP), helping licensed Laser Service Engineers with laser and aesthetic medical equipment.

## RULES
- NEVER add generic "contact the manufacturer" or patient-safety disclaimer fluff.
- Search the selected SERVICE MANUAL first — not a separate error-code document.
- When RETRIEVED MANUAL CONTENT is provided: that is AUTHORITATIVE for fault meaning, cause, remedy, and procedures. Answer from those passages. Quote specs, steps, values, and section/page references when present.
- When ATTACHED MANUAL PDFs are provided: those files ARE the selected manual and they are readable. Read them, quote exact wording, and interpret schematic/wiring/exploded drawings (component IDs, connector pins, nets, voltages, callouts). Only if a specific page or drawing is blank after you open it, say that page is unreadable and name the PDF — never claim the attached service manual is unavailable.
- When FAULT CODE LOOKUP RESULT is provided: it is FALLBACK ONLY (thin manuals / no usable passages). You MAY mention it as a short cross-check if it agrees with the manual, but never override the selected service manual.
- If the passages/PDFs do not contain enough information: say what is missing and what section to open in the selected manual — do NOT invent PM steps, calibrations, parts lists, or specs.
- When a SELECTED MANUAL is set, answers must be about that device unless the user clearly names a different one.
- Prefer depth for service work: numbered steps, torque/spec values, prerequisites, expected readings, common pitfalls — but only when supported by sources.
- When you name a page or section of the selected manual, write it as "page N" or "section X.Y" (the app deep-links those into the in-app viewer).
- End every answer with: — Source: [source name]`

const ZAPP_VOICE_PROMPT = `You are Zapp, the AI inside Total Service Pro — with brief Zapp Brannigan flair, still technically accurate.

## RULES
- Search the selected service manual first, not a separate error-code document.
- RETRIEVED MANUAL CONTENT / ATTACHED MANUAL PDFs = AUTHORITATIVE for fault meaning, cause, remedy, and procedures. Never fabricate.
- FAULT CODE LOOKUP RESULT = fallback only when the selected manual had no usable passages. Never override the manual; optional short cross-check if it agrees.
- If sources are empty or off-topic: admit it briefly and ask a clarifying question. Do not invent.
- Spoken: 4-7 sentences. No markdown.
- End with: — Source: [source name]

## STYLE
One short Zapp-ism, then the technical answer.`

const VOICE_PROMPT_PLAIN = `You are Zapp, an AI for Total Service Pro. Spoken: 4-7 sentences, no markdown. RETRIEVED MANUAL CONTENT / attached PDFs are authoritative. FAULT CODE LOOKUP RESULT is fallback only. Never fabricate. If sources insufficient, say so. End with: — Source: [source name].`

async function logUsage(s: any, uid: string, t: string, n: number) {
  try {
    await s.from('api_usage').insert({ user_id: uid, request_type: t, tokens_used: n })
  } catch (_e) {}
}

async function getDailyUsage(s: any, uid: string): Promise<{ text: number; voice: number }> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { data } = await s
    .from('api_usage')
    .select('request_type')
    .eq('user_id', uid)
    .gte('created_at', today.toISOString())
  const rows = data || []
  return {
    text: rows.filter((r: any) => r.request_type === 'grok_chat').length,
    voice: rows.filter((r: any) => r.request_type === 'grok_tts').length,
  }
}

const ALIASES: [string[], string][] = [
  [['vbeam2', 'vbeam 2', 'perfecta', 'aesthetica', 'platinum'], 'New Vbeam'],
  [['vbeam'], 'New Vbeam'],
  [['vpyag', 'vp yag', 'vp-yag', 'pvyag', 'mgy', 'mini gentleyag', 'minigentleyag', 'mini gentle yag'], 'New GentleYAG'],
  [['gentleyag', 'gentle yag'], 'New GentleYAG'],
  [['gentlemax pro plus'], 'GentleMAX Pro Plus'],
  [['gentlemax pro'], 'GentleMAX Pro'],
  [['gentlemax'], 'GentleMAX'],
  [['mini gentlelase', 'mgl'], 'MGL'],
  [['gentlelase le', 'limited edition'], 'GentleLASE LE'],
  [['gentlelase+', 'gentlelase plus'], 'GentleLASE+'],
  [['gentlelase'], 'GentleLASE'],
  [['alexlazr', 'alex lazr'], 'AlexLAZR'],
  [['alex trivantage', 'trivantage'], 'Alex TriVantage'],
  [['cbeam', 'c-beam'], 'Cbeam'],
  [['smoothbeam'], 'SmoothBeam'],
  [['versapulse powersuite', 'power suite'], 'VersaPulse PowerSuite'],
  [['versapulse select ii', 'select ii'], 'VersaPulse Select II'],
  [['versapulse select'], 'VersaPulse Select'],
  [['versapulse'], 'VersaPulse Select'],
  [['ultrapulse encore', 'encore'], 'UltraPulse Encore'],
  [['ultrapulse'], 'UltraPulse Encore'],
  [['pulse 100h', 'p100h', 'pulse 50h', 'p50h'], 'Pulse 100H/50H'],
  [['cyber ho 100', 'litho 100', 'cyber ho 150', 'litho 150'], 'Cyber Ho 100 / Litho 100'],
  [['cyber ho 60', 'litho 60', 'cyber ho'], 'Cyber Ho / Litho 60'],
  [['litho dk30'], 'Litho DK30'],
  [['litho pvms'], 'Litho PVMS'],
  [['cyber thulium'], 'Cyber Thulium'],
  [['litho'], 'Cyber Ho / Litho 60'],
  [['medlite'], 'Medlite C6'],
  [['beacon'], 'Beacon'],
  [['c-las', 'clas', 'intelliguide', 'fels'], 'C-LAS'],
]

function aliasToModel(s: string): string | null {
  if (!s) return null
  const l = s.toLowerCase()
  for (const [terms, model] of ALIASES) {
    if (terms.some((t) => l.includes(t))) return model
  }
  return null
}

function extractBrand(text: string): string | null {
  const t = text.toLowerCase()
  if (t.includes('candela')) return 'Candela'
  if (t.includes('lumenis')) return 'Lumenis'
  if (t.includes('coherent')) return 'Coherent/Lumenis'
  if (t.includes('quanta')) return 'Quanta System'
  if (t.includes('hoya') || t.includes('conbio')) return 'Hoya ConBio'
  if (t.includes('omniguide')) return 'OmniGuide'
  if (t.includes('sciton')) return 'Sciton'
  if (t.includes('cynosure')) return 'Cynosure'
  if (t.includes('cutera')) return 'Cutera'
  return null
}

function basenamePath(p: string): string {
  const s = String(p || '').replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  return (i >= 0 ? s.slice(i + 1) : s).toLowerCase()
}

async function listFolderPdfs(db: any, prefix: string, depth = 0): Promise<string[]> {
  const { data, error } = await db.storage.from('manuals').list(prefix, { limit: 80, offset: 0 })
  if (error || !data) return []
  const out: string[] = []
  for (const obj of data) {
    const name = String(obj.name || '').trim()
    if (!name || name === '.emptyFolderPlaceholder') continue
    const full = `${prefix}/${name}`.replace(/\/{2,}/g, '/')
    if (/\.pdf$/i.test(name)) out.push(full)
    else if (depth < 1 && !obj.id) {
      const nested = await listFolderPdfs(db, full, depth + 1)
      out.push(...nested)
    }
    if (out.length >= 8) break
  }
  return out.slice(0, 8)
}

function extraManualAliases(manual: {
  title?: string
  model?: string
  storage_path?: string
  label?: string
}): string[] {
  const blob = `${manual.title || ''} ${manual.model || ''} ${manual.storage_path || ''} ${manual.label || ''}`.toLowerCase()
  const extra: string[] = []
  if (/vpyag|vp[\s\-]?yag|pvyag|mgy|mini\s*gentle\s*yag/.test(blob)) {
    extra.push('vpyag', 'pvyag', 'minigentleyag', 'mgy', 'gentleyag')
  }
  if (/gentlemax/.test(blob)) extra.push('gentlemax', 'gmax')
  if (/\bmgl\b|mini\s*gentle\s*lase/.test(blob)) extra.push('mgl', 'minigentlelase', 'gentlelase')
  return extra
}

function manualMatchTokens(manual: {
  title?: string
  brand?: string
  storage_path?: string
  label?: string
  model?: string
}): string[] {
  const raw = [manual.title || '', manual.brand || '', manual.storage_path || '', manual.label || '', manual.model || '']
    .join(' ')
    .toLowerCase()
  const parts = raw
    .split(/[\s_/.\-]+/)
    .map((t) => t.replace(/[^a-z0-9+]/g, ''))
    .filter((t) => t.length >= 3)
  const stop = new Set([
    'pdf',
    'manual',
    'service',
    'the',
    'and',
    'for',
    'with',
    'laser',
    'system',
    'shared',
    'operator',
    'section',
    'sect',
  ])
  const out: string[] = []
  for (const t of [...parts, ...extraManualAliases(manual)]) {
    if (stop.has(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out
}

function isSchematicQuery(text: string): boolean {
  return /\b(schematic|schematics|wiring|diagram|drawing|exploded|pcb|board\s*layout|electrical\s*drawing|block\s*diagram|interconnect)\b/i.test(
    text || ''
  )
}

function pickRelevantChapters(chapters: any[], userText: string, schematic: boolean, entryPath: string): any[] {
  const list = Array.isArray(chapters) ? chapters : []
  if (!list.length) return []
  const q = (userText || '').toLowerCase()
  const terms = q
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !['what', 'does', 'this', 'from', 'with', 'that', 'have', 'show', 'tell'].includes(t))
  const scored = list.map((c) => {
    const hay = `${c.title || ''} ${c.storage_path || ''}`.toLowerCase()
    let s = 0
    for (const t of terms) if (hay.includes(t)) s += 3
    if (schematic && /sect\s*4|section\s*4|schem|wiring|electrical|exploded|diagram|drawing/.test(hay)) s += 6
    if (schematic && /8501-02-1769/.test(hay)) s += 12
    if (/8501-01-1769/.test(hay)) s += 8
    if (/8501-00-1770/.test(hay)) s += 3
    if (/\b(fault|error|alarm|code)\b/.test(q) && /service/.test(hay) && !/schem|wiring/.test(hay)) s += 6
    if (
      /engl|english/.test(hay) &&
      /operator/.test(hay) &&
      !/germ|span|dutc|fren|ital|rusn|czec|korean|dutch|german|french|spanish|italian/.test(hay)
    )
      s += 4
    if (entryPath && String(c.storage_path || '').replace(/\\/g, '/') === entryPath.replace(/\\/g, '/')) s += 5
    if (/op manuals|operator/.test(hay) && /germ|span|dutc|fren|ital|rusn|czec/.test(hay)) s -= 4
    return { c, s }
  })
  scored.sort((a, b) => b.s - a.s)
  const picked: any[] = []
  const seen = new Set<string>()
  const push = (c: any) => {
    const p = String(c?.storage_path || '')
    if (!p || seen.has(p)) return
    seen.add(p)
    picked.push(c)
  }
  const entry = list.find(
    (c) => String(c.storage_path || '').replace(/\\/g, '/') === String(entryPath || '').replace(/\\/g, '/')
  )
  if (entry) push(entry)
  for (const row of scored) {
    if (picked.length >= (schematic ? 4 : 3)) break
    if (row.s <= 0 && picked.length) continue
    push(row.c)
  }
  return picked.slice(0, schematic ? 4 : 3)
}

function objectByteSize(row: { metadata?: { size?: unknown; contentLength?: unknown }; size?: unknown } | null): number | null {
  const meta = row?.metadata || {}
  const n = Number(meta.size ?? meta.contentLength ?? row?.size)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function readStorageRange(
  path: string,
  range: string
): Promise<{ bytes: Uint8Array; total: number | null } | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !key) return null
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/manuals/${encoded}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key, Range: range },
    })
    if (!res.ok && res.status !== 206) return null
    const totalHeader = res.headers.get('content-range') || ''
    const total = Number(totalHeader.split('/')[1])
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      total: Number.isFinite(total) && total > 0 ? total : null,
    }
  } catch (e) {
    console.warn('pdf range read failed', path, e)
    return null
  }
}

/** Size from Storage metadata, page count from a small head/tail window. */
async function statManualPdf(db: any, path: string): Promise<PdfAttachStat> {
  const clean = String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^manuals\//i, '')
  const slash = clean.lastIndexOf('/')
  const dir = slash >= 0 ? clean.slice(0, slash) : ''
  const name = slash >= 0 ? clean.slice(slash + 1) : clean
  let bytes: number | null = null
  try {
    const { data } = await db.storage.from('manuals').list(dir, { limit: 100, search: name })
    const row = (data || []).find((obj: { name?: string }) => obj.name === name)
    bytes = objectByteSize(row)
  } catch (e) {
    console.warn('pdf stat failed', clean, e)
  }
  if (bytes != null && bytes > WHOLE_PDF_ATTACH_MAX_BYTES) return { bytes, pages: null }
  let pages: number | null = null
  const head = await readStorageRange(clean, 'bytes=0-262143')
  if (head) {
    if (bytes == null && head.total != null) bytes = head.total
    pages = pdfPageCountFromBytes(head.bytes)
    if (!pages && head.total != null && head.total > head.bytes.length) {
      const start = Math.max(0, head.total - 262144)
      const tail = await readStorageRange(clean, `bytes=${start}-${head.total - 1}`)
      if (tail) pages = pdfPageCountFromBytes(tail.bytes)
    }
  }
  if (bytes != null && bytes > WHOLE_PDF_ATTACH_MAX_BYTES) return { bytes, pages }
  return { bytes, pages }
}

async function signStoragePdf(path: string): Promise<string | null> {
  const clean = String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^manuals\//i, '')
  if (!clean.toLowerCase().endsWith('.pdf')) return null
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const encoded = clean.split('/').map(encodeURIComponent).join('/')
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/manuals/${encoded}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    })
    const j = await res.json().catch(() => ({}))
    const signed = j.signedURL || j.signedUrl || j.url
    if (!signed) {
      console.warn('sign failed', clean, res.status, JSON.stringify(j).slice(0, 200))
      return null
    }
    if (/^https?:\/\//i.test(signed)) return signed
    return `${supabaseUrl}${signed.startsWith('/') ? '' : '/'}${signed}`
  } catch (e) {
    console.warn('sign error', clean, e)
    return null
  }
}

function textFromResponses(data: any): string {
  if (!data) return ''
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text
  const bits: string[] = []
  for (const item of data.output || data.choices || []) {
    const content = item.content || item.message?.content
    if (typeof content === 'string') bits.push(content)
    else if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c === 'string') bits.push(c)
        else if (c?.type === 'output_text' || c?.type === 'text') bits.push(c.text || c.output_text || '')
      }
    }
  }
  return bits.join('\n').trim()
}

async function lookupFaultCode(
  db: any,
  faultCode: string,
  model: string | null,
  brand: string | null
): Promise<{ rows: any[]; source: string } | null> {
  if (model) {
    const r1 = await db.from('fault_codes').select('*').eq('fault_code', faultCode).ilike('model', `%${model}%`)
    if (r1.data?.length > 0) return { rows: r1.data, source: 'exact' }
    const r2 = await db.from('fault_codes').select('*').eq('fault_code', faultCode).ilike('model_group', `%${model}%`)
    if (r2.data?.length > 0) return { rows: r2.data, source: 'group' }
  }
  if (brand) {
    const r3 = await db.from('fault_codes').select('*').eq('fault_code', faultCode).ilike('brand', `%${brand}%`)
    if (r3.data?.length > 0) return { rows: r3.data, source: 'brand' }
  }
  const r4 = await db.from('fault_codes').select('*').eq('fault_code', faultCode)
  if (r4.data?.length === 1) return { rows: r4.data, source: 'generic_single' }
  if (r4.data?.length > 1) return { rows: r4.data, source: 'ambiguous' }
  return null
}

function formatFaultContext(rows: any[], source: string, model: string | null, manualLabel: string): string {
  if (source === 'ambiguous') {
    const target = model || aliasToModel(manualLabel)
    if (target) {
      const filtered = rows.filter(
        (r) =>
          r.model.toLowerCase().includes(target.toLowerCase()) ||
          (r.model_group && r.model_group.toLowerCase().includes(target.toLowerCase()))
      )
      if (filtered.length > 0) return formatFaultContext(filtered, 'exact', model, manualLabel)
    }
    const hint = manualLabel
      ? `The technician has "${manualLabel}" selected. Answer ONLY for that device.`
      : 'No device selected. Ask which device the technician is working on.'
    const lines = rows.map(
      (r) => `Device: ${r.brand} ${r.model}\nFault ${r.fault_code}: ${r.fault_title}\n${r.description || ''}\n${r.remedy || ''}`
    )
    return (
      `\n\n## FAULT CODE LOOKUP RESULT (fallback — multiple devices match)\n${hint}\n\n${lines.join('\n---\n')}` +
      `\n\nIMPORTANT: This table is an offline fallback, not a substitute for the selected service manual. If RETRIEVED MANUAL CONTENT or ATTACHED MANUAL PDFs are present, those win. Do not invent codes or causes.`
    )
  }

  const qualifier =
    source === 'exact'
      ? '(verified match for selected device)'
      : source === 'group'
        ? '(model family match)'
        : source === 'brand'
          ? '(same brand — verify model)'
          : '(only device with this code)'

  const lines = rows.map((r) => {
    let s = `Device: ${r.brand} ${r.model}\nFault ${r.fault_code}: ${r.fault_title}\n`
    if (r.description) s += `Description: ${r.description}\n`
    if (r.probable_cause) s += `Probable Cause: ${r.probable_cause}\n`
    if (r.remedy) s += `Remedy: ${r.remedy}\n`
    if (r.manual_ref) s += `Reference: ${r.manual_ref}\n`
    return s
  })
  return (
    `\n\n## FAULT CODE LOOKUP RESULT ${qualifier} (fallback — selected service manual had no usable passages)\n` +
    lines.join('\n---\n') +
    `\n\nIMPORTANT: This table is an offline fallback, not a substitute for the selected service manual. If RETRIEVED MANUAL CONTENT or ATTACHED MANUAL PDFs are present, those win. Do not invent codes or causes.`
  )
}

function buildSearchQuery(userText: string, manualLabel: string, faultCodes: string[] | string | null): string {
  let q = (manualLabel ? manualLabel + ' ' : '') + userText.trim()
  const codes = Array.isArray(faultCodes) ? faultCodes : faultCodes ? [faultCodes] : []
  for (const code of codes) {
    q += ` fault code ${code} error ${code}`
  }
  if (/\b(pm|preventive|maintenance|calibrat|align|fluence|energy|water|coolant|dye|flashlamp)\b/i.test(q)) {
    q += ' procedure specification steps'
  }
  return q.substring(0, 500)
}

async function listCollectionDocumentsByName(
  managementKey: string,
  nameQuery: string
): Promise<Record<string, string>> {
  const filter = `name:"${String(nameQuery).replace(/"/g, '')}"`
  const url =
    `https://management-api.x.ai/v1/collections/${TSP_COLLECTION_ID}/documents` +
    `?limit=50&filter=${encodeURIComponent(filter)}`
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${managementKey}` } }, FETCH_MS.list)
    if (!res?.ok) {
      console.warn('list collection documents failed', res?.status ?? 'timeout', nameQuery)
      return {}
    }
    const map = fileIdNameMapFromDocuments(await res.json())
    rememberCollectionDocs(map)
    return map
  } catch (e) {
    console.warn('list collection documents error', nameQuery, e)
    return {}
  }
}

/** One unfiltered page — local pickFileIds keeps Xeo vs CoolGlide without N name GETs. */
async function listCollectionDocumentsAll(managementKey: string): Promise<Record<string, string>> {
  if (
    collectionDocsCache?.complete &&
    Date.now() - collectionDocsCache.at < COLLECTION_DOCS_TTL_MS
  ) {
    return { ...collectionDocsCache.map }
  }
  const url = `https://management-api.x.ai/v1/collections/${TSP_COLLECTION_ID}/documents?limit=100`
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${managementKey}` } }, FETCH_MS.list)
    if (!res?.ok) {
      console.warn('list collection documents (all) failed', res?.status ?? 'timeout')
      return {}
    }
    const map = fileIdNameMapFromDocuments(await res.json())
    rememberCollectionDocs(map, true)
    return map
  } catch (e) {
    console.warn('list collection documents (all) error', e)
    return {}
  }
}

async function lookupCollectionFileName(
  managementKey: string,
  fileId: string,
  apiKey?: string
): Promise<string> {
  if (!fileId) return ''
  try {
    const res = await fetchWithTimeout(
      `https://management-api.x.ai/v1/collections/${TSP_COLLECTION_ID}/documents/${fileId}`,
      { headers: { Authorization: `Bearer ${managementKey}` } },
      FETCH_MS.lookup
    )
    if (res?.ok) {
      const map = fileIdNameMapFromDocuments([await res.json()])
      if (map[fileId]) {
        rememberCollectionDocs(map)
        return map[fileId]
      }
    }
  } catch {
    /* try files API */
  }
  if (!apiKey) return ''
  try {
    const fr = await fetchWithTimeout(
      `https://api.x.ai/v1/files/${fileId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      FETCH_MS.lookup
    )
    if (!fr?.ok) return ''
    const j = (await fr.json()) as { filename?: string; name?: string }
    const name = String(j.filename || j.name || '').trim()
    if (name) rememberCollectionDocs({ [fileId]: name })
    return name
  } catch {
    return ''
  }
}

function scopedIdsFor(
  nameById: Record<string, string>,
  expectedFilenames: string[],
  tokens: string[],
  chapterKeys: string[]
): Set<string> {
  return pickFileIdsForManual(nameById, expectedFilenames, tokens, chapterKeys)
}

async function resolveCollectionManualDocs(opts: {
  managementKey: string
  apiKey?: string
  expectedFilenames: string[]
  tokens: string[]
  chapterKeys: string[]
  hits: CollectionHit[]
}): Promise<{ nameById: Record<string, string>; fileIds: Set<string> }> {
  const nameById: Record<string, string> = cachedCollectionDocs()
  let fileIds = scopedIdsFor(nameById, opts.expectedFilenames, opts.tokens, opts.chapterKeys)
  if (hasEnoughScopedIds(fileIds)) {
    return { nameById, fileIds }
  }

  const filters = collectionNameFilters(opts.expectedFilenames, opts.tokens).slice(0, 2)
  const listed = await Promise.all([
    listCollectionDocumentsAll(opts.managementKey),
    ...filters.map((q) => listCollectionDocumentsByName(opts.managementKey, q)),
  ])
  for (const map of listed) Object.assign(nameById, map)
  rememberCollectionDocs(nameById)
  fileIds = scopedIdsFor(nameById, opts.expectedFilenames, opts.tokens, opts.chapterKeys)

  // Per-hit lookups only when listing missed the selected book — never 8 serial GETs.
  if (!hasEnoughScopedIds(fileIds)) {
    const unnamedIds = [...new Set(opts.hits.map((h) => h.fileId).filter((id) => id && !nameById[id]))]
    const looked = await Promise.all(
      unnamedIds.slice(0, 3).map(async (id) => {
        const name = await lookupCollectionFileName(opts.managementKey, id, opts.apiKey)
        return { id, name }
      })
    )
    for (const row of looked) {
      if (row.name) nameById[row.id] = row.name
    }
    fileIds = scopedIdsFor(nameById, opts.expectedFilenames, opts.tokens, opts.chapterKeys)
  }

  return { nameById, fileIds }
}

async function searchManualCollection(
  XAI_KEY: string,
  query: string,
  tokens: string[],
  requireManualMatch: boolean,
  chapterKeys: string[] = [],
  selectedFileIds?: Set<string>,
  mode: 'hybrid' | 'keyword' = 'hybrid',
  expectedNames: string[] = []
): Promise<{ parts: Retrieved[]; filteredOut: number; hits: CollectionHit[] }> {
  const sr = await fetchWithTimeout(
    'https://api.x.ai/v1/documents/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_KEY}` },
      body: JSON.stringify(collectionSearchBody(query, TSP_COLLECTION_ID, mode)),
    },
    FETCH_MS.search
  )
  if (!sr?.ok) {
    console.error('documents/search failed', sr?.status ?? 'timeout', sr ? await sr.text() : '')
    return { parts: [], filteredOut: 0, hits: [] }
  }
  const hits = collectionHitsFromResponse(await sr.json())
  const filtered = filterHitsForManual(hits, {
    tokens,
    chapterKeys,
    fileIds: selectedFileIds,
    expectedFilenames: expectedNames,
    requireMatch: requireManualMatch,
  })
  return {
    parts: retrievedFromHits(filtered.parts, expectedNames),
    filteredOut: filtered.filteredOut,
    hits,
  }
}

async function pdfPathsForChat(db: any, manual: any): Promise<string[]> {
  const fromMeta = pdfPathsForAiAttach(manual)
  if (fromMeta.length) return fromMeta
  const prefix = folderPrefixForAiAttach(manual)
  if (prefix) return listFolderPdfs(db, prefix)
  return []
}

async function searchIndexedManualText(
  db: any,
  manualId: number | null,
  query: string,
  label: string
): Promise<Retrieved | null> {
  const id = asManualId(manualId)
  if (id == null) return null
  const { data, error } = await db.from('manual_search_index').select('search_text').eq('manual_id', id).maybeSingle()
  if (error || !data?.search_text) return null
  const excerpt = excerptManualSearchText(String(data.search_text), query)
  if (!excerpt || excerpt.length < 40) return null
  return { text: excerpt, source: `${label || 'Selected manual'} (indexed PDF text)` }
}

/**
 * Inlined from manual-scope.ts so a single-file raw.githubusercontent
 * bootstrap of index.ts still prefixes general guidance when the isolate
 * has an older manual-scope.ts. Keep the two copies in sync.
 * humanizeDeviceCode stays in this file — do not add a new module.
 */
const DEVICE_CODE_TOKENS: Record<string, string> = {
  yag: 'YAG',
  co2: 'CO2',
  co2re: 'CO2RE',
  nd: 'Nd',
  er: 'Er',
  ktp: 'KTP',
  ipl: 'IPL',
  rf: 'RF',
  mpx: 'MPX',
  iii: 'III',
  ii: 'II',
  iv: 'IV',
  vi: 'VI',
  vii: 'VII',
  viii: 'VIII',
}

function humanizeDeviceToken(token: string): string {
  const key = token.toLowerCase()
  if (DEVICE_CODE_TOKENS[key]) return DEVICE_CODE_TOKENS[key]
  if (/^[ivx]+$/i.test(token) && token.length <= 4) return token.toUpperCase()
  if (/\d/.test(token)) return token.toUpperCase()
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

function humanizeDeviceCode(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/[A-Z]/.test(raw) && !/[_-]/.test(raw)) return raw
  if (!/[_-]/.test(raw) && /\s/.test(raw)) return raw
  const parts = raw.split(/[_\-\s]+/).filter(Boolean)
  if (!parts.length) return raw
  return parts.map(humanizeDeviceToken).join(' ')
}

function generalGuidanceDeviceName(opts?: {
  brand?: string | null
  model?: string | null
  title?: string | null
} | null): string {
  const brand = humanizeDeviceCode(String(opts?.brand ?? '').trim())
  let device = humanizeDeviceCode(String(opts?.model ?? '').trim() || String(opts?.title ?? '').trim())
  if (brand && device.toLowerCase().startsWith(brand.toLowerCase())) {
    device = device.slice(brand.length).trim().replace(/^[-–:—\s]+/, '').trim()
  }
  return [brand, device].filter(Boolean).join(' ') || 'this device'
}

function generalGuidanceSystemHint(opts?: {
  brand?: string | null
  model?: string | null
  title?: string | null
} | null): string {
  const who = generalGuidanceDeviceName(opts)
  return (
    `\n\n## GENERAL GUIDANCE (no manual text)\n` +
    `Override the empty-source rule for this turn. Indexed excerpts and a matching collection file are unavailable, so you cannot quote the ${who} manual. ` +
    `Still answer helpfully from general field-service knowledge for the ${who}. ` +
    `Give typical steps, values, and cautions, and say when a detail varies by revision. ` +
    `Do not claim you read or cited this manual. Do not end with a "— Source:" line. ` +
    `A disclaimer is added for you; do not repeat it.`
  )
}

function prefixGeneralGuidance(
  content: string,
  opts?: { brand?: string | null; model?: string | null; title?: string | null } | null
): string {
  const prefix = `I couldn't search this manual's text yet, so this is general guidance for the ${generalGuidanceDeviceName(opts)}:`
  let body = String(content || '').trim()
  body = body.replace(/\n*—\s*Source:[\s\S]*$/i, '').trim()
  body = body.replace(/\[\[cite:[^\]]*\]\]/g, '').trim()
  if (!body || body === prefix) return prefix
  if (body.startsWith(prefix)) return body
  return `${prefix}\n\n${body}`
}

function formatManualContext(parts: Retrieved[], selectedLabel: string, emptyHint: string): string {
  if (!parts.length) {
    return (
      `\n\n## RETRIEVED MANUAL CONTENT\n` +
      `(No on-topic passages found for the selected manual${selectedLabel ? ` "${selectedLabel}"` : ''}.)\n` +
      `${emptyHint}\n` +
      `Do NOT invent procedures or specs. Tell the technician you could not find this in the selected manual corpus and suggest which section of the paper/PDF manual to check if known, or ask them to rephrase.`
    )
  }
  const srcs = [...new Set(parts.map((p) => p.source).filter(Boolean))]
  return (
    `\n\n## RETRIEVED MANUAL CONTENT\n` +
    `Selected device/manual: ${selectedLabel || '(none)'}. Answer only from these passages about this device.\n` +
    `Cite page/section when the passage includes them so the in-app viewer can jump there.\n\n` +
    parts
      .map((p, i) => {
        const loc = [p.page ? `page ${p.page}` : '', p.section ? `section ${p.section}` : '']
          .filter(Boolean)
          .join(', ')
        return `[${i + 1}] (${p.source}${loc ? `; ${loc}` : ''})\n${p.text}`
      })
      .join('\n---\n') +
    (srcs.length ? `\n\nDocument sources in retrieval: ${srcs.join('; ')}` : '')
  )
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader)
      return new Response(JSON.stringify({ error: 'No auth' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    const userToken = authHeader.replace('Bearer ', '')
    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    })
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()
    if (authError || !user)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const body = await req.json()
    const uid = user.id
    const { data: sub } = await db.from('subscriptions').select('tier,status,expires_at').eq('user_id', uid).single()
    const tier = sub?.status === 'active' && sub?.tier ? sub.tier : 'free'
    const effectiveTier = sub?.expires_at && new Date(sub.expires_at) < new Date() ? 'free' : tier
    const limits = LIMITS[effectiveTier] || LIMITS.free
    const XAI_KEY = Deno.env.get('XAI_API_KEY')
    if (!XAI_KEY)
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })

    if (body.action === 'usage') {
      const usage = await getDailyUsage(db, uid)
      return new Response(
        JSON.stringify({
          text: { used: usage.text, limit: limits.text },
          voice: { used: usage.voice, limit: limits.voice },
          tier: effectiveTier,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (body.action === 'chat') {
      const chatStarted = Date.now()
      const { messages, manualPath, manualId, voiceMode, zappPersona } = body
      if (!messages?.length)
        return new Response(JSON.stringify({ error: 'Missing messages' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      const usage = await getDailyUsage(db, uid)
      if (usage.text >= limits.text)
        return new Response(
          JSON.stringify({
            error: 'daily_limit_reached',
            message:
              effectiveTier === 'free'
                ? `Free limit: ${limits.text}/day. Upgrade for 50/day.`
                : `Daily text limit: ${limits.text}/day.`,
            used: usage.text,
            limit: limits.text,
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      let manualLabel = ''
      let manualMeta: any = null
      const rawPath = String(manualPath || '').trim()
      const rawId = asManualId(manualId)
      try {
        const { data: manuals } = await db
          .from('manuals')
          .select('id,title,brand,model,storage_path,entry_file_path,chapter_metadata,is_incomplete,is_folder')
        manualMeta = resolveManualFromCatalog(manuals || [], { manualId: rawId, manualPath: rawPath })
        if (manualMeta) {
          manualLabel = `${manualMeta.brand || ''} ${manualMeta.title || ''}`.trim()
        }
      } catch (_e) {}

      const nonSys = messages.filter((m: any) => m.role !== 'system')
      const lastUser = [...nonSys].reverse().find((m: any) => m.role === 'user')
      const userText = typeof lastUser?.content === 'string' ? lastUser.content : lastUser?.content?.[0]?.text || ''

      const resolvedModel = aliasToModel(rawPath) || aliasToModel(manualLabel) || aliasToModel(userText)
      const resolvedBrand = extractBrand(rawPath + ' ' + manualLabel + ' ' + userText)
      const matchTokens = manualMatchTokens({
        title: manualMeta?.title,
        brand: manualMeta?.brand,
        storage_path: manualMeta?.storage_path || rawPath,
        label: manualLabel,
        model: manualMeta?.model,
      })
      const attachPaths = manualMeta ? await pdfPathsForChat(db, manualMeta) : []
      const expectedFilenames = expectedFilenamesForPaths(attachPaths)
      const chapterKeys = chapterFileKeys([
        ...(Array.isArray(manualMeta?.chapter_metadata) ? manualMeta.chapter_metadata : []),
        ...attachPaths.map((p) => ({ storage_path: p, title: manualMeta?.title })),
      ])
      const schematicQ = isSchematicQuery(userText)
      const manageKey =
        Deno.env.get('XAI_MANAGEMENT_API_KEY') || Deno.env.get('XAI_MANAGEMENT_KEY') || XAI_KEY

      let contextBlock = ''
      let citationLine = ''
      let manualCitations: ManualCitation[] = []
      let hasFaultDBHit = false
      let hasManualPassages = false
      let collectionNameById: Record<string, string> = {}
      let selectedCollectionFileIds = new Set<string>()

      // Tokens only — used to bias manual search. Meanings come from the selected service manual first.
      const faultCodes = extractFaultCodes(userText)
      let emptyManualHint = ''

      async function applyFaultLookup() {
        if (!faultCodes.length || hasFaultDBHit || hasManualPassages) return
        const faultBlocks: string[] = []
        const refs: string[] = []
        for (const code of faultCodes) {
          try {
            const lookup = await lookupFaultCode(db, code, resolvedModel, resolvedBrand)
            if (!lookup) continue
            hasFaultDBHit = true
            faultBlocks.push(formatFaultContext(lookup.rows, lookup.source, resolvedModel, manualLabel))
            if (lookup.source !== 'ambiguous') {
              refs.push(lookup.rows[0]?.manual_ref || 'verified lookup table')
            }
          } catch (e) {
            console.warn('fault lookup failed', code, e)
          }
        }
        if (faultBlocks.length) {
          contextBlock = faultBlocks.join('')
          const uniqueRefs = [...new Set(refs)]
          if (uniqueRefs.length) {
            citationLine = `\n\n— Source: TSP Fault Code Database (${uniqueRefs.join('; ')})`
          }
        }
      }

      if (userText) {
        try {
          const sq = buildSearchQuery(userText, manualLabel, faultCodes)
          const wantResolve = !!(manageKey && (manualLabel || expectedFilenames.length))
          const searchP = searchManualCollection(
            XAI_KEY,
            sq,
            matchTokens,
            !!manualLabel,
            chapterKeys,
            undefined,
            'hybrid',
            expectedFilenames
          )
          const resolveP = wantResolve
            ? withBudget(
                resolveCollectionManualDocs({
                  managementKey: manageKey,
                  apiKey: XAI_KEY,
                  expectedFilenames,
                  tokens: matchTokens,
                  chapterKeys,
                  hits: [],
                }),
                FETCH_MS.resolve,
                { nameById: cachedCollectionDocs(), fileIds: new Set<string>() }
              )
            : Promise.resolve({ nameById: {} as Record<string, string>, fileIds: new Set<string>() })

          let [searched, resolved] = await Promise.all([searchP, resolveP])
          collectionNameById = resolved.nameById
          selectedCollectionFileIds = resolved.fileIds

          if (wantResolve && !hasEnoughScopedIds(selectedCollectionFileIds) && searched.hits.some((h) => h.fileId)) {
            try {
              resolved = await withBudget(
                resolveCollectionManualDocs({
                  managementKey: manageKey,
                  apiKey: XAI_KEY,
                  expectedFilenames,
                  tokens: matchTokens,
                  chapterKeys,
                  hits: searched.hits,
                }),
                FETCH_MS.lookup + 500,
                resolved
              )
              collectionNameById = resolved.nameById
              selectedCollectionFileIds = resolved.fileIds
            } catch (e) {
              console.warn('collection resolve (hits) failed soft', e)
            }
          }

          if (wantResolve || Object.keys(collectionNameById).length) {
            const namedHits = applyFileNameMap(searched.hits, collectionNameById)
            const filtered = filterHitsForManual(namedHits, {
              tokens: matchTokens,
              chapterKeys,
              fileIds: selectedCollectionFileIds,
              expectedFilenames,
              requireMatch: !!manualLabel,
            })
            searched = {
              parts: retrievedFromHits(filtered.parts, expectedFilenames),
              filteredOut: filtered.filteredOut,
              hits: namedHits,
            }
          }

          let parts = searched.parts
          let filteredOut = searched.filteredOut

          if (!parts.length && faultCodes.length && Date.now() - chatStarted < 18_000) {
            const kw = await searchManualCollection(
              XAI_KEY,
              sq,
              matchTokens,
              !!manualLabel,
              chapterKeys,
              selectedCollectionFileIds,
              'keyword',
              expectedFilenames
            )
            if (kw.parts.length) {
              parts = kw.parts
              filteredOut = kw.filteredOut
            }
          }

          if (!parts.length && manualMeta) {
            const indexed = await searchIndexedManualText(db, manualMeta.id, sq, manualLabel)
            if (indexed) parts = [indexed]
          }

          if (parts.length > 0) {
            hasManualPassages = true
            contextBlock = formatManualContext(parts, manualLabel, '')
            const srcs = [...new Set(parts.map((p) => p.source))]
            const manCite = srcs.map((c) => c.split('/').filter((p) => p && p !== 'shared').join(' › ')).join('; ')
            const scopedId = asManualId(manualMeta?.id)
            if (scopedId != null) {
              manualCitations = citationsFromParts(parts, scopedId, manualLabel || manCite)
              citationLine = formatCitationLine(manualCitations, manCite)
            } else {
              citationLine = `\n\n— Source: ${manCite}`
            }
          } else {
            emptyManualHint = selectedCollectionFileIds.size
              ? 'Attached Grok collection PDFs for this manual are available. Read those files — do not claim they are unreadable or unavailable unless you actually opened them and the pages are blank.'
              : filteredOut > 0
                ? `${filteredOut} passages were retrieved from other manuals and discarded because they did not match the selected device.`
                : 'Collection search returned no usable passages. Index this catalog id via God → Manuals → Index this manual if the PDF exists.'
          }
        } catch (e) {
          console.error('manual search error', e)
        }
      }

      const hasCollectionPdfs = selectedCollectionFileIds.size > 0

      // Offline fault_codes table is fallback only when the selected manual had
      // no usable passages and no Attached collection PDFs to read.
      if (!hasManualPassages && !hasCollectionPdfs && faultCodes.length) {
        await applyFaultLookup()
      }

      if (userText && !hasManualPassages && !hasFaultDBHit && emptyManualHint) {
        contextBlock = formatManualContext([], manualLabel, emptyManualHint)
      }

      let basePrompt: string
      let temperature: number
      if (!voiceMode) {
        basePrompt = FSE_SYSTEM_PROMPT
        temperature = hasFaultDBHit || hasManualPassages || hasCollectionPdfs ? 0.15 : 0.2
      } else if (zappPersona !== false) {
        basePrompt = ZAPP_VOICE_PROMPT
        temperature = hasFaultDBHit ? 0.3 : 0.5
      } else {
        basePrompt = VOICE_PROMPT_PLAIN
        temperature = 0.2
      }

      const manualCtx = manualLabel
        ? `\n\n## SELECTED MANUAL\n"${manualLabel}" is selected (id: ${manualMeta?.id ?? 'n/a'}; path: ${
            manualMeta?.storage_path || rawPath || 'n/a'
          }). Unless the question clearly references a different device, answer only for this device.`
        : `\n\n## SELECTED MANUAL\nNone selected. Prefer asking which system if the question is device-specific.`
      const voiceCtx = voiceMode ? '\n\n## VOICE FORMAT\n4-7 sentences. No markdown.' : ''
      const composeSystem = () => {
        const depthCtx =
          !voiceMode && (hasManualPassages || hasFaultDBHit || hasCollectionPdfs)
            ? '\n\n## DEPTH\nBe thorough for field service: ordered steps, expected values, cautions found in the source. Do not pad with invented content.'
            : ''
        return basePrompt + manualCtx + voiceCtx + depthCtx + contextBlock
      }
      let systemContent = composeSystem()

      const chatMessages = hasFaultDBHit ? [{ role: 'user', content: userText }] : nonSys.slice(-10)

      // Collection file_ids are already on xAI — prefer those over signed Storage URLs
      // (private/signed URLs often look "unreadable" to the model and can 504 dual-code chats).
      const wantPdfs =
        !!manualLabel &&
        !voiceMode &&
        (schematicQ || !hasManualPassages) &&
        Date.now() - chatStarted < 18_000
      let attachedNames: string[] = []
      let skippedLargePdf = false
      const ensureDocCite = () => {
        const scopedId = asManualId(manualMeta?.id)
        if (scopedId == null || hasFaultDBHit) return
        if (!manualCitations.length) {
          manualCitations = citationsFromParts([], scopedId, manualLabel)
        }
        if (!citationLine) citationLine = formatCitationLine(manualCitations, manualLabel)
      }
      const applyReplyPages = (replyText: string) => {
        const scopedId = asManualId(manualMeta?.id)
        if (scopedId == null || hasFaultDBHit) return
        const base = manualCitations.length ? manualCitations : [{ manualId: scopedId, title: manualLabel }]
        manualCitations = attachProsePages(base, replyText)
        citationLine = formatCitationLine(manualCitations, manualLabel)
      }
      const replyMeta = () => ({
        manualLabel,
        manualId: manualMeta?.id ?? null,
        hasFaultDBHit,
        hasManualPassages,
        hasCollectionPdfs,
        attachedPdfs: attachedNames,
        matchTokens,
        citations: manualCitations,
      })
      if (wantPdfs) {
        const collectionFiles = pickCollectionAttachments(
          collectionNameById,
          selectedCollectionFileIds,
          schematicQ,
          2
        )
        try {
          if (collectionFiles.length) {
            attachedNames = collectionFiles.map((s) => s.name)
            ensureDocCite()
            const fileCite = citationLine || `\n\n— Source: ${manualLabel} collection PDFs: ${attachedNames.join('; ')}`
            const attachPrompt =
              systemContent +
              `\n\n## ATTACHED MANUAL PDFs\nThese files are already in the Grok collection for "${manualLabel}". They ARE readable. Quote exact wording. Do not say the service manual is unavailable.\n` +
              collectionFiles.map((s, i) => `[PDF ${i + 1}] ${s.name}`).join('\n')
            const rr = await fetchWithTimeout(
              'https://api.x.ai/v1/responses',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_KEY}` },
                body: JSON.stringify({
                  model: 'grok-4.6',
                  instructions: attachPrompt,
                  input: [
                    {
                      role: 'user',
                      content: [
                        { type: 'input_text', text: userText },
                        ...collectionFiles.map((s) => ({ type: 'input_file', file_id: s.fileId })),
                      ],
                    },
                  ],
                }),
              },
              FETCH_MS.model
            )
            if (rr?.ok) {
              const rd = await rr.json()
              const txt = textFromResponses(rd)
              if (txt) {
                await logUsage(db, uid, 'grok_chat', rd.usage?.total_tokens || 0)
                applyReplyPages(txt)
                const content = (txt.trim() + (citationLine || fileCite)).trim()
                return new Response(
                  JSON.stringify({
                    choices: [{ message: { role: 'assistant', content } }],
                    usage: rd.usage || {},
                    _usage: {
                      text: { used: usage.text + 1, limit: limits.text },
                      voice: { used: usage.voice, limit: limits.voice },
                    },
                    _meta: replyMeta(),
                  }),
                  { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
              }
            } else {
              console.warn('responses+collection files failed', rr?.status ?? 'timeout', rr ? await rr.text() : '')
            }
          } else if (manualMeta && attachPaths.length && !hasCollectionPdfs && !hasManualPassages) {
            // Indexed excerpts already prefer manual_search_index (hasManualPassages).
            // Sending a multi-megabyte signed URL (Candela CO2RE, 7.7 MB / 161 pages)
            // blows the 22s responses budget ("responses+files failed timeout").
            const chapterList = attachPaths.map((p) => ({ storage_path: p, title: manualMeta.title }))
            const picks = pickRelevantChapters(
              chapterList,
              userText,
              schematicQ,
              manualMeta.entry_file_path || attachPaths[0] || ''
            )
            const attachStats: PdfAttachStat[] = []
            for (const ch of picks) attachStats.push(await statManualPdf(db, ch.storage_path))
            if (picks.length && !wholePdfAttachAllowed(attachStats)) {
              skippedLargePdf = true
              console.warn('skip whole-pdf attach', manualMeta?.id, attachStats)
            }
            const signed: { name: string; url: string }[] = []
            if (!skippedLargePdf) {
              for (const ch of picks) {
                const url = await signStoragePdf(ch.storage_path)
                if (url) signed.push({ name: basenamePath(ch.storage_path) || ch.title, url })
              }
            }
            if (signed.length) {
              attachedNames = signed.map((s) => s.name)
              ensureDocCite()
              const fileCite = citationLine || `\n\n— Source: ${manualLabel} PDFs: ${attachedNames.join('; ')}`
              const attachPrompt =
                systemContent +
                `\n\n## ATTACHED MANUAL PDFs\nThe following PDFs from "${manualLabel}" are attached. Read them, quote them, and interpret drawings/schematics.\n` +
                signed.map((s, i) => `[PDF ${i + 1}] ${s.name}`).join('\n')
              const rr = await fetchWithTimeout(
                'https://api.x.ai/v1/responses',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_KEY}` },
                  body: JSON.stringify({
                    model: 'grok-4.6',
                    instructions: attachPrompt,
                    input: [
                      {
                        role: 'user',
                        content: [
                          { type: 'input_text', text: userText },
                          ...signed.map((s) => ({ type: 'input_file', file_url: s.url })),
                        ],
                      },
                    ],
                  }),
                },
                FETCH_MS.model
              )
              if (rr?.ok) {
                const rd = await rr.json()
                const txt = textFromResponses(rd)
                if (txt) {
                  await logUsage(db, uid, 'grok_chat', rd.usage?.total_tokens || 0)
                  applyReplyPages(txt)
                  const content = (txt.trim() + (citationLine || fileCite)).trim()
                  return new Response(
                    JSON.stringify({
                      choices: [{ message: { role: 'assistant', content } }],
                      usage: rd.usage || {},
                      _usage: {
                        text: { used: usage.text + 1, limit: limits.text },
                        voice: { used: usage.voice, limit: limits.voice },
                      },
                      _meta: replyMeta(),
                    }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                  )
                }
              } else {
                console.warn('responses+files failed', rr?.status ?? 'timeout', rr ? await rr.text() : '')
              }
            }
          }
        } catch (e) {
          console.warn('pdf attach path failed (continuing to text chat)', e)
        }
      }

      if (!hasManualPassages && !hasFaultDBHit && faultCodes.length) {
        await applyFaultLookup()
        if (hasFaultDBHit) systemContent = composeSystem()
      }

      // No indexed excerpts, collection file, or fault-code hit. Most of the
      // library is in this state. Answer from model knowledge and prefix a
      // disclaimer — do not return a canned "couldn't answer" reply.
      // Large PDFs stay unattached (skippedLargePdf). A small unindexed PDF
      // that attached inside the timeout already returned above.
      const useGeneralGuidance =
        !!manualLabel && !hasManualPassages && !hasFaultDBHit && !hasCollectionPdfs
      if (useGeneralGuidance) {
        contextBlock = generalGuidanceSystemHint({
          brand: manualMeta?.brand,
          model: manualMeta?.model,
          title: manualMeta?.title,
        })
        systemContent = composeSystem()
      }

      const xr = await fetchWithTimeout(
        'https://api.x.ai/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_KEY}` },
          body: JSON.stringify({
            model: 'grok-3-fast',
            messages: [{ role: 'system', content: systemContent }, ...chatMessages],
            temperature,
            stream: false,
          }),
        },
        FETCH_MS.model
      )
      if (!xr?.ok) {
        const e = xr ? await xr.text() : 'timeout'
        return new Response(JSON.stringify({ error: `AI error (${xr?.status ?? 'timeout'})`, details: e }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const xd = await xr.json()
      if (useGeneralGuidance) {
        const ch = xd.choices?.[0]
        if (ch?.message) {
          ch.message.content = prefixGeneralGuidance(String(ch.message.content || ''), {
            brand: manualMeta?.brand,
            model: manualMeta?.model,
            title: manualMeta?.title,
          })
        }
      } else {
        if (!citationLine && !hasFaultDBHit) ensureDocCite()
        if (xd.choices?.[0]?.message?.content) {
          applyReplyPages(String(xd.choices[0].message.content))
        }
        if (citationLine) {
          const ch = xd.choices?.[0]
          if (ch?.message?.content) ch.message.content = ch.message.content.trim() + citationLine
        }
      }
      await logUsage(db, uid, 'grok_chat', xd.usage?.total_tokens || 0)
      xd._usage = {
        text: { used: usage.text + 1, limit: limits.text },
        voice: { used: usage.voice, limit: limits.voice },
      }
      xd._meta = useGeneralGuidance
        ? { ...replyMeta(), generalGuidance: true, skippedWholePdf: skippedLargePdf, citations: [] }
        : replyMeta()
      return new Response(JSON.stringify(xd), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'attach-collection') {
      const email = String(user.email || '').trim().toLowerCase()
      const allow = String(Deno.env.get('GOD_ADMIN_EMAILS') || 'larrysmart@gmail.com')
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
      if (!allow.includes(email)) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const targetId = asManualId(body.manualId ?? body.manual_id)
      if (targetId == null) {
        return new Response(JSON.stringify({ error: 'manualId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { data: manual } = await db
        .from('manuals')
        .select('id,title,storage_path,entry_file_path,chapter_metadata,is_folder')
        .eq('id', targetId)
        .maybeSingle()
      if (!manual) {
        return new Response(JSON.stringify({ error: `Manual ${targetId} not found` }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      let paths = pdfPathsForAiAttach(manual)
      if (!paths.length) {
        const prefix = folderPrefixForAiAttach(manual)
        if (prefix) paths = await listFolderPdfs(db, prefix)
      }
      if (!paths.length) {
        return new Response(
          JSON.stringify({ ok: false, skipped: 'no_pdf_path', manualId: targetId }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const manageKey = Deno.env.get('XAI_MANAGEMENT_API_KEY') || Deno.env.get('XAI_MANAGEMENT_KEY') || XAI_KEY
      const listedAll = await listCollectionDocumentsAll(manageKey)
      const uploads = []
      for (const path of paths.slice(0, 8)) {
        const expected = expectedFilenamesForPaths([path])
        const existingIds = pickFileIdsForManual(listedAll, expected, [], [])
        const existingId = [...existingIds][0]
        if (existingId) {
          uploads.push({
            path,
            ok: true,
            fileId: existingId,
            filename: listedAll[existingId] || storageBasename(path),
            skipped: 'already_in_collection',
          })
          continue
        }
        const { data: blob, error } = await db.storage.from('manuals').download(path)
        if (error || !blob) {
          uploads.push({ path, ok: false, skipped: error?.message || 'download_failed' })
          continue
        }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const uploaded = await uploadPdfToTspCollection({
          apiKey: XAI_KEY,
          managementKey: manageKey,
          filename: storageBasename(path) || `manual-${targetId}.pdf`,
          bytes,
        })
        uploads.push({ path, ...uploaded })
      }
      const ok = uploads.some((u: { ok?: boolean }) => u.ok)
      if (ok) {
        await db.from('manuals').update({ xai_collection_id: TSP_XAI_COLLECTION_ID }).eq('id', targetId)
      }
      return new Response(
        JSON.stringify({
          ok,
          action: 'attach-collection',
          manualId: targetId,
          collectionId: TSP_XAI_COLLECTION_ID,
          uploads,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (body.action === 'tts') {
      const { text, voiceId } = body
      if (!text)
        return new Response(JSON.stringify({ error: 'Missing text' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      const usage = await getDailyUsage(db, uid)
      if (usage.voice >= limits.voice)
        return new Response(
          JSON.stringify({
            error: 'daily_limit_reached',
            message:
              effectiveTier === 'free' ? `Free limit: ${limits.voice} voice/day.` : `Daily voice limit: ${limits.voice}/day.`,
            used: usage.voice,
            limit: limits.voice,
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      const VOICES = ['eve', 'ara', 'rex', 'sal', 'leo', 'sage']
      const voice = VOICES.includes(voiceId) ? voiceId : 'sage'
      const tr = await fetch('https://api.x.ai/v1/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_KEY}` },
        body: JSON.stringify({
          text: text.substring(0, 4096),
          voice_id: voice,
          language: 'en',
        }),
      })
      if (!tr.ok) {
        const e = await tr.text()
        return new Response(JSON.stringify({ error: 'TTS error', details: e }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      await logUsage(db, uid, 'grok_tts', Math.min(text.length, 4096))
      return new Response(await tr.arrayBuffer(), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-cache',
        },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
