import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import {
  OCR_XOBJECT_TEXT,
  TOUNICODE_PLAIN,
  buildOcrXObjectPdf,
  buildOperatorPdf,
  buildTextPdf,
  buildToUnicodePdf,
  caesarShift,
} from './manual-pdf-fixtures.ts';
import { indexedExcerptPage } from './ai/manual-scope.ts';
import { MANUAL_FIXTURE_PATH } from './manuals.ts';

const CO2RE_SHA256 = '74db371f64e5a29cbe73b45737ce87211580393b850876e371b29d0f83d262c6';
const CO2RE_BYTES = 7_728_071;

function miniPdf(stream: string): Buffer {
  return buildOperatorPdf(stream);
}

function comparablePdfText(value: string): string {
  return value
    .replace(/\[\[pdfpage:\d+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdftotext(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'manual-pdf-'));
  const file = join(dir, 'in.pdf');
  try {
    writeFileSync(file, bytes);
    return execFileSync('pdftotext', ['-enc', 'UTF-8', '-q', file, '-'], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function hasPdftotext(): boolean {
  const probe = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  return probe.status === 0;
}

const here = dirname(fileURLToPath(import.meta.url));

test('fixture PDF text is extractable for library body search', async () => {
  const fixtureRel = join(here, '..', 'public', MANUAL_FIXTURE_PATH.replace(/^\//, ''));
  const bytes = readFileSync(fixtureRel);
  assert.equal(looksLikePdf(bytes), true);
  const text = await extractPdfSearchText(bytes);
  assert.match(text, /reservoir/i);
  assert.match(text, /collimator/i);
  assert.match(normalizeManualSearchText(text), /page 1 of 3/);
  assert.match(text, /\[\[pdfpage:3\]\]/);
  assert.ok(text.includes('\f'));
});

test('TJ glyphs stay one word unless the kerning gap is large', async () => {
  const glued = await extractPdfSearchText(miniPdf('BT [(C)-7.6 (o)-2 (p)-5.8 (y)]TJ ET'));
  assert.match(glued, /Copy/);
  assert.doesNotMatch(glued, /C o p y/);
  const spaced = await extractPdfSearchText(miniPdf('BT [(CW)-250 (Laser) ( Power Too High)]TJ ET'));
  assert.match(spaced, /CW Laser Power Too High/);
  const ordered = await extractPdfSearchText(miniPdf('BT [(AAA)] TJ (BBB) Tj ET'));
  assert.match(ordered, /AAABBB/);
  assert.doesNotMatch(ordered, /BBB AAA/);
  const lines = await extractPdfSearchText(miniPdf('BT (Hello) Tj 0 -14 Td (World) Tj (Next)\' <4869> Tj ET'));
  assert.match(lines, /Hello/);
  assert.match(lines, /World/);
  assert.match(lines, /Next/);
  assert.match(lines, /Hi/);
  assert.ok(singleLetterTokenRatio('P o w e r Too H i gh') > 0.5);
  assert.ok(singleLetterTokenRatio('Power Too High troubleshooting thermopile') < 0.1);
});

test('full CO2RE PDF keeps words and stamps error 43 on page 150', async (t) => {
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
  const pages = await extractPdfPages(bytes);
  assert.equal(pages.length, 161);
  const text = await extractPdfSearchText(bytes);
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

test('ocrmypdf-style XObject text matches pdftotext and keeps the physical page stamp', async (t) => {
  const bytes = buildOcrXObjectPdf();
  const text = await extractPdfSearchText(bytes);
  assert.match(text, new RegExp(OCR_XOBJECT_TEXT));
  assert.match(text, /\[\[pdfpage:1\]\]/);
  assert.equal((text.match(/\[\[pdfpage:\d+\]\]/g) || []).length, 1);
  if (!hasPdftotext()) {
    t.skip('pdftotext is not installed');
    return;
  }
  assert.equal(comparablePdfText(text), comparablePdfText(pdftotext(bytes)));
});

test('custom ToUnicode CMap is applied instead of the raw Caesar-shifted codes', async (t) => {
  const bytes = buildToUnicodePdf();
  const shifted = caesarShift(TOUNICODE_PLAIN, 3);
  assert.notEqual(shifted, TOUNICODE_PLAIN);
  const text = await extractPdfSearchText(bytes);
  assert.match(text, new RegExp(TOUNICODE_PLAIN));
  assert.doesNotMatch(text, new RegExp(shifted));
  assert.match(text, /\[\[pdfpage:1\]\]/);
  if (!hasPdftotext()) {
    t.skip('pdftotext is not installed');
    return;
  }
  assert.equal(comparablePdfText(text), comparablePdfText(pdftotext(bytes)));
});

test('multi-page text PDF stamps every physical page', async () => {
  const bytes = buildTextPdf(['intro reservoir', 'error forty three', 'optical collimator']);
  const text = await extractPdfSearchText(bytes);
  assert.match(text, /\[\[pdfpage:1\]\] intro reservoir/);
  assert.match(text, /\[\[pdfpage:2\]\] error forty three/);
  assert.match(text, /\[\[pdfpage:3\]\] optical collimator/);
  assert.equal(text.split('\f').length, 3);
});

test('clip and normalize keep substring search usable', () => {
  assert.equal(normalizeManualSearchText('V-Beam / GentleMax'), 'v beam gentlemax');
  assert.ok(clipManualSearchText('a'.repeat(12), 8).length <= 8);
});
