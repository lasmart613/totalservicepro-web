import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEstimateActionCtasHtml, ensureEstimateActionCtas } from './doc-html.ts';

const TOKEN_URL = 'https://repairplanet.net/e/abc-token-123';

test('estimate email CTAs are Approve / Reject / Modify on tokenized links', () => {
  const html = buildEstimateActionCtasHtml(TOKEN_URL);
  assert.match(html, /tsp-est-cta/);
  assert.match(html, /Respond to this estimate/);
  assert.match(html, />Approve</);
  assert.match(html, />Reject</);
  assert.match(html, />Modify</);
  assert.match(html, /\?action=approve/);
  assert.match(html, /\?action=reject/);
  assert.match(html, /\?action=modify/);
  assert.doesNotMatch(html, /Sign in with your clinic account/);
  assert.doesNotMatch(html, /Request Changes/);
});

test('ensureEstimateActionCtas puts three CTAs at the top and bottom', () => {
  const stub =
    `<div>Estimate body</div>` +
    `<table class="tsp-est-cta"><tr><td>Approve Estimate</td></tr></table>` +
    `Thank you for choosing Acme`;
  const html = ensureEstimateActionCtas(stub, TOKEN_URL);
  assert.match(html, />Approve</);
  assert.match(html, />Reject</);
  assert.match(html, />Modify</);
  assert.ok((html.match(/tsp-est-cta/g) || []).length >= 2);
  assert.match(html, /tsp-est-cta-top/);
  assert.match(html, /tsp-est-cta-bottom/);
  assert.match(html, /Thank you for choosing Acme/);
  assert.ok(html.indexOf('Respond to this estimate') < html.indexOf('Estimate body'));
});

test('ensureEstimateActionCtas injects CTAs when the client HTML has none', () => {
  const html = ensureEstimateActionCtas(
    '<div>Quote</div>Thank you for choosing Acme!',
    TOKEN_URL
  );
  assert.match(html, /tsp-est-cta-top/);
  assert.match(html, /\?action=approve/);
});
