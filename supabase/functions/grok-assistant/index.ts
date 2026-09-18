import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  asManualId,
  excerptManualSearchText,
  folderPrefixForAiAttach,
  pdfPathsForAiAttach,
  resolveManualFromCatalog,
} from './manual-scope.ts'
import { TSP_XAI_COLLECTION_ID, uploadPdfToTspCollection } from './xai-collection.ts'
import { extractFaultCodes } from './fault-codes.ts'
import {
  applyFileNameMap,
  chapterFileKeys,
  collectionHitsFromResponse,
  collectionNameFilters,
  collectionSearchBody,
  expectedFilenamesForPaths,
  fileIdNameMapFromDocuments,
  filterHitsForManual,
  pickCollectionAttachments,
  pickFileIdsForManual,
  retrievedFromHits,
  storageBasename,
  type CollectionHit,
} from './collection-search.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TSP_COLLECTION_ID = TSP_XAI_COLLECTION_ID

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

type Retrieved = { text: string; source: string }

async function listCollectionDocumentsByName(
  managementKey: string,
  nameQuery: string
): Promise<Record<string, string>> {
  const filter = `name:"${String(nameQuery).replace(/"/g, '')}"`
  const url =
    `https://management-api.x.ai/v1/collections/${TSP_COLLECTION_ID}/documents` +
    `?limit=50&filter=${encodeURIComponent(filter)}`
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${managementKey}` } })
    if (!res.ok) {
      console.warn('list collection documents failed', res.status, nameQuery)
      return {}
    }
    return fileIdNameMapFromDocuments(await res.json())
  } catch (e) {
    console.warn('list collection documents error', nameQuery, e)
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
    const res = await fetch(
      `https://management-api.x.ai/v1/collections/${TSP_COLLECTION_ID}/documents/${fileId}`,
      { headers: { Authorization: `Bearer ${managementKey}` } }
    )
    if (res.ok) {
      const map = fileIdNameMapFromDocuments([await res.json()])
      if (map[fileId]) return map[fileId]
    }
  } catch {
    /* try files API */
  }
  if (!apiKey) return ''
  try {
    const fr = await fetch(`https://api.x.ai/v1/files/${fileId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!fr.ok) return ''
    const j = (await fr.json()) as { filename?: string; name?: string }
    return String(j.filename || j.name || '').trim()
  } catch {
    return ''
  }
}

async function resolveCollectionManualDocs(opts: {
  managementKey: string
  apiKey?: string
  expectedFilenames: string[]
  tokens: string[]
  chapterKeys: string[]
  hits: CollectionHit[]
}): Promise<{ nameById: Record<string, string>; fileIds: Set<string> }> {
  const nameById: Record<string, string> = {}
  for (const q of collectionNameFilters(opts.expectedFilenames, opts.tokens)) {
    Object.assign(nameById, await listCollectionDocumentsByName(opts.managementKey, q))
    const scoped = pickFileIdsForManual(nameById, opts.expectedFilenames, opts.tokens, opts.chapterKeys)
    if (opts.expectedFilenames.length && scoped.size >= Math.min(2, opts.expectedFilenames.length)) break
  }

  const unnamedIds = [...new Set(opts.hits.map((h) => h.fileId).filter((id) => id && !nameById[id]))]
  for (const id of unnamedIds.slice(0, 8)) {
    const name = await lookupCollectionFileName(opts.managementKey, id, opts.apiKey)
    if (name) nameById[id] = name
  }

  return {
    nameById,
    fileIds: pickFileIdsForManual(nameById, opts.expectedFilenames, opts.tokens, opts.chapterKeys),
  }
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
  const sr = await fetch('https://api.x.ai/v1/documents/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_KEY}` },
    body: JSON.stringify(collectionSearchBody(query, TSP_COLLECTION_ID, mode)),
  })
  if (!sr.ok) {
    console.error('documents/search failed', sr.status, await sr.text())
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
    `Selected device/manual: ${selectedLabel || '(none)'}. Answer only from these passages about this device.\n\n` +
    parts.map((p, i) => `[${i + 1}] (${p.source})\n${p.text}`).join('\n---\n') +
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
          let searched = await searchManualCollection(
            XAI_KEY,
            sq,
            matchTokens,
            !!manualLabel,
            chapterKeys,
            undefined,
            'hybrid',
            expectedFilenames
          )

          if (manageKey && (manualLabel || expectedFilenames.length || searched.hits.some((h) => h.fileId))) {
            const resolved = await resolveCollectionManualDocs({
              managementKey: manageKey,
              apiKey: XAI_KEY,
              expectedFilenames,
              tokens: matchTokens,
              chapterKeys,
              hits: searched.hits,
            })
            collectionNameById = resolved.nameById
            selectedCollectionFileIds = resolved.fileIds
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

          if (!parts.length && faultCodes.length) {
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
            citationLine = `\n\n— Source: ${manCite}`
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
      const wantPdfs = !!manualLabel && !voiceMode && (schematicQ || !hasManualPassages)
      let attachedNames: string[] = []
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
            const fileCite = `\n\n— Source: ${manualLabel} collection PDFs: ${attachedNames.join('; ')}`
            const attachPrompt =
              systemContent +
              `\n\n## ATTACHED MANUAL PDFs\nThese files are already in the Grok collection for "${manualLabel}". They ARE readable. Quote exact wording. Do not say the service manual is unavailable.\n` +
              collectionFiles.map((s, i) => `[PDF ${i + 1}] ${s.name}`).join('\n')
            const rr = await fetch('https://api.x.ai/v1/responses', {
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
            })
            if (rr.ok) {
              const rd = await rr.json()
              const txt = textFromResponses(rd)
              if (txt) {
                await logUsage(db, uid, 'grok_chat', rd.usage?.total_tokens || 0)
                const content = (txt.trim() + (citationLine || fileCite)).trim()
                return new Response(
                  JSON.stringify({
                    choices: [{ message: { role: 'assistant', content } }],
                    usage: rd.usage || {},
                    _usage: {
                      text: { used: usage.text + 1, limit: limits.text },
                      voice: { used: usage.voice, limit: limits.voice },
                    },
                    _meta: {
                      manualLabel,
                      manualId: manualMeta?.id ?? null,
                      hasFaultDBHit,
                      hasManualPassages,
                      hasCollectionPdfs,
                      attachedPdfs: attachedNames,
                      matchTokens,
                    },
                  }),
                  { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
              }
            } else {
              console.warn('responses+collection files failed', rr.status, await rr.text())
            }
          } else if (manualMeta && attachPaths.length && !hasCollectionPdfs) {
            const chapterList = attachPaths.map((p) => ({ storage_path: p, title: manualMeta.title }))
            const picks = pickRelevantChapters(
              chapterList,
              userText,
              schematicQ,
              manualMeta.entry_file_path || attachPaths[0] || ''
            )
            const signed: { name: string; url: string }[] = []
            for (const ch of picks) {
              const url = await signStoragePdf(ch.storage_path)
              if (url) signed.push({ name: basenamePath(ch.storage_path) || ch.title, url })
            }
            if (signed.length) {
              attachedNames = signed.map((s) => s.name)
              const fileCite = `\n\n— Source: ${manualLabel} PDFs: ${attachedNames.join('; ')}`
              const attachPrompt =
                systemContent +
                `\n\n## ATTACHED MANUAL PDFs\nThe following PDFs from "${manualLabel}" are attached. Read them, quote them, and interpret drawings/schematics.\n` +
                signed.map((s, i) => `[PDF ${i + 1}] ${s.name}`).join('\n')
              const rr = await fetch('https://api.x.ai/v1/responses', {
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
              })
              if (rr.ok) {
                const rd = await rr.json()
                const txt = textFromResponses(rd)
                if (txt) {
                  await logUsage(db, uid, 'grok_chat', rd.usage?.total_tokens || 0)
                  const content = (txt.trim() + (citationLine || fileCite)).trim()
                  return new Response(
                    JSON.stringify({
                      choices: [{ message: { role: 'assistant', content } }],
                      usage: rd.usage || {},
                      _usage: {
                        text: { used: usage.text + 1, limit: limits.text },
                        voice: { used: usage.voice, limit: limits.voice },
                      },
                      _meta: {
                        manualLabel,
                        manualId: manualMeta?.id ?? null,
                        hasFaultDBHit,
                        hasManualPassages,
                        hasCollectionPdfs,
                        attachedPdfs: attachedNames,
                        matchTokens,
                      },
                    }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                  )
                }
              } else {
                console.warn('responses+files failed', rr.status, await rr.text())
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

      const xr = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_KEY}` },
        body: JSON.stringify({
          model: 'grok-3-fast',
          messages: [{ role: 'system', content: systemContent }, ...chatMessages],
          temperature,
          stream: false,
        }),
      })
      if (!xr.ok) {
        const e = await xr.text()
        return new Response(JSON.stringify({ error: `AI error (${xr.status})`, details: e }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const xd = await xr.json()
      if (citationLine) {
        const ch = xd.choices?.[0]
        if (ch?.message?.content) ch.message.content = ch.message.content.trim() + citationLine
      }
      await logUsage(db, uid, 'grok_chat', xd.usage?.total_tokens || 0)
      xd._usage = {
        text: { used: usage.text + 1, limit: limits.text },
        voice: { used: usage.voice, limit: limits.voice },
      }
      xd._meta = {
        manualLabel,
        manualId: manualMeta?.id ?? null,
        hasFaultDBHit,
        hasManualPassages,
        hasCollectionPdfs,
        attachedPdfs: attachedNames,
        matchTokens,
      }
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
      const uploads = []
      for (const path of paths.slice(0, 8)) {
        const expected = expectedFilenamesForPaths([path])
        const listed: Record<string, string> = {}
        for (const q of collectionNameFilters(expected)) {
          Object.assign(listed, await listCollectionDocumentsByName(manageKey, q))
        }
        const existingIds = pickFileIdsForManual(listed, expected, [], [])
        const existingId = [...existingIds][0]
        if (existingId) {
          uploads.push({
            path,
            ok: true,
            fileId: existingId,
            filename: listed[existingId] || storageBasename(path),
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
