/**
 * Parse xAI Collections search + match hits to the selected manual.
 *
 * Live POST /v1/documents/search returns `{ matches: [{ chunk_content, file_id, fields }] }`.
 * Older grok-assistant only read `results`/`text`/`document_name`, so Attached
 * PDFs (Cutera Xeo 105) looked empty even when the collection had chunks.
 * Search also omits filenames — resolve them from `fields` or document list.
 */

export type CollectionHit = {
  text: string
  source: string
  fileId: string
  page?: number
}

export type Retrieved = { text: string; source: string }

/** Same sanitizer attach-collection uses when uploading to xAI Files. */
export function collectionFilenameForPath(path: string): string {
  const base = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || 'manual.pdf'
  return base.replace(/[^\w.\-]+/g, '_') || 'manual.pdf'
}

export function compactDocKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function namesAlign(a: unknown, b: unknown): boolean {
  const na = compactDocKey(a)
  const nb = compactDocKey(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
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

const CHAPTER_KEY_STOP = new Set([
  'shared',
  'manual',
  'service',
  'system',
  'operator',
  'section',
  'pdf',
])

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

export function docMatchesManual(docName: string, tokens: string[], chapterKeys: string[] = []): boolean {
  if (!docName) return false
  const n = docName.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const compact = n.replace(/\s+/g, '')
  const base = compactDocKey((docName.replace(/\\/g, '/').split('/').pop() || '').replace(/\.pdf$/i, ''))
  for (const k of chapterKeys) {
    const ck = compactDocKey(k)
    if (ck.length >= 6 && (base.includes(ck) || compact.includes(ck) || ck.includes(base))) return true
  }
  let hits = 0
  for (const t of tokens) {
    if (n.includes(t) || compact.includes(t)) hits++
  }
  if (hits >= 2) return true
  if (hits === 1 && tokens.some((t) => t.length >= 5 && (n.includes(t) || compact.includes(t)))) return true
  return false
}

export function pickFileIdsForManual(
  nameById: Record<string, string>,
  expectedFilenames: string[],
  tokens: string[],
  chapterKeys: string[]
): Set<string> {
  const ids = new Set<string>()
  for (const [id, name] of Object.entries(nameById)) {
    if (expectedFilenames.some((e) => namesAlign(e, name))) {
      ids.add(id)
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
    requireMatch: boolean
  }
): { parts: CollectionHit[]; filteredOut: number } {
  if (!opts.requireMatch) {
    return { parts: hits.slice(0, 12), filteredOut: 0 }
  }
  if (opts.fileIds && opts.fileIds.size) {
    const matched = hits.filter((h) => h.fileId && opts.fileIds!.has(h.fileId))
    if (matched.length) {
      return { parts: matched.slice(0, 12), filteredOut: hits.length - matched.length }
    }
  }
  const named = hits.filter((p) => docMatchesManual(p.source, opts.tokens, opts.chapterKeys))
  if (named.length) {
    return { parts: named.slice(0, 12), filteredOut: hits.length - named.length }
  }
  return { parts: [], filteredOut: hits.length }
}

export function retrievedFromHits(hits: CollectionHit[]): Retrieved[] {
  return hits.map((h) => {
    const page = h.page ? ` p.${h.page}` : ''
    return { text: h.text, source: `${h.source || 'manual'}${page}` }
  })
}

/** Distinctive name filters for GET /collections/{id}/documents?filter=name:"…" */
export function collectionNameFilters(expectedFilenames: string[], tokens: string[]): string[] {
  const out: string[] = []
  const push = (raw: string) => {
    const s = String(raw || '')
      .replace(/\.pdf$/i, '')
      .replace(/_/g, ' ')
      .trim()
    if (s.length < 3) return
    if (!out.includes(s)) out.push(s)
  }
  for (const name of expectedFilenames) push(name)
  for (const t of tokens) {
    if (t.length >= 3 && t.length <= 24) push(t)
  }
  return out.slice(0, 4)
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

export function preferServiceManualName(name: string): boolean {
  const n = String(name || '').toLowerCase()
  if (/schem|wiring|electrical|exploded/.test(n)) return false
  return /service|manual|rev/.test(n)
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
