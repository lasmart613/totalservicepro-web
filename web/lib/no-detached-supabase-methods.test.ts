/**
 * Static guard: no source file may detach a Supabase client method.
 * SupabaseClient.rpc / .from and StorageClient.from read `this`; e6913763
 * shipped `const rpc = db.rpc;` and every chunked index write threw
 * "Cannot read properties of undefined (reading 'rest')". Call the method on
 * the client, or bind it: `db.rpc.bind(db)`.
 *
 * Flags, outside *.test.* files:
 *   x = client.rpc;          x = client.from;   (also ?. and storage.from;
 *                                               .from only on client-shaped
 *                                               names: db, admin, supabase...)
 *   { rpc } = client         { from, rpc } = client
 *   (client.rpc)  / , client.rpc,   (passed as a callback)
 * The runtime check is lib/manual-search-index-real-client.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(webRoot, '..');
const SKIP = new Set(['node_modules', '.next', 'out', 'build', 'dist', 'public', '.netlify']);
const SOURCE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const TEST = /\.test\.(ts|tsx|mts|mjs|js)$/;

/** `.rpc` on anything; `.from` only on client-shaped receivers (span.from is a number). */
const METHOD =
  String.raw`(?:[\w$.]+?\??\.rpc|(?:\b(?:db|admin|supabase|client|sb|svc|service)\w*|\w*(?:Client|Admin|Db)|[\w$.]*storage)\??\.from)`;
const PATTERNS: Array<[string, RegExp]> = [
  ['assigned', new RegExp(String.raw`=\s*${METHOD}\s*(;|$|\)|,|\?\?|\|\|)`)],
  ['destructured', /\{\s*[^}]*\brpc\b[^}]*\}\s*=\s*(?!await\b)[\w$.]+\s*(;|$)/],
  [
    'destructured',
    /\{\s*[^}]*\bfrom\b[^}]*\}\s*=\s*(?:\b(?:db|admin|supabase|client|sb|svc|service)\w*|\w*(?:Client|Admin|Db)|[\w$.]*storage)\s*(;|$)/,
  ],
  ['callback', new RegExp(String.raw`[(,]\s*${METHOD}\s*[),]`)],
];

function walk(dir: string, out: string[]) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SOURCE.test(e.name) && !TEST.test(e.name)) out.push(p);
  }
}

export function detachedSupabaseMethods(source: string): Array<{ line: number; kind: string; text: string }> {
  const hits: Array<{ line: number; kind: string; text: string }> = [];
  source.split('\n').forEach((text, i) => {
    const code = text.replace(/\/\/.*$/, '');
    if (/^\s*(\*|\/\*)/.test(code)) return;
    for (const [kind, re] of PATTERNS) {
      if (re.test(code) && !/\.bind\(/.test(code) && !/\b(Array|Buffer|Uint8Array|Object)\.from\b/.test(code)) {
        hits.push({ line: i + 1, kind, text: text.trim() });
      }
    }
  });
  return hits;
}

test('detachedSupabaseMethods flags the e6913763 shapes and allows bound or direct calls', () => {
  assert.equal(detachedSupabaseMethods('  const rpc = db.rpc;').length, 1);
  assert.equal(detachedSupabaseMethods('  const from = supabase.from;').length, 1);
  assert.equal(detachedSupabaseMethods('  const bucket = admin.storage.from;').length, 1);
  assert.equal(detachedSupabaseMethods('  const { rpc } = db;').length, 1);
  assert.equal(detachedSupabaseMethods('  await Promise.all(names.map(db.rpc));').length, 1);
  assert.equal(detachedSupabaseMethods('  const rpc = db.rpc.bind(db);').length, 0);
  assert.equal(detachedSupabaseMethods("  const res = await db.rpc('f', {});").length, 0);
  assert.equal(detachedSupabaseMethods("  const q = admin.from('manuals').select('id');").length, 0);
  assert.equal(detachedSupabaseMethods('  const xs = Array.from(set);').length, 0);
  assert.equal(detachedSupabaseMethods('  const start = Math.min(span.from, len) / len;').length, 0);
  assert.equal(detachedSupabaseMethods('  const { from, to } = range;').length, 0);
  assert.equal(detachedSupabaseMethods('  const { from } = admin.storage;').length, 1);
  assert.equal(detachedSupabaseMethods("  if (typeof db.rpc !== 'function') return;").length, 0);
});

test('no source file under web/ or supabase/ detaches a Supabase rpc/from method', () => {
  const files: string[] = [];
  walk(webRoot, files);
  walk(join(repoRoot, 'supabase'), files);
  assert.ok(files.length > 100, `only ${files.length} source files found`);
  const found: string[] = [];
  for (const file of files) {
    for (const hit of detachedSupabaseMethods(readFileSync(file, 'utf8'))) {
      found.push(`${relative(repoRoot, file)}:${hit.line} (${hit.kind}) ${hit.text}`);
    }
  }
  assert.deepEqual(found, []);
});
