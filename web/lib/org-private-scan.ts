/**
 * Static scan: user-scoped (non-service-role) code must never select, filter
 * or order on the organizations private columns (000932). Those columns are
 * not readable by anon/authenticated, so PostgREST answers 403 42501.
 * Used by lib/org-private-scan.test.ts.
 */
import { ORG_PRIVATE_COLUMNS } from './org-columns.ts';

const PRIVATE = new Set<string>(ORG_PRIVATE_COLUMNS as readonly string[]);
const FILTER_FNS = 'eq|neq|gt|gte|lt|lte|like|ilike|is|in|not|contains|containedBy|match|imatch|filter|textSearch|order|overlaps|rangeGt|rangeLt';

export const usesServiceRoleOnly = (src: string): boolean =>
  /getSupabaseAdmin|createNodeServiceClient|FounderClaimAdmin|SUPABASE_SERVICE_ROLE_KEY/.test(src) &&
  !/getSupabaseClient\(|createBrowserClient|useSupabase\(/.test(src);

/** Column names referenced by a PostgREST .or()/.not() logic string (e.g. "notes.is.null,name.ilike.*x*"). */
export function columnsInLogicString(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/(?:^|[,(])\s*(?:not\.)?(?:and|or)?\(?\s*([a-z_][a-z0-9_]*)\.(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|match|imatch|fts|plfts|phfts|wfts|ov|sl|sr|nxl|nxr|adj)\b/gi)) {
    out.push(m[1].toLowerCase());
  }
  return out;
}

function columnsInSelect(sel: string): string[] {
  return sel
    .replace(/[()]/g, ',')
    .split(',')
    .map((c) => c.trim().replace(/^[a-z_]+:/i, '').replace(/::.*$/, '').trim())
    .filter(Boolean);
}

/** Resolve string constants (`const X = '...'`) so .or(X) is checked too. */
export function stringConstants(sources: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const src of sources) {
    for (const m of src.matchAll(/(?:const|let)\s+([A-Z_a-z][A-Za-z0-9_]*)\s*(?::\s*string)?\s*=\s*(?:\n\s*)?(?:'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`)/g)) {
      map.set(m[1], m[2] ?? m[3] ?? m[4] ?? '');
    }
  }
  return map;
}

/** Findings for one file: "line N: what". */
export function scanOrgPrivateUse(src: string, constants: Map<string, string>): string[] {
  if (usesServiceRoleOnly(src)) return [];
  const findings: string[] = [];
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  const resolveArg = (raw: string): string => {
    const t = raw.trim();
    const lit = t.match(/^(['"`])([\s\S]*)\1$/s);
    if (lit) return lit[2];
    return constants.get(t) ?? '';
  };

  // 1. Chains on from('organizations'): select list, filter/order column args, .or()/.not() strings.
  for (const m of src.matchAll(/\b(?:from|q|table)\(\s*['"]organizations['"]\s*\)/g)) {
    const start = m.index! + m[0].length;
    const rest = src.slice(start, start + 1500);
    const end = rest.search(/;|\.from\(|\n\s*\n/);
    const chain = end >= 0 ? rest.slice(0, end) : rest;
    const at = lineOf(m.index!);
    const sel = chain.match(/\.select\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|([A-Za-z_][A-Za-z0-9_]*))/);
    const selText = sel ? (sel[1] ?? sel[2] ?? sel[3] ?? constants.get(sel[4] || '') ?? '') : '';
    if (selText) {
      for (const c of columnsInSelect(selText)) if (PRIVATE.has(c)) findings.push(`line ${at}: select ${c}`);
    }
    for (const f of chain.matchAll(new RegExp(`\\.(${FILTER_FNS})\\(\\s*(['"])([a-z_]+)\\2`, 'g'))) {
      if (PRIVATE.has(f[3])) findings.push(`line ${at}: .${f[1]}('${f[3]}')`);
    }
    for (const o of chain.matchAll(/\.or\(\s*('[^']*'|"[^"]*"|`[^`]*`|[A-Za-z_][A-Za-z0-9_.]*)/g)) {
      for (const c of columnsInLogicString(resolveArg(o[1]))) {
        if (PRIVATE.has(c)) findings.push(`line ${at}: .or() on ${c}`);
      }
    }
  }

  // 2. Embedded organizations selects anywhere: organizations(...) / alias:organizations!fk(...) / organizations:fk(...).
  for (const m of src.matchAll(/organizations(?:![a-z_]+)?(?::[a-z_]+)?\s*\(([^()]*)\)/gi)) {
    for (const c of columnsInSelect(m[1])) {
      if (PRIVATE.has(c)) findings.push(`line ${lineOf(m.index!)}: embed organizations(${c})`);
    }
  }

  // 3. Filters/orders on embedded paths (organizations.<col>) and foreignTable/referencedTable orders.
  for (const m of src.matchAll(new RegExp(`\\.(${FILTER_FNS})\\(\\s*(['"])organizations\\.([a-z_]+)\\2`, 'g'))) {
    if (PRIVATE.has(m[3])) findings.push(`line ${lineOf(m.index!)}: .${m[1]}('organizations.${m[3]}')`);
  }
  for (const m of src.matchAll(/(?:foreignTable|referencedTable)\s*:\s*['"]organizations['"]/g)) {
    const before = src.slice(Math.max(0, m.index! - 200), m.index!);
    const c = before.match(/\.(?:or|order)\(\s*(['"`])([^'"`]*)\1[^]*$/);
    if (c) {
      const cols = c[0].startsWith('.or') ? columnsInLogicString(c[2]) : [c[2]];
      for (const col of cols) if (PRIVATE.has(col)) findings.push(`line ${lineOf(m.index!)}: referenced organizations ${col}`);
    }
  }
  return [...new Set(findings)];
}
