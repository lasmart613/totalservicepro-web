import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findManualIdsByBodyText,
  manualPartNumberTokens,
  partNumberNarrowQuery,
} from './manual-search-index.ts';
import { manualSearchTokens, sanitizeManualSearchQuery } from './manual-library-filter.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

type Call = {
  table: string;
  textSearch?: { column: string; query: string; options?: { type?: string; config?: string } };
  filters: Array<[string, string, string]>;
  inIds?: unknown[];
};

type Result = { data: unknown; error: { message?: string; code?: string } | null };

/**
 * Fake service-role client. `answer` decides each manual_search_index read;
 * manuals reads return `published` rows for the published filter.
 */
function fakeDb(answer: (call: Call) => Result, published: Array<{ id: number; published: boolean }> = []) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const builder: any = {
        select() {
          return builder;
        },
        textSearch(column: string, query: string, options?: { type?: string; config?: string }) {
          call.textSearch = { column, query, options };
          return builder;
        },
        filter(column: string, op: string, value: string) {
          call.filters.push([column, op, value]);
          return builder;
        },
        in(_column: string, ids: unknown[]) {
          call.inIds = ids;
          return builder;
        },
        then(resolve: (value: Result) => unknown, reject?: (err: unknown) => unknown) {
          try {
            if (table === 'manuals') {
              const wanted = new Set((call.inIds || []).map((id) => String(id)));
              const rows = published.length
                ? published.filter((row) => wanted.has(String(row.id)))
                : [...wanted].map((id) => ({ id: Number(id), published: true }));
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            }
            return Promise.resolve(answer(call)).then(resolve, reject);
          } catch (err) {
            return Promise.reject(err).then(resolve, reject);
          }
        },
      };
      return builder;
    },
  };
  return { db, calls, indexCalls: () => calls.filter((c) => c.table === 'manual_search_index') };
}

function search(db: unknown, raw: string) {
  const q = sanitizeManualSearchQuery(raw);
  return findManualIdsByBodyText(db as any, manualSearchTokens(q), q);
}

test('part-number tokens: digits with inner hyphens only', () => {
  assert.deepEqual(manualPartNumberTokens('7111-00-2709'), ['7111-00-2709']);
  assert.deepEqual(manualPartNumberTokens('lamp 8501-00-1800 GentleMAX'), ['8501-00-1800']);
  assert.deepEqual(manualPartNumberTokens('DP35-0643-906'), ['DP35-0643-906']);
  assert.deepEqual(manualPartNumberTokens('(7111-00-2709),'), ['7111-00-2709']);
  assert.deepEqual(manualPartNumberTokens('GentleMAX PRO'), []);
  assert.deepEqual(manualPartNumberTokens('hand-piece'), []);
  assert.deepEqual(manualPartNumberTokens('-00'), []);
  assert.deepEqual(manualPartNumberTokens('1064'), []);
  assert.equal(partNumberNarrowQuery(['7111-00-2709']), "'-00' & '-2709'");
  assert.equal(partNumberNarrowQuery(['DP35-0643-906', '8501-00-1800']), "'-0643' & '-906' & '-00' & '-1800'");
  assert.equal(partNumberNarrowQuery(['AB-CD-12X']), '');
});

test('hyphenated part number goes to plainto_tsquery as typed, not split at the hyphens', async () => {
  const { db, indexCalls } = fakeDb((call) =>
    call.textSearch?.query === '7111-00-2709' ? { data: [{ manual_id: 1 }], error: null } : { data: [], error: null },
  );
  const found = await search(db, '7111-00-2709');
  assert.deepEqual(found, { ids: ['1'], available: true });
  const first = indexCalls()[0];
  assert.deepEqual(first.textSearch, {
    column: 'search_tsv',
    query: '7111-00-2709',
    options: { type: 'plain', config: 'simple' },
  });
  assert.equal(indexCalls().length, 1);
});

test('8501-00-1800 returns every row FTS finds for the raw number (rows 1, 2, 8)', async () => {
  const { db } = fakeDb((call) =>
    call.textSearch?.query === '8501-00-1800'
      ? { data: [{ manual_id: 1 }, { manual_id: 2 }, { manual_id: 8 }, { manual_id: 1 }], error: null }
      : { data: [{ manual_id: 7 }, { manual_id: 22 }], error: null },
  );
  const found = await search(db, '8501-00-1800');
  assert.deepEqual(found.ids, ['1', '2', '8']);
});

test('raw FTS miss falls back to a literal match narrowed by the GIN index', async () => {
  const { db, indexCalls } = fakeDb((call) => {
    if (call.textSearch?.options?.type === 'plain') return { data: [], error: null };
    if (call.filters.length) return { data: [{ manual_id: 1 }], error: null };
    return { data: [], error: null };
  });
  const found = await search(db, 'PN 7111-00-2709');
  assert.deepEqual(found.ids, ['1']);
  const literal = indexCalls()[1];
  assert.equal(literal.textSearch?.query, "'-00' & '-2709'");
  assert.equal(literal.textSearch?.options?.type, undefined);
  assert.equal(literal.textSearch?.options?.config, 'simple');
  assert.equal(literal.filters.length, 1);
  assert.equal(literal.filters[0][0], 'search_text');
  assert.equal(literal.filters[0][1], 'imatch');
  assert.match('7111-00-2709', new RegExp(literal.filters[0][2]));
  assert.doesNotMatch('7111 00 2709', new RegExp(literal.filters[0][2]));
});

test('no part-number hit at all keeps the existing token search', async () => {
  const { db, indexCalls } = fakeDb((call) =>
    call.textSearch?.query === '7111 00 2709' ? { data: [{ manual_id: 9 }], error: null } : { data: [], error: null },
  );
  const found = await search(db, '7111-00-2709');
  assert.deepEqual(found.ids, ['9']);
  assert.equal(indexCalls().length, 3);
});

test('plain word queries make one token FTS call, unchanged', async () => {
  const { db, indexCalls } = fakeDb(() => ({ data: [{ manual_id: 5 }], error: null }));
  const found = await search(db, 'GentleMAX PRO');
  assert.deepEqual(found.ids, ['5']);
  assert.equal(indexCalls().length, 1);
  assert.equal(indexCalls()[0].textSearch?.query, 'gentlemax pro');
});

test('part-number path still drops unpublished manuals and reads every chunk row', async () => {
  const { db } = fakeDb(
    () => ({ data: [{ manual_id: 1 }, { manual_id: 764 }, { manual_id: 1 }], error: null }),
    [
      { id: 1, published: true },
      { id: 764, published: false },
    ],
  );
  const found = await search(db, '7111-00-2709');
  assert.deepEqual(found.ids, ['1']);
});

test('missing index table on the part-number path reports body search unavailable', async () => {
  const { db } = fakeDb(() => ({ data: null, error: { message: 'relation "manual_search_index" does not exist' } }));
  const found = await search(db, '7111-00-2709');
  assert.equal(found.available, false);
  assert.deepEqual(found.ids, []);
});

test('the search route passes the raw sanitized query through', () => {
  const route = readFileSync(join(here, '../app/api/manuals/search/route.ts'), 'utf8');
  assert.match(route, /findManualIdsByBodyText\(getSupabaseAdmin\(\), tokens, q\)/);
  assert.equal(sanitizeManualSearchQuery('7111-00-2709'), '7111-00-2709');
});
