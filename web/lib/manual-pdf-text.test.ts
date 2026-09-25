import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  singleLetterTokenRatio,
} from './manual-pdf-text.ts';
import { indexedExcerptPage } from './ai/manual-scope.ts';
import { MANUAL_FIXTURE_PATH } from './manuals.ts';

const CO2RE_SHA256 = '74db371f64e5a29cbe73b45737ce87211580393b850876e371b29d0f83d262c6';
const CO2RE_BYTES = 7_728_071;

function miniPdf(stream: string): Buffer {
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n',
    `4 0 obj << /Length ${Buffer.byteLength(stream, 'latin1')} >> stream\n${stream}\nendstream endobj\n`,
  ];
  return Buffer.from(`%PDF-1.4\n${objects.join('')}`, 'latin1');
}

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

test('TJ glyphs stay one word unless the kerning gap is large', () => {
  const glued = extractPdfSearchText(miniPdf('BT [(C)-7.6 (o)-2 (p)-5.8 (y)]TJ ET'));
  assert.match(glued, /Copy/);
  assert.doesNotMatch(glued, /C o p y/);
  const spaced = extractPdfSearchText(miniPdf('BT [(CW)-250 (Laser) ( Power Too High)]TJ ET'));
  assert.match(spaced, /CW Laser Power Too High/);
  const ordered = extractPdfSearchText(miniPdf('BT [(AAA)] TJ (BBB) Tj ET'));
  assert.match(ordered, /AAABBB/);
  assert.doesNotMatch(ordered, /BBB AAA/);
  const lines = extractPdfSearchText(miniPdf('BT (Hello) Tj 0 -14 Td (World) Tj (Next)\' <4869> Tj ET'));
  assert.match(lines, /Hello/);
  assert.match(lines, /World/);
  assert.match(lines, /Next/);
  assert.match(lines, /Hi/);
  assert.ok(singleLetterTokenRatio('P o w e r Too H i gh') > 0.5);
  assert.ok(singleLetterTokenRatio('Power Too High troubleshooting thermopile') < 0.1);
});

test('full CO2RE PDF keeps words and stamps error 43 on page 150', (t) => {
  const path = [process.env.CO2RE_MANUAL_PDF, join(here, '../fixtures/private/CO2RE.pdf')].find(
    (candidate) => candidate && existsSync(candidate)
  );
  if (!path) {
    t.skip('full CO2RE PDF is not in this environment');
    return;
  }
  const bytes = readFileSync(path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    bytes.length,
    CO2RE_BYTES,
    `${path} is ${bytes.length} bytes, not the full ${CO2RE_BYTES}-byte manual`
  );
  assert.equal(hash, CO2RE_SHA256, `${path} sha256 ${hash} does not match the full manual`);
  const pages = extractPdfPages(bytes);
  assert.equal(pages.length, 161);
  const text = extractPdfSearchText(bytes);
  assert.equal((text.match(/\[\[pdfpage:\d+\]\]/g) || []).length, 161);
  const page150 = text.split('\f').find((part) => part.includes('[[pdfpage:150]]')) || '';
  assert.match(page150, /CW Laser Power Too High/);
  assert.ok(singleLetterTokenRatio(text) < 0.1, `single-letter ratio ${singleLetterTokenRatio(text)}`);
  const trouble = text.toLowerCase().match(/\btroubleshooting\b/g) || [];
  assert.ok(trouble.length >= 10, `troubleshooting count ${trouble.length}`);
  for (const question of [
    'On the CO2RE, what does error #43 CW Laser Power Too High mean',
    'error 43 CW laser power too high',
    'CO2RE error 43',
  ]) {
    const page = indexedExcerptPage(text, question);
    assert.ok(page === 150 || page === 151, `${question} -> ${page}`);
  }
});

test('clip and normalize keep substring search usable', () => {
  assert.equal(normalizeManualSearchText('V-Beam / GentleMax'), 'v beam gentlemax');
  assert.ok(clipManualSearchText('a'.repeat(12), 8).length <= 8);
});
