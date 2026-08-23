import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkIds, fetchAllPages, uniqueLinkedIds } from './paginate.ts';

test('fetchAllPages walks every range until a short page, with no max cap', async () => {
  const pages = [
    Array.from({ length: 200 }, (_, i) => i),
    Array.from({ length: 200 }, (_, i) => i + 200),
    Array.from({ length: 100 }, (_, i) => i + 400),
  ];
  const ranges: Array<[number, number]> = [];

  const { data, error } = await fetchAllPages<number>(async (from, to) => {
    ranges.push([from, to]);
    const idx = from / 200;
    return { data: pages[idx] || [], error: null };
  }, 200);

  assert.equal(error, null);
  assert.equal(data.length, 500);
  assert.deepEqual(ranges, [
    [0, 199],
    [200, 399],
    [400, 599],
  ]);
  assert.equal(data[0], 0);
  assert.equal(data[499], 499);
});

test('fetchAllPages continues past 500 when more rows exist', async () => {
  const { data, error } = await fetchAllPages<number>(async (from, to) => {
    const rows: number[] = [];
    for (let i = from; i <= to && i < 1754; i++) rows.push(i);
    return { data: rows, error: null };
  }, 200);

  assert.equal(error, null);
  assert.equal(data.length, 1754);
  assert.equal(data[1753], 1753);
});

test('fetchAllPages stops on first page when it is short', async () => {
  let calls = 0;
  const { data, error } = await fetchAllPages<number>(async () => {
    calls += 1;
    return { data: [1, 2, 3], error: null };
  }, 200);

  assert.equal(error, null);
  assert.equal(calls, 1);
  assert.deepEqual(data, [1, 2, 3]);
});

test('fetchAllPages returns rows collected before an error', async () => {
  const { data, error } = await fetchAllPages<number>(async (from) => {
    if (from > 0) return { data: null, error: { message: 'boom' } };
    return { data: Array.from({ length: 200 }, (_, i) => i), error: null };
  }, 200);

  assert.equal(error?.message, 'boom');
  assert.equal(data.length, 200);
});

test('chunkIds splits ids without dropping leftovers', () => {
  const ids = Array.from({ length: 450 }, (_, i) => i);
  const chunks = chunkIds(ids, 200);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 200);
  assert.equal(chunks[1].length, 200);
  assert.equal(chunks[2].length, 50);
  assert.equal(chunks.flat().length, 450);
});

test('uniqueLinkedIds de-dupes and drops nulls', () => {
  assert.deepEqual(
    uniqueLinkedIds([
      { customer_organization_id: 1 },
      { customer_organization_id: 1 },
      { customer_organization_id: null },
      { customer_organization_id: 2 },
      null,
    ]),
    [1, 2]
  );
});
