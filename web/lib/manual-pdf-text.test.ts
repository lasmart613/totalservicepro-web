import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clipManualSearchText,
  extractPdfSearchText,
  looksLikePdf,
  normalizeManualSearchText,
} from './manual-pdf-text.ts';
import { MANUAL_FIXTURE_PATH } from './manuals.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('fixture PDF text is extractable for library body search', () => {
  const fixtureRel = join(here, '..', 'public', MANUAL_FIXTURE_PATH.replace(/^\//, ''));
  const bytes = readFileSync(fixtureRel);
  assert.equal(looksLikePdf(bytes), true);
  const text = extractPdfSearchText(bytes);
  assert.match(text, /reservoir/i);
  assert.match(text, /collimator/i);
  assert.match(normalizeManualSearchText(text), /page 1 of 3/);
});

test('clip and normalize keep substring search usable', () => {
  assert.equal(normalizeManualSearchText('V-Beam / GentleMax'), 'v beam gentlemax');
  assert.ok(clipManualSearchText('a'.repeat(12), 8).length <= 8);
});
