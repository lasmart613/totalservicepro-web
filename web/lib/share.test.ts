import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateActionBaseUrl,
  estimateActionUrl,
  estimateEmailActionUrl,
  stampLangOnEstimateLinks,
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

test('customer /e/ links keep the shop language', () => {
  const url = estimateActionUrl('tok_1', { lang: 'ar' });
  assert.match(url, /\/e\/tok_1\?lang=ar$/);
  assert.match(estimateEmailActionUrl(url, 'approve'), /\/e\/tok_1\?action=approve&lang=ar$/);
  assert.match(estimateEmailActionUrl(url, 'reject'), /\/e\/tok_1\?action=reject&lang=ar$/);
  assert.match(estimateActionUrl('tok_1', { action: 'modify', lang: 'pt-BR' }), /\?action=modify&lang=pt$/);
  assert.match(estimateActionUrl('tok_1', { lang: 'zh' }), /\/e\/tok_1$/);
  const html = '<a href="https://repairplanet.net/e/tok_1?action=approve">Approve</a>';
  assert.match(stampLangOnEstimateLinks(html, 'de'), /\/e\/tok_1\?action=approve&lang=de/);
  assert.match(
    stampLangOnEstimateLinks('https://repairplanet.net/e/tok_1?action=approve&amp;lang=ar', 'de'),
    /lang=ar$/,
  );
  assert.equal(stampLangOnEstimateLinks('https://repairplanet.net/pay/invoice/9', 'ar'), 'https://repairplanet.net/pay/invoice/9');
});
