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
}

export type Retrieved = { text: string; source: string }

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
    const page = Number(row.page_number)
    out.push({
      text,
      source: rowFileName(row),
      fileId: rowFileId(row),
      page: Number.isFinite(page) && page > 0 ? page : undefined,
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
  for (const [id, name] of Object.entries(nameById)) {
    if (expected.length) {
      if (expected.some((e) => namesAlign(e, name))) ids.add(id)
      continue
    }
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
    : hits.filter((p) => docMatchesManual(p.source, opts.tokens, opts.chapterKeys))
  if (named.length) {
    return { parts: named.slice(0, 12), filteredOut: hits.length - named.length }
  }
  return { parts: [], filteredOut: hits.length }
}

export function retrievedFromHits(hits: CollectionHit[], expectedFilenames: string[] = []): Retrieved[] {
  return hits.map((h) => {
    const page = h.page ? ` p.${h.page}` : ''
    const name = displayAttachedName(h.source || 'manual', expectedFilenames)
    return { text: h.text, source: `${name}${page}` }
  })
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
