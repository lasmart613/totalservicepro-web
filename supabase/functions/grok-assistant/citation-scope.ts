import { quotedPageSupport } from './manual-scope.ts'

/**
 * Technician-safety scope for grok-assistant retrieval citations.
 *
 * GentleMAX Pro and GentleMAX PRO PLUS are different machines. A passage may
 * wear the selected manual's id only when its xAI file id or file name belongs
 * to that manual. Otherwise it is cited as its own catalog row, or dropped.
 * Never relabel a sibling model's procedure.
 *
 * Page numbers are physical PDF pages (1-based), reconciled to [[pdfpage:N]]
 * stamps. xAI page_number is often the 0-based index or the chunk-start page
 * (one behind the stamp).
 *
 * Out-of-range pages stay on the citation and set `page_out_of_range: true`.
 * The web viewer (PR #202) should read `_meta.citations[].page_out_of_range`.
 * When it is true, show "Page N isn't in this PDF" and do not scroll to N.
 * `page` is still the 1-based number that was cited. The [[cite:]] marker
 * also sets `oor=1`, which parses back to the same field.
 */

/** Longer forms first at match time. Roman numerals and digits share an id. */
export const MODEL_SUFFIX_QUALIFIERS: readonly { id: string; forms: readonly string[] }[] = [
  { id: 'pro-plus', forms: ['pro plus', 'proplus'] },
  { id: 'max-pro', forms: ['max pro', 'maxpro'] },
  { id: 'gen-2', forms: ['gen 2', 'gen2', 'generation 2', 'generation2'] },
  { id: 'plus', forms: ['plus'] },
  { id: 'elite', forms: ['elite'] },
  { id: 'select', forms: ['select'] },
  { id: 'ultra', forms: ['ultra'] },
  { id: 'xl', forms: ['xl'] },
  { id: 'se', forms: ['se'] },
  { id: 'iii', forms: ['iii', '3'] },
  { id: 'ii', forms: ['ii', '2'] },
  { id: 'pro', forms: ['pro'] },
  { id: 'max', forms: ['max'] },
  { id: 's', forms: ['s'] },
]

type QualifierForm = { id: string; tokens: string[] }

let formCache: QualifierForm[] | null = null
function qualifierForms(): QualifierForm[] {
  if (formCache) return formCache
  const rows: QualifierForm[] = []
  for (const q of MODEL_SUFFIX_QUALIFIERS) {
    for (const form of q.forms) rows.push({ id: q.id, tokens: form.split(' ') })
  }
  rows.sort(
    (a, b) => b.tokens.length - a.tokens.length || b.tokens.join('').length - a.tokens.join('').length
  )
  formCache = rows
  return rows
}

