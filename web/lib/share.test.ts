import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateActionBaseUrl,
  estimateActionUrl,
  estimateEmailActionUrl,
} from './share.ts';

test('estimateActionUrl builds tokenized email CTA paths', () => {
  assert.match(estimateActionUrl('tok_1'), /\/e\/tok_1$/);
  assert.match(estimateActionUrl('tok_1', { action: 'approve' }), /\/e\/tok_1\?action=approve$/);
  assert.match(estimateActionUrl('tok_1', { action: 'reject' }), /\?action=reject$/);
  assert.match(estimateActionUrl('tok_1', { action: 'modify' }), /\?action=modify$/);
  assert.match(estimateActionUrl('tok_1', { changes: true }), /\?action=modify$/);
});

test('estimateEmailActionUrl strips prior query and stamps the CTA', () => {
  const base = estimateActionUrl('tok_1', { changes: true });
  assert.equal(estimateActionBaseUrl(base).endsWith('/e/tok_1'), true);
  assert.match(estimateEmailActionUrl(base, 'reject'), /\/e\/tok_1\?action=reject$/);
});
