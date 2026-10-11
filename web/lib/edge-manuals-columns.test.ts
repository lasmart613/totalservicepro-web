import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const functionsRoot = join(here, '../../supabase/functions');

/** Columns the live manuals table does not have. Selecting one is a PostgREST 400. */
const MISSING_MANUALS_COLUMNS = ['page_count', 'xai_file_id', 'xai_public_url'];

function edgeSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...edgeSources(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

test('edge functions never select a column the manuals table does not have', () => {
  const files = edgeSources(functionsRoot);
  assert.ok(files.length > 0);
  const offenders: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const re = /\.from\(\s*['"]manuals['"]\s*\)\s*\.select\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
    for (const match of src.matchAll(re)) {
      const columns = match[1];
      for (const column of MISSING_MANUALS_COLUMNS) {
        if (new RegExp(`\\b${column}\\b`).test(columns)) offenders.push(`${file}: ${columns}`);
      }
    }
    // Raw REST calls too.
    if (/\/rest\/v1\/manuals\?[^'"`]*select=[^'"`]*\b(page_count|xai_file_id)\b/.test(src)) {
      offenders.push(`${file}: raw /rest/v1/manuals select`);
    }
  }
  assert.deepEqual(offenders, []);
});
