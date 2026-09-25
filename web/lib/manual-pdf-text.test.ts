import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clipManualSearchText,
  extractPdfPages,
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
  assert.match(text, /\[\[pdfpage:3\]\]/);
  assert.ok(text.includes('\f'));
});

test('CO2RE object streams keep 161 physical pages', () => {
  const path = [
    process.env.CO2RE_MANUAL_PDF,
    '/home/ubuntu/.cursor/projects/workspace/uploads/CO2RE_b25c.pdf',
    join(here, '../fixtures/private/CO2RE.pdf'),
  ].find((candidate) => candidate && existsSync(candidate));
  if (!path) return;
  const bytes = readFileSync(path);
  const pages = extractPdfPages(bytes);
  assert.equal(pages.length, 161);
  assert.equal(pages[0]?.page, 1);
  assert.equal(pages[150]?.page, 151);
  const text = extractPdfSearchText(bytes);
  assert.equal((text.match(/\[\[pdfpage:\d+\]\]/g) || []).length, 161);
  assert.ok(text.includes('\f'));
  assert.doesNotMatch(text.slice(0, 20), /^[^[]/);
  const hit = pages.find((page) => /cw laser/i.test(page.text) && /power too high/i.test(page.text));
  if (hit) {
    assert.equal(hit.page, 151);
  } else {
    assert.equal(pages[150]?.page, 151);
    assert.equal(/power too high/i.test(text), false);
  }
});

test('clip and normalize keep substring search usable', () => {
  assert.equal(normalizeManualSearchText('V-Beam / GentleMax'), 'v beam gentlemax');
  assert.ok(clipManualSearchText('a'.repeat(12), 8).length <= 8);
});
