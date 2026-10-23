import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exactPartNumberImatch,
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
function fakeDb(
  answer: (call: Call) => Result,
  published: Array<{ id: number; published: boolean }> = [],
  pending: number[] = [],
) {
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
        eq(_column: string, id: unknown) {
          call.inIds = [id];
          return builder;
        },
        then(resolve: (value: Result) => unknown, reject?: (err: unknown) => unknown) {
          try {
            if (table === 'manual_search_index_pending') {
              const wanted = new Set((call.inIds || []).map((id) => String(id)));
              const rows = pending.filter((id) => wanted.has(String(id))).map((manual_id) => ({ manual_id }));
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            }
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

/** Raw-number FTS rows (loose) vs. the same query filtered to the number as written (exact). */
function looseThenExact(loose: number[], exact: number[] | { error: string }) {
  return (call: Call): Result => {
    if (call.textSearch?.options?.type !== 'plain') return { data: [{ manual_id: 7 }, { manual_id: 22 }], error: null };
    if (!call.filters.length) return { data: loose.map((manual_id) => ({ manual_id })), error: null };
    if (!Array.isArray(exact)) return { data: null, error: { message: exact.error } };
    return { data: exact.map((manual_id) => ({ manual_id })), error: null };
  };
}

/** Postgres [[:alnum:]] has no JS equivalent; imatch is case-insensitive. */
function asJs(pattern: string) {
  return new RegExp(pattern.replaceAll('[:alnum:]', 'A-Za-z0-9'), 'i');
}

test('8501-00-1800: an exact hit (row 1) drops the loose partials (rows 2, 8)', async () => {
  const { db, indexCalls } = fakeDb(looseThenExact([1, 2, 8, 1], [1, 1]));
  const found = await search(db, '8501-00-1800');
  assert.deepEqual(found.ids, ['1']);
  const exact = indexCalls()[1];
  assert.deepEqual(exact.textSearch, {
    column: 'search_tsv',
    query: '8501-00-1800',
    options: { type: 'plain', config: 'simple' },
  });
  assert.deepEqual(exact.filters, [['search_text', 'imatch', exactPartNumberImatch('8501-00-1800')]]);
  assert.equal(indexCalls().length, 2);
});

test('no exact hit keeps every loose row (rows 1, 2, 8)', async () => {
  const { db } = fakeDb(looseThenExact([1, 2, 8], []));
  const found = await search(db, '8501-00-1800');
  assert.deepEqual(found.ids, ['1', '2', '8']);
});

test('a single loose hit is returned without the exact query', async () => {
  const { db, indexCalls } = fakeDb(looseThenExact([1, 1], [1]));
  const found = await search(db, '7111-00-2709');
  assert.deepEqual(found.ids, ['1']);
  assert.equal(indexCalls().length, 1);
});

test('an exact-query error falls back to the loose rows', async () => {
  const { db } = fakeDb(looseThenExact([1, 2, 8], { error: 'canceling statement due to statement timeout' }));
  const found = await search(db, '8501-00-1800');
  assert.deepEqual(found.ids, ['1', '2', '8']);
});

test('exact hits still go through the published filter; all unpublished keeps the loose published rows', async () => {
  const published = [
    { id: 1, published: true },
    { id: 2, published: true },
    { id: 8, published: true },
    { id: 764, published: false },
  ];
  let found = await search(fakeDb(looseThenExact([1, 2, 764], [1, 764]), published).db, '8501-00-1800');
  assert.deepEqual(found.ids, ['1']);
  found = await search(fakeDb(looseThenExact([2, 8, 764], [764]), published).db, '8501-00-1800');
  assert.deepEqual(found.ids, ['2', '8']);
});

test('every part number in the query must appear as written', async () => {
  const { db, indexCalls } = fakeDb(looseThenExact([1, 2], [2]));
  const found = await search(db, 'DP35-0643-906 8501-00-1800');
  assert.deepEqual(found.ids, ['2']);
  assert.deepEqual(
    indexCalls()[1].filters.map((f) => f[2]),
    [exactPartNumberImatch('DP35-0643-906'), exactPartNumberImatch('8501-00-1800')],
  );
});

test('exactPartNumberImatch matches the number standing alone, not inside a longer one', () => {
  const re = asJs(exactPartNumberImatch('8501-00-1800'));
  for (const text of ['8501-00-1800', 'lamp 8501-00-1800 kit', 'P/N (8501-00-1800).', 'x\n8501-00-1800\n']) {
    assert.match(text, re, text);
  }
  for (const text of ['18501-00-1800', '8501-00-18001', '8501-00-1800A', '8501 00 1800', '8501-00 -1800']) {
    assert.doesNotMatch(text, re, text);
  }
  assert.match('dp35-0643-906 rev b', asJs(exactPartNumberImatch('DP35-0643-906')));
  assert.doesNotMatch('DP35-0643-9060', asJs(exactPartNumberImatch('DP35-0643-906')));
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

test('a manual with a chunked index write in progress is not a search hit', async () => {
  const { db } = fakeDb(() => ({ data: [{ manual_id: 4 }, { manual_id: 5 }], error: null }), [], [5]);
  const found = await search(db, 'reservoir pump');
  assert.deepEqual(found, { ids: ['4'], available: true });
});

test('an unreadable in-progress marker hides the hits (fail closed)', async () => {
  const { db } = fakeDb((call) =>
    call.table === 'manual_search_index_pending'
      ? { data: null, error: { message: 'permission denied for table manual_search_index_pending', code: '42501' } }
      : { data: [{ manual_id: 4 }], error: null },
  );
  const original = db.from.bind(db);
  (db as { from: (t: string) => unknown }).from = (t: string) => {
    const b = original(t);
    if (t === 'manual_search_index_pending') {
      b.then = (resolve: (v: Result) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'permission denied for table manual_search_index_pending', code: '42501' } }).then(resolve);
    }
    return b;
  };
  const found = await search(db, 'reservoir pump');
  assert.deepEqual(found, { ids: [], available: true });
});

test('a database without 000918 (no marker table) keeps the hits', async () => {
  const { db } = fakeDb(() => ({ data: [{ manual_id: 4 }], error: null }));
  const original = db.from.bind(db);
  (db as { from: (t: string) => unknown }).from = (t: string) => {
    const b = original(t);
    if (t === 'manual_search_index_pending') {
      b.then = (resolve: (v: Result) => unknown) =>
        Promise.resolve({
          data: null,
          error: { message: "Could not find the table 'public.manual_search_index_pending' in the schema cache", code: 'PGRST205' },
        }).then(resolve);
    }
    return b;
  };
  const found = await search(db, 'reservoir pump');
  assert.deepEqual(found, { ids: ['4'], available: true });
});

test('a statement timeout on the token FTS stops there: no unindexed imatch scan (Oct 22 GET 500s)', async () => {
  const { db, indexCalls } = fakeDb(() => ({
    data: null,
    error: { message: 'canceling statement due to statement timeout', code: '57014' },
  }));
  const found = await search(db, 'cyno');
  assert.equal(found.available, false);
  assert.match(String(found.error), /statement timeout/);
  assert.equal(indexCalls().length, 1);
  assert.equal(indexCalls()[0].filters.length, 0);
});

test('a statement timeout on the part-number FTS stops there too', async () => {
  const { db, indexCalls } = fakeDb(() => ({
    data: null,
    error: { message: 'canceling statement due to statement timeout' },
  }));
  const found = await search(db, '7111-00-2709');
  assert.equal(found.available, false);
  assert.equal(indexCalls().length, 1);
});

test('a non-timeout FTS error still uses the imatch fallback', async () => {
  const { db, indexCalls } = fakeDb((call) =>
    call.textSearch ? { data: null, error: { message: 'syntax error in tsquery' } } : { data: [{ manual_id: 4 }], error: null },
  );
  assert.deepEqual(await search(db, 'cyno'), { ids: ['4'], available: true });
  assert.equal(indexCalls().length, 2);
});

test('manual_search_index_ids (000939) is used when present; REST filter is not touched', async () => {
  const { db, indexCalls } = fakeDb(() => {
    throw new Error('REST filter must not run when the RPC answers');
  });
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  (db as any).rpc = async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push([fn, args]);
    if (args.p_patterns) return { data: [2], error: null };
    return { data: [1, 2, 2], error: null };
  };
  assert.deepEqual(await search(db, '7111-00-2709'), { ids: ['2'], available: true });
  assert.deepEqual(rpcCalls[0], ['manual_search_index_ids', { p_query: '7111-00-2709', p_plain: true, p_patterns: null }]);
  assert.equal(rpcCalls[1][1].p_patterns instanceof Array, true);
  assert.equal(indexCalls().length, 0);
  rpcCalls.length = 0;
  assert.deepEqual(await search(db, 'cyno pump'), { ids: ['1', '2'], available: true });
  assert.deepEqual(rpcCalls, [['manual_search_index_ids', { p_query: 'cyno pump', p_plain: true, p_patterns: null }]]);
});

test('before 000939 is applied (function missing) the REST filter runs as before', async () => {
  const { db, indexCalls } = fakeDb(() => ({ data: [{ manual_id: 9 }], error: null }));
  (db as any).rpc = async () => ({
    data: null,
    error: { message: 'Could not find the function public.manual_search_index_ids(p_patterns, p_plain, p_query) in the schema cache' },
  });
  assert.deepEqual(await search(db, 'cyno'), { ids: ['9'], available: true });
  assert.equal(indexCalls().length, 1);
});

test('an RPC statement timeout reports unavailable without a REST retry', async () => {
  const { db, indexCalls } = fakeDb(() => ({ data: [{ manual_id: 9 }], error: null }));
  (db as any).rpc = async () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } });
  const found = await search(db, 'cyno');
  assert.equal(found.available, false);
  assert.equal(indexCalls().length, 0);
});
