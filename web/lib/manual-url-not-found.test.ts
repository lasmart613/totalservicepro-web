import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const src = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');
const NOT_FOUND = 'if (manualRowMissing(q)) return json(404, { error: "not_found" });';

test('a missing manuals row is a lookup that succeeded with no data, not a lookup error', () => {
  const fn = src.slice(src.indexOf('function manualRowMissing('), src.indexOf('function json('));
  assert.match(fn, /return !q\.error && \(q\.data == null \|\|/);
});

test('POST: missing manual id returns 404 not_found before the library and add checks', () => {
  const post = src.slice(src.indexOf('// ---------- POST ----------'));
  const lookup = post.indexOf('query.eq("id", manualId).maybeSingle()');
  const notFound = post.indexOf(NOT_FOUND);
  const unpublished = post.indexOf('const hidden = unpublishedManualResponse(man);');
  const add = post.indexOf('if (wantAdd) {');
  const requiresAdd = post.indexOf('requires_add: true');
  assert.ok(lookup > 0 && notFound > lookup, '404 follows the id lookup');
  assert.ok(notFound < unpublished, 'unpublished handling stays after, unchanged');
  assert.ok(notFound < add && notFound < requiresAdd, '404 comes before any requires_add response');
  // Only the by-id branch 404s; storage_path lookups keep the ownership path.
  const byPath = post.slice(post.indexOf('} else if (storagePath) {'), unpublished);
  assert.doesNotMatch(byPath, /manualRowMissing/);
});

test('GET: missing manual id returns 404 before the library check; unpublished unchanged', () => {
  const get = src.slice(0, src.indexOf('// ---------- POST ----------'));
  const notFound = get.indexOf(NOT_FOUND);
  const unpublished = get.indexOf('const hidden = unpublishedManualResponse(man);');
  const library = get.indexOf('const libraryOk =');
  assert.ok(notFound > 0 && notFound < unpublished && unpublished < library);
});

test('unpublished handling is untouched', () => {
  assert.equal((src.match(/const hidden = unpublishedManualResponse\(man\);\s*if \(hidden\) return hidden;/g) || []).length, 2);
});
