/**
 * Pure fault-code token extraction for grok-assistant.
 *
 * DB `fault_codes.fault_code` is the source of truth for meanings — this helper
 * only pulls identifiers from technician phrasing. E/F prefixes are stripped so
 * "E322" matches stored '322'. W-/A-/POS-/ER prefixes are kept (Candela-style).
 *
 * Examples:
 *   "I am getting 322 and 367 error codes" → ["322", "367"]
 *   "E322 and E367 on Cutera Xeo" → ["322", "367"]
 *   "look up 322 for Cutera Xeo" → ["322"]
 *   "look up 322 or 367 for the Cutera Xeo" → ["322", "367"]
 *   "F-12.5 alarm" → ["12.5"]
 *   "W-123 on the Vbeam" → ["W-123"]
 */

export const MAX_FAULT_CODES = 5

const FAULT_LANG =
  /\b(faults?|errors?|alarms?|codes?|look(?:ed|ing)?\s*up|lookups?)\b/i

/** 3-digit (or dotted) series used on Cutera Xeo and similar boards. */
const BARE_SERIES = /\b(\d{3}(?:\.\d+)?)\b/g

function isLikelyYear(token: string): boolean {
  if (token.includes('.')) return false
  const n = Number(token)
  return n >= 1900 && n <= 2099
}

function isUnitSuffix(msg: string, end: number): boolean {
  return /^\s*(?:nm|v(?:olts?)?|w(?:atts?)?|hz|khz|mhz|ma|kw|%|°|deg)\b/i.test(msg.slice(end))
}

function normalizeKept(raw: string): string {
  return raw.replace(/\s+/g, '')
}

/**
 * Unique fault codes in appearance order, capped at MAX_FAULT_CODES.
 */
export function extractFaultCodes(msg: string): string[] {
  if (!msg) return []

  type Hit = { index: number; code: string }
  const hits: Hit[] = []

  const add = (index: number, code: string) => {
    const trimmed = normalizeKept(code)
    if (!trimmed) return
    hits.push({ index, code: trimmed })
  }

  // E322 / e322 / E-322 / F-322 / f322 → numeric (or dotted) DB code
  for (const m of msg.matchAll(/\b[ef][-\s]?(\d+(?:\.\d+)?)\b/gi)) {
    if (m.index == null) continue
    add(m.index, m[1])
  }

  // Candela-style prefixes stored with the prefix
  for (const m of msg.matchAll(/\b(w-\d+|a-\d+|pos-\d+)\b/gi)) {
    if (m.index == null) continue
    add(m.index, m[1])
  }
  for (const m of msg.matchAll(/\b(er\s*\d+)\b/gi)) {
    if (m.index == null) continue
    add(m.index, m[1])
  }

  // Adjacent fault/error/alarm/code language (any length / dotted)
  for (const m of msg.matchAll(/(?:faults?|errors?|alarms?|codes?)\s*[:=#-]?\s*(\d+(?:\.\d+)?)/gi)) {
    if (m.index == null) continue
    add(m.index + m[0].lastIndexOf(m[1]), m[1])
  }
  for (const m of msg.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:faults?|errors?|alarms?|codes?)\b/gi)) {
    if (m.index == null) continue
    add(m.index, m[1])
  }

  const discussesFaults = FAULT_LANG.test(msg)
  const listedNearFault =
    discussesFaults &&
    /\d{3}(?:\.\d+)?(?:\s*,\s*|\s+(?:and|or|&)\s+)(?:[ef][-\s]?)?\d{3}/i.test(msg)

  // Bare 3-digit series when the message is about faults/lookups (or a listed pair)
  if (discussesFaults || listedNearFault) {
    for (const m of msg.matchAll(BARE_SERIES)) {
      if (m.index == null) continue
      if (isLikelyYear(m[1])) continue
      if (isUnitSuffix(msg, m.index + m[1].length)) continue
      add(m.index, m[1])
    }
  }

  hits.sort((a, b) => a.index - b.index)
  const out: string[] = []
  const seen = new Set<string>()
  for (const h of hits) {
    const key = h.code.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h.code)
    if (out.length >= MAX_FAULT_CODES) break
  }
  return out
}

/** First extracted code, or null. Backward-compatible wrapper. */
export function extractFaultCode(msg: string): string | null {
  return extractFaultCodes(msg)[0] ?? null
}
