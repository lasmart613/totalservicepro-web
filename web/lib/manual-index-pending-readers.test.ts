import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexWriteInProgress, pendingIndexIds } from '../../supabase/functions/_shared/index-pending.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const fns = join(here, '../../supabase/functions');

type Res = { data: unknown; error: { code?: string; message?: string } | null };

function db(answer: (filter: { op: string; value: unknown }) => Res | Promise<Res>) {
  const tables: string[] = [];
  return {
    tables,
    from(table: string) {
      tables.push(table);
      const q: any = {
        select: () => q,
        eq: (_c: string, value: unknown) => answer({ op: 'eq', value }),
        in: (_c: string, value: unknown) => answer({ op: 'in', value }),
      };
      return q;
    },
  };
}

const missingTable = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.manual_search_index_pending' in the schema cache" } };

test('pendingIndexIds returns the ids with a marker (eq for one id, in for several)', async () => {
  const seen: Array<{ op: string; value: unknown }> = [];
  const client = db((f) => {
    seen.push(f);
    return { data: [{ manual_id: 1195 }, { manual_id: 99 }], error: null };
  });
  assert.deepEqual([...((await pendingIndexIds(client, [1195, 1210])) || [])], [1195]);
  assert.deepEqual([...((await pendingIndexIds(client, [1210])) || [])], []);
  assert.deepEqual(seen, [{ op: 'in', value: [1195, 1210] }, { op: 'eq', value: 1210 }]);
  assert.equal(client.tables.every((t) => t === 'manual_search_index_pending'), true);
  assert.deepEqual([...((await pendingIndexIds(client, [])) || [])], []);
});

test('no marker table (000918 not applied) means nothing in progress', async () => {
  for (const error of [missingTable.error, { code: '42P01', message: 'relation "public.manual_search_index_pending" does not exist' }]) {
    const client = db(() => ({ data: null, error }));
    assert.deepEqual([...((await pendingIndexIds(client, [5])) || [])], []);
    assert.equal(await indexWriteInProgress(client, 5), false);
  }
});

test('an unreadable marker fails closed: partial rows are never served', async () => {
  const denied = db(() => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
  assert.equal(await pendingIndexIds(denied, [5]), null);
  assert.equal(await indexWriteInProgress(denied, 5), true);
  const thrown = db(() => {
    throw new Error('network');
  });
  assert.equal(await pendingIndexIds(thrown, [5]), null);
  assert.equal(await indexWriteInProgress(thrown, 5), true);
  const busy = db(() => ({ data: [{ manual_id: 5 }], error: null }));
  assert.equal(await indexWriteInProgress(busy, 5), true);
  const idle = db(() => ({ data: [], error: null }));
  assert.equal(await indexWriteInProgress(idle, 5), false);
});

test('get-manual-url checks the marker before reading index page bounds', () => {
  const src = readFileSync(join(fns, 'get-manual-url/index.ts'), 'utf8');
  assert.match(src, /import \{ indexWriteInProgress \} from "\.\.\/_shared\/index-pending\.ts";/);
  const fn = src.slice(src.indexOf('async function loadIndexPageBound('));
  const gate = fn.indexOf('if (await indexWriteInProgress(admin, id)) return unknown;');
  assert.ok(gate > 0);
  assert.ok(gate < fn.indexOf('.from("manual_search_index")'));
});

test('grok-assistant hides partial index text for excerpts and catalog cites', () => {
  const src = readFileSync(join(fns, 'grok-assistant/index.ts'), 'utf8');
  assert.match(src, /import \{ pendingIndexIds \} from '\.\.\/_shared\/index-pending\.ts'/);
  const joined = src.slice(src.indexOf('async function loadJoinedSearchText('));
  const gate = joined.indexOf("if (!pending || pending.has(manualId)) return ''");
  assert.ok(gate > 0 && gate < joined.indexOf(".from('manual_search_index')"));
  // Catalog cites read the index only for ids with no write in progress.
  assert.match(src, /const readable = pending \? ids\.filter\(\(id\) => !pending\.has\(id\)\) : \[\]/);
  assert.doesNotMatch(src, /\.from\('manual_search_index'\)[^\n]*\.in\('manual_id', ids\)/);
});
