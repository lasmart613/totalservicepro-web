import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyAiState,
  messagesForManual,
  storageKeyFor,
  upsertManualThread,
} from './chat-history.ts';

test('web AI history stays scoped per user + org', () => {
  assert.equal(storageKeyFor('u1', 9), 'tsp_ai_web_v1:u:u1:o:9');
  assert.equal(storageKeyFor('u1', null), 'tsp_ai_web_v1:u:u1:o:none');
});

test('viewer and assistant share the same per-manual thread', () => {
  const base = emptyAiState();
  const next = upsertManualThread(base, {
    manualId: 105,
    manualPath: 'shared/cutera/xeo',
    brand: 'Cutera',
    msgs: [
      { role: 'user', content: 'What is fault 322?' },
      { role: 'assistant', content: 'Flow switch', citations: [{ manualId: 105, page: 42 }] },
    ],
    touchMain: true,
  });
  assert.equal(next.manualId, 105);
  assert.equal(next.msgs.length, 2);
  assert.equal(messagesForManual(next, 105).length, 2);
  assert.equal(messagesForManual(next, 16).length, 0);
  assert.equal(messagesForManual(next, 105)[1].citations?.[0].page, 42);

  const other = upsertManualThread(next, {
    manualId: 16,
    msgs: [{ role: 'user', content: 'Elite PM?' }],
    touchMain: false,
  });
  assert.equal(other.manualId, 105);
  assert.equal(messagesForManual(other, 16).length, 1);
  assert.equal(messagesForManual(other, 105).length, 2);
});