export function nameTokens(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Qualifier ids on a manual title, filename, or token list. Longest form wins. */
export function modelQualifierIds(value: string): string[] {
  const tokens = nameTokens(value)
  const used = new Set<number>()
  const ids: string[] = []
  for (const form of qualifierForms()) {
    const n = form.tokens.length
    for (let i = 0; i <= tokens.length - n; i++) {
      if (form.tokens.some((_, k) => used.has(i + k))) continue
      if (!form.tokens.every((tok, k) => tokens[i + k] === tok)) continue
      if (!ids.includes(form.id)) ids.push(form.id)
      for (let k = 0; k < n; k++) used.add(i + k)
    }
  }
  return ids
}

/**
 * True when the document and the selected manual do not carry the same
 * suffix qualifiers. A manual that lacks "plus" rejects a PRO PLUS file,
 * and a PRO PLUS manual rejects a plain Pro file. Empty names do not conflict
 * (the caller has nothing to compare).
 */
export function modelSuffixConflict(docName: string, selectedBlob: string): boolean {
  if (!String(docName || '').trim() || !String(selectedBlob || '').trim()) return false
  const doc = modelQualifierIds(docName)
  const selected = modelQualifierIds(selectedBlob)
  if (doc.length !== selected.length) return true
  const have = new Set(selected)
  return doc.some((id) => !have.has(id))
}

const NAME_ALIGN_MIN = 12

function compactKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function namesAlign(a: unknown, b: unknown): boolean {
  const na = compactKey(a)
  const nb = compactKey(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  return shorter.length >= NAME_ALIGN_MIN && longer.includes(shorter)
}

function storageBase(path: string): string {
  const s = String(path || '').replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

export function inlineStampPages(text: string): number[] {
  const out: number[] = []
  for (const match of String(text || '').matchAll(/\[\[pdfpage:(\d{1,4})\]\]/g)) {
    const n = Number(match[1])
    if (n >= 1 && n <= 9999) out.push(Math.floor(n))
  }
  return out
}

export function maxStampPage(text: string): number | undefined {
  const pages = inlineStampPages(text)
  if (!pages.length) return undefined
  return Math.max(...pages)
}

export function storedPageCount(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n) || n < 1 || n > 9999) return undefined
  return Math.floor(n)
}

/** Highest [[pdfpage:N]] stamp. manuals has no page_count column. */
export function effectivePageCount(pageCount: unknown, indexText?: string): number | undefined {
  return storedPageCount(pageCount) ?? (indexText ? maxStampPage(indexText) : undefined)
}

const CLEAR_MANUAL_REFUSAL =
  /\b(?:do not|does not|don't|doesn't|cannot|can't|could not|couldn't)\s+(?:contain|include|list|provide|mention|show)\b/i
const SUBJECT_MANUAL_REFUSAL =
  /\b(?:passages|sections|manuals?)\b[^.]{0,80}\b(?:do not|does not|don't|doesn't|cannot|can't)\s+(?:contain|include|list|provide|mention|describe|define|show)\b/i
const NO_MANUAL_INFO = /\b(?:no|not any)\s+(?:information|reference|mention|description|details)\b/i
const NOT_IN_MANUAL =
  /\bnot (?:in the (?:retrieved |provided |selected )?passages|in the (?:selected |provided |operator |service )?manual)\b/i
/** "not described" / "not listed" only count when the reply never gives a value or a step. */
const LOOSE_NOT_STATED = /\bnot (?:included|found|present|listed|described|defined)\b/i

function replySentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** A fault code, a measurement, or a service action. A bare page number is not one. */
function hasSpecificValueOrStep(text: string): boolean {
  if (/\b(?:faults?|errors?|alarms?)\s*(?:codes?\s*)?#?\s*\d+(?:\.\d+)?\b/i.test(text)) return true
  if (/\b[A-Za-z]{1,6}-?\d+\.\d+\b/.test(text)) return true
  if (
    /\b\d+(?:\.\d+)?\s*(?:%|nm|mm|cm|j|joules?|hz|khz|vac|vdc|°c|°f|degrees?|psi|bar|amps?|watts?|msec|ms|sec)\b/i.test(
      text
    )
  ) {
    return true
  }
  if (/\b(?:call|replace|turn|clean|calibrat\w*|install|remove|reset|tighten|loosen|contact|disconnect|reconnect)\b/i.test(text)) {
    return true
  }
  return false
}

function clearManualRefusal(sentence: string): boolean {
  return (
    CLEAR_MANUAL_REFUSAL.test(sentence) ||
    SUBJECT_MANUAL_REFUSAL.test(sentence) ||
    NO_MANUAL_INFO.test(sentence) ||
    NOT_IN_MANUAL.test(sentence)
  )
}

/**
 * The model said this fact is not in the manual. A refusal must not carry a citation chip.
 * The main point has to be the refusal: the first sentence says the manual lacks it, or the
 * reply never gives a value or a step. "Fault 2.1 is not described as user-serviceable; call
 * service." is an answer. "Do not use" is an instruction, not a refusal.
 */
export function answerDeclinesManualCitation(text: string): boolean {
  const raw = String(text || '')
    .replace(/\[\[cite:[^\]]*\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return false
  const first = replySentences(raw)[0] || raw
  if (clearManualRefusal(first)) return true
  if (!hasSpecificValueOrStep(raw) && (clearManualRefusal(raw) || LOOSE_NOT_STATED.test(raw))) return true
  return false
}

/**
 * Printed footer such as "Page 54 of 178". A cross-reference ("see Page 2 of 5")
 * is not the footer: there must be exactly one distinct number, and it must sit
 * in the last ~200 characters of the page.
 */
export function printedPageLabel(pageText: string): number | undefined {
  const text = String(pageText || '')
  const found: Array<{ x: number; at: number }> = []
  const footerRe = /\b(?:page|p[áa]gina|seite)\s+(\d{1,4})\s+of\s+\d{1,4}\b/gi
  for (const match of text.matchAll(footerRe)) {
    const n = Number(match[1])
    if (!Number.isFinite(n) || n < 1 || n > 9999) continue
    found.push({ x: Math.floor(n), at: match.index ?? 0 })
  }
  if (!found.length) return undefined
  const distinct = new Set(found.map((hit) => hit.x))
  if (distinct.size !== 1) return undefined
  const last = found[found.length - 1]
  if (last.at < text.length - 200) return undefined
  return last.x
}

/** Printed footer → physical pages that carry it. Built once per index string. */
export type FooterPageMap = Map<number, number[]>

const FOOTER_INDEX_CAP = 8

type FooterIndexSlot = { text: string; map: FooterPageMap }

const footerByManual = new Map<number, FooterIndexSlot>()
let footerFingerprint: FooterIndexSlot | null = null

function rememberFooterSlot(slot: FooterIndexSlot, manualId?: number): FooterPageMap {
  footerFingerprint = slot
  if (manualId == null || !Number.isFinite(manualId) || manualId < 1) return slot.map
  const id = Math.floor(manualId)
  footerByManual.delete(id)
  footerByManual.set(id, slot)
  while (footerByManual.size > FOOTER_INDEX_CAP) {
    const oldest = footerByManual.keys().next().value
    if (oldest == null) break
    footerByManual.delete(oldest)
  }
  return slot.map
}

/**
 * One pass over the index. Stamped text uses each [[pdfpage:N]] body
 * (stamp through the next form feed). A stamp-less extract uses form feeds.
 */
export function buildFooterPageMap(indexText: string): FooterPageMap {
  const raw = String(indexText || '')
  const map: FooterPageMap = new Map()
  if (!raw) return map
  const add = (printed: number, page: number) => {
    const list = map.get(printed)
    if (!list) {
      map.set(printed, [page])
      return
    }
    if (!list.includes(page)) list.push(page)
  }
  if (/\[\[pdfpage:\d+\]\]/.test(raw)) {
    for (const part of raw.split('\f')) {
      const match = /\[\[pdfpage:(\d{1,4})\]\]/.exec(part)
      if (!match) continue
      const page = Number(match[1])
      if (!Number.isFinite(page) || page < 1) continue
      const at = part.indexOf(match[0])
      const body = at >= 0 ? part.slice(at) : part
      const printed = printedPageLabel(body)
      if (printed == null) continue
      add(printed, Math.floor(page))
    }
  } else {
    raw.split('\f').forEach((body, index) => {
      const printed = printedPageLabel(body)
      if (printed == null) return
      add(printed, index + 1)
    })
  }
  for (const list of map.values()) list.sort((a, b) => a - b)
  return map
}

/** Same Map object when this string was already loaded. */
export function footerPagesForIndex(indexText: string): FooterPageMap {
  const text = String(indexText || '')
  if (footerFingerprint && footerFingerprint.text === text) return footerFingerprint.map
  for (const slot of footerByManual.values()) {
    if (slot.text === text) return rememberFooterSlot(slot)
  }
  return rememberFooterSlot({ text, map: buildFooterPageMap(text) })
}

/** Cache the footer map next to a manual index. Same text keeps the same Map. */
export function rememberManualIndex(manualId: number, indexText: string): FooterPageMap {
  const text = String(indexText || '')
  const id = Math.floor(Number(manualId))
  if (Number.isFinite(id) && id > 0) {
    const existing = footerByManual.get(id)
    if (existing && existing.text === text) return rememberFooterSlot(existing, id)
  }
  return rememberFooterSlot({ text, map: buildFooterPageMap(text) }, id)
}

/** Other physical pages whose own footer is this printed number. */
function pagesWithPrintedFooter(indexText: string, printed: number): number[] {
  return footerPagesForIndex(indexText).get(printed) || []
}

export type AlignReplyOptions = { query?: string; pageCount?: number }

/**
 * When the reply names the printed footer on the cited PDF page, rewrite that
 * mention to the physical page the chip uses.
 * Skip the rewrite when the printed number is itself a physical page that
 * backs the answer. Never touch a range ("pp. 54-55") or a decimal ("page 54.2").
 * "page X of Y" is rewritten. A bare "page X" is rewritten only when no other
 * page carries that same footer.
 */
export function alignReplyToCitationPage(
  answer: string,
  pdfPage: number | undefined,
  indexText: string,
  opts?: AlignReplyOptions
): string {
  const text = String(answer || '')
  if (pdfPage == null || pdfPage < 1) return text
  const body = indexPageBody(indexText, pdfPage) || ''
  const printed = printedPageLabel(body)
  if (printed == null || printed === pdfPage) return text
  const pageCount = opts?.pageCount
  const within = pageCount == null || pageCount < 1 || printed <= pageCount
  const query = String(opts?.query || '').trim()
  if (within && query) {
    const physical = indexPageBody(indexText, printed) || ''
    if (physical && quotedPageSupport(physical, query, indexText) > 0) return text
  }
  const ofRe = new RegExp(`\\b(page)\\s+${printed}(?![\\d.,–—-]\\s*\\d)\\s+of\\s+\\d{1,4}\\b`, 'gi')
  let next = text.replace(ofRe, (_all, word: string) => `${word} ${pdfPage}`)
  const others = pagesWithPrintedFooter(indexText, printed).filter((n) => n !== pdfPage)
  if (others.length) return next
  const bareRe = new RegExp(`\\b(page)\\s+${printed}(?![\\d.,–—-]\\s*\\d)(?!\\s+of\\s+\\d)`, 'gi')
  next = next.replace(bareRe, (_all, word: string) => `${word} ${pdfPage}`)
  return next
}

function asReportedPage(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0 || n >= 10000) return undefined
  return Math.floor(n)
}

/**
 * Page in a stamped index that contains this passage.
 * Uses a few prefixes so a shortened chunk still lands on [[pdfpage:N]].
 */
export function stampPageForPassage(indexText: string, passage: string): number | undefined {
  const raw = String(indexText || '')
  const hay = raw.toLowerCase()
  const needle = String(passage || '')
    .toLowerCase()
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!hay || needle.length < 12) return undefined
  const windows = [needle.slice(0, 96), needle.slice(0, 48), needle.slice(0, 24)].filter(
    (s, i, all) => s.length >= 12 && all.indexOf(s) === i
  )
  for (const window of windows) {
    const at = hay.indexOf(window)
    if (at < 0) continue
    const stamps = inlineStampPages(raw.slice(0, at + window.length))
    if (stamps.length) return stamps[stamps.length - 1]
  }
  return undefined
}

/**
 * Physical 1-based page. A [[pdfpage:N]] stamp in the chunk or the manual
 * index wins over xAI page_number. When the reported page is exactly one
 * behind a stamp (0-based or chunk-start), the stamp is used. page_number 0
 * with no stamp is page 1. A positive page_number with nothing to verify
 * against is left as-is.
 */
export function reconcilePhysicalPage(opts: {
  reported?: unknown
  passage?: string
  indexText?: string
  /** Index excerpts already carry the stamp page. Do not retarget them. */
  trustReported?: boolean
}): number | undefined {
  const reported = asReportedPage(opts.reported)
  const inline = inlineStampPages(opts.passage || '')
  if (inline.length) {
    if (reported != null && inline.includes(reported)) return reported >= 1 ? reported : undefined
    if (reported != null && inline.includes(reported + 1)) return reported + 1
    return inline[inline.length - 1]
  }
  if (opts.trustReported && reported != null && reported >= 1) return reported
  const stamped = opts.indexText ? stampPageForPassage(opts.indexText, opts.passage || '') : undefined
  if (stamped != null) {
    // 0-based or chunk-start: xAI is one behind the stamp. A farther mismatch
    // (the same words in a contents line) keeps the reported page.
    if (reported == null || reported === 0 || reported === stamped || reported + 1 === stamped) return stamped
    return reported >= 1 ? reported : stamped
  }
  if (reported === 0) return 1
  if (reported != null && reported >= 1) return reported
  return undefined
}

export function boundCitationPage(
  page: number | undefined,
  pageCount: number | undefined
): { page?: number; page_out_of_range?: true } {
  if (page == null || page < 1) return {}
  const p = Math.floor(page)
  if (pageCount != null && pageCount >= 1 && p > pageCount) return { page: p, page_out_of_range: true }
  return { page: p }
}

/** Body of physical page N. Stamped indexes win; a stamp-less extract uses form feeds. */
export function indexPageBody(indexText: string, page: number): string | undefined {
  const raw = String(indexText || '')
  if (!raw || page < 1) return undefined
  const stamp = `[[pdfpage:${page}]]`
  const at = raw.indexOf(stamp)
  if (at >= 0) {
    const next = raw.indexOf('\f', at)
    return raw.slice(at, next < 0 ? raw.length : next)
  }
  if (/\[\[pdfpage:\d+\]\]/.test(raw)) return undefined
  const parts = raw.split('\f')
  return parts[page - 1] || undefined
}

type QuotedPages = { at: number; pages: number[] }

/**
 * Pages named in an answer: "p. 147", "page 147", "pp. 88–89", "pages 88-89".
 * A range is the inclusive span (capped) rather than only its first number.
 */
export function quotedPagesInAnswer(answer: string): QuotedPages[] {
  const raw = String(answer || '')
  const quotes: QuotedPages[] = []
  const covered: Array<{ start: number; end: number }> = []
  const rangeRe = /\b(?:p{1,2}\.|pages?)\s*(\d{1,4})\s*[-–—]\s*(\d{1,4})\b/gi
  for (const match of raw.matchAll(rangeRe)) {
    const a = Number(match[1])
    const b = Number(match[2])
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    const lo = Math.min(Math.floor(a), Math.floor(b))
    const hi = Math.max(Math.floor(a), Math.floor(b))
    if (lo < 1 || hi > 9999 || hi - lo > 20) continue
    const pages: number[] = []
    for (let p = lo; p <= hi; p++) pages.push(p)
    const start = match.index ?? 0
    quotes.push({ at: start, pages })
    covered.push({ start, end: start + match[0].length })
  }
  const singleRe = /\b(?:p{1,2}\.|pages?)\s*(\d{1,4})\b/gi
  for (const match of raw.matchAll(singleRe)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (covered.some((span) => start < span.end && end > span.start)) continue
    const n = Number(match[1])
    if (!Number.isFinite(n) || n < 1 || n > 9999) continue
    quotes.push({ at: start, pages: [Math.floor(n)] })
  }
  quotes.sort((a, b) => a.at - b.at)
  return quotes
}

/**
 * Page the answer named, when it is inside pageCount and that page's text
 * contains the fault code or the matched terms.
 * A range resolves to the page in the range that does.
 * An out-of-range quote, or a page that lacks the code and the terms, is ignored.
 */
export function resolveQuotedCitationPage(opts: {
  answer: string
  indexText: string
  query: string
  pageCount?: number
  /** Letter-prefixed tokens from the manual label (M22). Not fault codes. */
  ignoreCodes?: string[]
}): number | undefined {
  const count = effectivePageCount(opts.pageCount, opts.indexText)
  if (count == null) return undefined
  const indexText = String(opts.indexText || '')
  const query = String(opts.query || '')
  let chosen: number | undefined
  let chosenAt = Number.POSITIVE_INFINITY
  for (const quote of quotedPagesInAnswer(opts.answer)) {
    if (quote.at >= chosenAt) continue
    let bestPage: number | undefined
    let bestSupport = 0
    for (const page of quote.pages) {
      if (page > count) continue
      const body = indexPageBody(indexText, page)
      if (!body) continue
      const support = quotedPageSupport(body, query, indexText, opts.ignoreCodes)
      if (support <= 0) continue
      if (support > bestSupport || (support === bestSupport && page > (bestPage ?? 0))) {
        bestSupport = support
        bestPage = page
      }
    }
    if (bestPage == null) continue
    chosen = bestPage
    chosenAt = quote.at
  }
  return chosen
}

export type CatalogCiteRow = {
  id: number
  title?: string | null
  brand?: string | null
  storage_path?: string | null
  xai_file_id?: string | null
  page_count?: number | null
}

export function catalogCitationTitle(row: { title?: string | null; brand?: string | null }): string {
  const title = String(row.title || '').trim()
  const brand = String(row.brand || '').trim()
  if (!title) return brand
  if (!brand) return title
  if (title.toLowerCase().startsWith(brand.toLowerCase())) return title
  return `${brand} ${title}`.trim()
}

export function findCatalogRow(
  catalog: CatalogCiteRow[],
  hit: { fileId?: string; fileName?: string }
): CatalogCiteRow | null {
  const fileId = String(hit.fileId || '').trim()
  if (fileId) {
    const byFile = catalog.find((row) => String(row.xai_file_id || '').trim() === fileId)
    if (byFile && Number.isFinite(byFile.id) && byFile.id > 0) return byFile
  }
  const name = String(hit.fileName || '').trim()
  if (!name) return null
  let best: CatalogCiteRow | null = null
  let bestLen = 0
  for (const row of catalog) {
    if (!Number.isFinite(row.id) || row.id < 1) continue
    const path = String(row.storage_path || '')
    const base = storageBase(path)
    const sanitized = base.replace(/[^\w.\-]+/g, '_')
    for (const candidate of [base, sanitized]) {
      if (!candidate) continue
      if (!namesAlign(candidate, name) && compactKey(candidate) !== compactKey(name)) continue
      if (candidate.length <= bestLen) continue
      best = row
      bestLen = candidate.length
    }
  }
  return best
}

export type AttributablePassage = {
  text: string
  source: string
  page?: number
  section?: string
  fileId?: string
  fileName?: string
  fromSelectedIndex?: boolean
  indexText?: string
}

export type CitationAttributionScope = {
  fileIds?: Iterable<string>
  expectedFilenames?: string[]
  indexText?: string
  pageCount?: number
  catalog?: CatalogCiteRow[]
  indexTextByManualId?: Record<number, string>
}

export type ScopedCitation = {
  manualId: number
  title?: string
  page?: number
  section?: string
  /** Web viewer reads this on `_meta.citations`. See the module comment. */
  page_out_of_range?: true
}

export function passageOwnedBySelected(opts: {
  fileId?: string
  fileName?: string
  fromSelectedIndex?: boolean
  fileIds?: Iterable<string>
  expectedFilenames?: string[]
}): boolean {
  if (opts.fromSelectedIndex) return true
  const ids = opts.fileIds instanceof Set ? opts.fileIds : new Set(opts.fileIds || [])
  const fileId = String(opts.fileId || '').trim()
  if (fileId && ids.has(fileId)) return true
  const name = String(opts.fileName || '').trim()
  if (!name) return false
  return (opts.expectedFilenames || []).some((expected) => expected && namesAlign(expected, name))
}

function indexForManual(scope: CitationAttributionScope, manualId: number, owned: boolean, passage?: AttributablePassage): string {
  if (owned) return String(passage?.indexText || scope.indexText || '')
  return String(scope.indexTextByManualId?.[manualId] || '')
}

/**
 * Cite each passage as the manual it actually came from.
 * Passages that match neither the selected manual nor a catalog row are dropped.
 * An empty part list still yields one bare cite of the selected manual (document chip).
 */
export function attributeCitations(
  parts: AttributablePassage[],
  manualId: number,
  fallbackTitle: string,
  scope: CitationAttributionScope = {}
): ScopedCitation[] {
  if (!Number.isSafeInteger(manualId) || manualId < 1) return []
  if (!parts.length) return [{ manualId, title: fallbackTitle }]
  const catalog = scope.catalog || []
  const out: ScopedCitation[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    const fileName = part.fileName || part.source
    const owned = passageOwnedBySelected({
      fileId: part.fileId,
      fileName,
      fromSelectedIndex: part.fromSelectedIndex,
      fileIds: scope.fileIds,
      expectedFilenames: scope.expectedFilenames,
    })
    let citeId = manualId
    let title = fallbackTitle || part.source
    let pageCount = effectivePageCount(scope.pageCount, scope.indexText)
    let indexText = indexForManual(scope, manualId, true, part)
    if (!owned) {
      const row = findCatalogRow(catalog, { fileId: part.fileId, fileName })
      if (!row) continue
      citeId = row.id
      title = catalogCitationTitle(row) || title
      indexText = indexForManual(scope, row.id, row.id === manualId, part)
      pageCount = effectivePageCount(row.page_count, indexText || scope.indexTextByManualId?.[row.id])
      if (row.id === manualId) pageCount = effectivePageCount(scope.pageCount ?? row.page_count, indexText || scope.indexText)
    }
    const physical = reconcilePhysicalPage({
      reported: part.page,
      passage: part.text,
      indexText: part.fromSelectedIndex ? undefined : indexText,
      trustReported: part.fromSelectedIndex === true,
    })
    const bounded = boundCitationPage(physical, pageCount)
    const section = part.section
    const key = `${citeId}|${bounded.page || ''}|${section || ''}|${bounded.page_out_of_range ? 1 : 0}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      manualId: citeId,
      title,
      ...(bounded.page ? { page: bounded.page } : {}),
      ...(section ? { section } : {}),
      ...(bounded.page_out_of_range ? { page_out_of_range: true } : {}),
    })
  }
  return out
}
