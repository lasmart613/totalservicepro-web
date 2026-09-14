import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateRowBelongsToViewer,
  mergeEstimateLiveRow,
} from './estimate-list-live.ts';

test('mergeEstimateLiveRow patches an existing id and prepends unknown rows', () => {
  const rows = [
    { id: 1, customer_action: null, customer_name: 'A' },
    { id: 2, customer_action: null, customer_name: 'B' },
  ];
  const patched = mergeEstimateLiveRow(rows, {
    id: 2,
    customer_action: 'approved',
    customer_name: 'B',
  });
  assert.equal(patched[1].customer_action, 'approved');
  const added = mergeEstimateLiveRow(rows, {
    id: 9,
    customer_action: 'rejected',
    customer_name: 'C',
  });
  assert.equal(added[0].id, 9);
  assert.equal(added.length, 3);
});

test('estimateRowBelongsToViewer matches shop org or author', () => {
  assert.equal(
    estimateRowBelongsToViewer({ organization_id: 113, created_by: 'u1' }, { orgId: '113' }),
    true
  );
  assert.equal(
    estimateRowBelongsToViewer({ organization_id: 9, created_by: 'u1' }, { userId: 'u1' }),
    true
  );
  assert.equal(
    estimateRowBelongsToViewer({ organization_id: 9, created_by: 'u2' }, { orgId: 113, userId: 'u1' }),
    false
  );
});
