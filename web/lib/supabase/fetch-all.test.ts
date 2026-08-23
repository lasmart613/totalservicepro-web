import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPABASE_PAGE_SIZE,
  chunkIds,
  fetchAllByIdChunks,
  fetchAllPages,
  uniqueIds,
} from './fetch-all.ts';

test('fetchAllPages walks until a short page and concatenates in order', async () => {
  const pages = [
    Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => i),
    Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => i + SUPABASE_PAGE_SIZE),
    Array.from({ length: 254 }, (_, i) => i + SUPABASE_PAGE_SIZE * 2),
  ];
  let calls = 0;
  const { data, error } = await fetchAllPages<number>(async (from, to) => {
    calls += 1;
    assert.equal(to - from + 1, SUPABASE_PAGE_SIZE);
    return { data: pages[calls - 1] || [], error: null };
  });
  assert.equal(error, null);
  assert.equal(calls, 3);
  assert.equal(data.length, 500 + 500 + 254);
  assert.equal(data[0], 0);
  assert.equal(data[1253], 1253);
});

test('fetchAllPages stops on the first empty page', async () => {
  let calls = 0;
  const { data, error } = await fetchAllPages(async () => {
    calls += 1;
    return { data: [], error: null };
  });
  assert.equal(error, null);
  assert.equal(calls, 1);
  assert.deepEqual(data, []);
});

test('fetchAllPages returns rows collected before an error', async () => {
  let calls = 0;
  const { data, error } = await fetchAllPages(async () => {
    calls += 1;
    if (calls === 1) {
      return { data: Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => i), error: null };
    }
    return { data: null, error: { message: 'boom' } };
  });
  assert.equal(error?.message, 'boom');
  assert.equal(data.length, SUPABASE_PAGE_SIZE);
});

test('1754-row org (Luxor-sized) needs four pages of 500, not a raised cap', async () => {
  const total = 1754;
  let calls = 0;
  const { data, error } = await fetchAllPages<{ id: number }>(async (from, to) => {
    calls += 1;
    const page = [];
    for (let i = from; i <= to && i < total; i++) page.push({ id: i });
    return { data: page, error: null };
  });
  assert.equal(error, null);
  assert.equal(calls, 4);
  assert.equal(data.length, 1754);
});

test('chunkIds and fetchAllByIdChunks cover every id', async () => {
  const ids = Array.from({ length: 1754 }, (_, i) => i + 1);
  assert.equal(chunkIds(ids, 200).length, 9);
  assert.equal(chunkIds(ids, 200)[8].length, 154);

  const seen: number[] = [];
  const { data, error } = await fetchAllByIdChunks(ids, async (chunk) => {
    seen.push(...chunk);
    return { data: chunk.map((id) => ({ id })), error: null };
  }, 200);
  assert.equal(error, null);
  assert.equal(seen.length, 1754);
  assert.equal(data.length, 1754);
});

test('uniqueIds drops nulls and duplicates while keeping first order', () => {
  assert.deepEqual(uniqueIds([4, 4, null, 7, 4, 9]), [4, 7, 9]);
});
