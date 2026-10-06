import assert from 'node:assert/strict';
import test from 'node:test';
import { displayModelName, displayModelText, lookupModelDisplayName } from './model-display.ts';

test('known model slugs use product names and unknown slugs title-case', () => {
  assert.equal(displayModelName('alex_trivantage'), 'Alexandrite TriVantage');
  assert.equal(displayModelName('soprano_titanium'), 'Soprano Titanium');
  assert.equal(displayModelName('gentlemax_pro'), 'GentleMax Pro');
  assert.equal(displayModelName('unknown_handpiece'), 'Unknown Handpiece');
  assert.equal(displayModelName('GentleMax Pro'), 'GentleMax Pro');
  assert.equal(displayModelName(''), '');
});

test('catalog labels win for seeded equipment names', () => {
  assert.equal(lookupModelDisplayName('Litho 60'), 'Litho 60 / Cyber Ho 60');
  assert.equal(displayModelName('Cyber Ho 60'), 'Litho 60 / Cyber Ho 60');
  assert.equal(displayModelName('OEC 9900'), 'OEC 9900');
});

test('display helper does not rewrite stored strings that are already names, except embedded known slugs', () => {
  const stored = 'alex_trivantage';
  assert.equal(stored, 'alex_trivantage');
  assert.equal(displayModelText('Candela alex_trivantage handpiece'), 'Candela Alexandrite TriVantage handpiece');
  assert.equal(displayModelText('Candela gentlemax_pro'), 'Candela GentleMax Pro');
  assert.equal(displayModelText('please_review the quote'), 'please_review the quote');
  assert.equal(displayModelText('QA-TEST-SN-01'), 'QA-TEST-SN-01');
});
