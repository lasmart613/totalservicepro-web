import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const functionsRoot = join(here, '../../supabase/functions');
const typesFile = join(here, '../src/types/supabase.ts');

function edgeSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...edgeSources(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Column names of Database['public']['Tables']['manuals']['Row'] in the generated types. */
export function manualsRowColumns(typesSource: string): Set<string> {
  const block = typesSource.match(/\n\s*manuals:\s*\{\s*Row:\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(block, 'manuals Row type not found in web/src/types/supabase.ts');
  const columns = new Set<string>();
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
    if (m) columns.add(m[1]);
  }
  assert.ok(columns.size >= 5, 'manuals Row type parsed too few columns');
  return columns;
}

/** Inline `${NAME}` from a `const NAME = '...'` (or template) in the same file. */
function resolveTemplate(literal: string, src: string, file: string): string {
  return literal.replace(/\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g, (_all, name: string) => {
    const def = src.match(new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*(\`[^\`]*\`|'[^']*'|"[^"]*")`));
    assert.ok(def, `${file}: cannot resolve \${${name}} in a manuals select`);
    return resolveTemplate(def[1].slice(1, -1), src, file);
  });
}

/** Top-level column names of a PostgREST select list (aliases, casts, embeds handled). */
export function selectColumns(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out
    .map((part) => part.trim())
    .filter((part) => part && part !== '*' && !part.includes('('))
    .map((part) => (part.includes(':') && !part.includes('::') ? part.split(':').pop()! : part))
    .map((part) => part.split('::')[0].trim());
}

type Found = { file: string; kind: string; columns: string };

/** Non-literal manuals selects the guard cannot check. Must stay empty. */
const unchecked: string[] = [];
/** Per file: how many `columns:` entries fed a .select(x.columns). */
const columnsEntries = new Map<string, number>();

function collectManualsSelects(files: string[]): Found[] {
  const found: Found[] = [];
  const lit = '(`[^`]*`|\'[^\']*\'|"[^"]*")';
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    // queryManual's own body selects `${columns},published` from its
    // parameter; the callers' column lists are checked below instead.
    const defAt = src.search(/function\s+queryManual\s*\(/);
    const defEnd = defAt >= 0 ? src.indexOf('\n}\n', defAt) : -1;
    const inHelper = (at: number) => defAt >= 0 && at > defAt && at < defEnd;
    const add = (kind: string, raw: string) =>
      found.push({ file, kind, columns: resolveTemplate(raw.slice(1, -1), src, file) });
    for (const m of src.matchAll(new RegExp(`\\.from\\(\\s*['"]manuals['"]\\s*\\)\\s*\\.select\\(\\s*${lit}`, 'g'))) {
      if (inHelper(m.index ?? -1)) continue;
      add('from(manuals).select', m[1]);
    }
    // .select(NAME) / .select(x.columns): a non-literal argument.
    let selectsColumnsField = false;
    for (const m of src.matchAll(/\.from\(\s*['"]manuals['"]\s*\)\s*\.select\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*[,)]/g)) {
      if (inHelper(m.index ?? -1)) continue;
      const arg = m[1];
      if (/\.columns$/.test(arg)) {
        // Checked through the `columns:` entries below.
        selectsColumnsField = true;
        continue;
      }
      if (arg.includes('.')) {
        unchecked.push(`${file}: .from('manuals').select(${arg}) is not a const or a columns: entry`);
        continue;
      }
      // Bare identifier: must be a const in this file.
      found.push({ file, kind: `select(${arg})`, columns: resolveTemplate(`\${${arg}}`, src, file) });
    }
    // `columns: <string or CONST>` entries feeding .select(x.columns), e.g.
    // grok-assistant's selectManualRows attempts.
    if (selectsColumnsField) {
      const entries = [
        ...src.matchAll(new RegExp(`\\bcolumns:\\s*(${lit.slice(1, -1)}|[A-Z_][A-Z0-9_]*)\\s*[,}]`, 'g')),
      ];
      columnsEntries.set(file, entries.length);
      for (const e of entries) {
        const raw = e[1];
        const text = /^[`'"]/.test(raw) ? raw.slice(1, -1) : `\${${raw}}`;
        found.push({ file, kind: 'columns: entry', columns: resolveTemplate(text, src, file) });
      }
    }
    // queryManual(client, "<columns>", ...) — first string argument. The
    // definition's parameter list has no string literal, so it is skipped.
    for (const m of src.matchAll(new RegExp(`\\bqueryManual\\(\\s*[^,()]+,\\s*${lit}`, 'g'))) {
      add('queryManual', m[1]);
    }
    for (const m of src.matchAll(/\/rest\/v1\/manuals\?[^'"`\s]*select=([^&'"`\s]+)/g)) {
      found.push({ file, kind: 'rest select', columns: decodeURIComponent(m[1]) });
    }
  }
  return found;
}

test('manuals Row type parser and select splitter', () => {
  const cols = manualsRowColumns(readFileSync(typesFile, 'utf8'));
  for (const c of ['id', 'title', 'storage_path', 'published', 'chapter_metadata']) assert.ok(cols.has(c), c);
  assert.ok(!cols.has('page_count'));
  assert.ok(!cols.has('xai_file_id'));
  assert.ok(!cols.has('xai_public_url'));
  assert.deepEqual(selectColumns('id, label:title, storage_path::text, owner(id, name), *'), [
    'id',
    'title',
    'storage_path',
  ]);
});

test('edge functions select only real manuals columns, including every queryManual call', () => {
  const real = manualsRowColumns(readFileSync(typesFile, 'utf8'));
  // queryManual appends `,published` itself; it is a real column, listed for clarity.
  real.add('published');
  const files = edgeSources(functionsRoot);
  assert.ok(files.length > 0);
  const found = collectManualsSelects(files);

  assert.deepEqual(unchecked, []);
  // grok-assistant's selectManualRows passes attempt.columns; its entries must be found.
  const grok = [...columnsEntries.entries()].find(([file]) => /grok-assistant[\\/]index\.ts$/.test(file));
  assert.ok(grok && grok[1] > 0, 'found zero columns: entries in grok-assistant');
  assert.ok(found.some((f) => f.kind === 'select(CATALOG_CITE_COLUMNS)'), 'bare-identifier select not resolved');

  const queryManualCalls = found.filter((f) => f.kind === 'queryManual');
  assert.ok(queryManualCalls.length > 0, 'found zero queryManual( calls — the extractor is broken');
  assert.ok(found.some((f) => f.kind === 'from(manuals).select'), 'found zero .from(manuals).select calls');

  const offenders: string[] = [];
  for (const f of found) {
    for (const column of selectColumns(f.columns)) {
      if (!real.has(column)) offenders.push(`${f.file} [${f.kind}] ${column} (in "${f.columns}")`);
    }
  }
  assert.deepEqual(offenders, []);
});
