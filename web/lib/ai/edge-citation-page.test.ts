import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractPdfSearchText } from '../manual-pdf-text.ts';

/**
 * Runs the REAL grok-assistant citation path (index.ts, not a copy) under
 * Node: URL imports and serve() are stubbed in a temp copy, everything else
 * is byte-identical. QA #148: chips cited printed "7-8" (page=7) instead of
 * physical PDF page 150 for CO2RE error #43.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FN_DIR = join(here, '../../../supabase/functions/grok-assistant');
const CO2RE_SHA256 = '74db371f64e5a29cbe73b45737ce87211580393b850876e371b29d0f83d262c6';
const CO2RE_BYTES = 7_728_071;

type Cite = { manualId: number; title?: string; page?: number; section?: string; pageOutOfRange?: boolean };
type Part = {
  text: string;
  source: string;
  page?: number;
  section?: string;
  fileId?: string;
  fileName?: string;
  fromSelectedIndex?: boolean;
};
type Edge = {
  buildSearchQuery: (q: string, label: string, codes: string[]) => string;
  searchIndexedManualText: (db: unknown, id: number, q: string, label: string) => Promise<Part | null>;
  mergeIndexedParts: (indexed: Part | null, parts: Part[]) => { parts: Part[]; citeParts: Part[] };
  citationsFromParts: (parts: Part[], id: number, title: string, scope?: unknown) => Cite[];
  attachProsePages: (cites: Cite[], text: string) => Cite[];
  formatCitationLine: (cites: Cite[], fallback?: string) => string;
};

let edgePromise: Promise<Edge> | null = null;
function loadEdge(): Promise<Edge> {
  if (edgePromise) return edgePromise;
  const dir = mkdtempSync(join(tmpdir(), 'grok-edge-'));
  for (const f of ['manual-scope.ts', 'xai-collection.ts', 'fault-codes.ts', 'citation-scope.ts']) {
    copyFileSync(join(FN_DIR, f), join(dir, f));
  }
  let src = readFileSync(join(FN_DIR, 'index.ts'), 'utf8');
  src = src
    .replace(/^import \{ serve \} from 'https:[^']+'\s*$/m, 'const serve = (_h: unknown) => {}')
    .replace(/^import \{ createClient \} from 'https:[^']+'\s*$/m, 'const createClient = (..._a: unknown[]) => ({})');
  assert.doesNotMatch(src, /from 'https?:/, 'index.ts gained a new URL import; stub it here');
  src =
    "(globalThis as any).Deno ??= { env: { get: () => undefined } }\n" +
    src +
    '\nexport { buildSearchQuery, searchIndexedManualText }\n';
  const file = join(dir, 'index.ts');
  writeFileSync(file, src);
  edgePromise = import(pathToFileURL(file).href) as Promise<Edge>;
  return edgePromise;
}

function fakeDb(searchText: string) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { search_text: searchText }, error: null }) }),
      }),
    }),
  };
}

const QUESTIONS = [
  'CO2RE error 43 CW Laser Power Too High what does it mean',
  'On the CO2RE, what does error #43 CW Laser Power Too High mean and what are the troubleshooting steps?',
];
// What grok returned live (QA 08:13 PT): printed label in prose.
const LIVE_REPLY =
  'Error #43: CW Laser Power Too High ... These steps are listed in the troubleshooting table on page 7-8 (PB73826EN). See page 7.';

async function assertPhysical150(edge: Edge, searchText: string) {
  for (const q of QUESTIONS) {
    const sq = edge.buildSearchQuery(q, 'Candela CO2RE', ['43']);
    const indexed = await edge.searchIndexedManualText(fakeDb(searchText), 17, sq, 'Candela CO2RE');
    assert.ok(indexed, q);
    assert.equal(indexed!.page, 150, `${q} -> indexed page ${indexed!.page}`);
    assert.match(indexed!.text, /43 CW Laser Power Too High/);
    // Collection chunks (the PB73826EN doc in the Grok collection) carry no physical page.
    const collection: Part[] = [
      { text: 'Troubleshooting Service Manual PB73826EN 7 - 8 43 CW Laser Power Too High', source: 'PB73826EN CO2RE Service Manual_ECO-4784.pdf' },
      { text: 'Calibrate - Section 5.6', source: 'PB73826EN CO2RE Service Manual_ECO-4784.pdf', section: '5.6' },
    ];
    const merged = edge.mergeIndexedParts(indexed, collection);
    assert.equal(merged.parts[0], indexed, 'stamped index excerpt leads the context');
    assert.equal(merged.parts.length, 3, 'collection chunks still feed context');
    const cites = edge.attachProsePages(edge.citationsFromParts(merged.citeParts, 17, 'Candela CO2RE'), LIVE_REPLY);
    assert.ok(cites.length >= 1);
    for (const c of cites) assert.equal(c.page, 150, JSON.stringify(cites));
    const line = edge.formatCitationLine(cites, 'Candela CO2RE');
    assert.match(line, /\[\[cite:id=17&p=150/);
    assert.doesNotMatch(line, /p=7(?!\d)/);
    assert.doesNotMatch(line, /p\.7(?!\d)/);
  }
}

test('edge cites never take a page from printed labels in passages or prose', async () => {
  const edge = await loadEdge();
  const cites = edge.citationsFromParts(
    [{ text: 'Troubleshooting table, see page 7 and pages 7-8', source: 'collection chunk' }],
    17,
    'Candela CO2RE'
  );
  assert.equal(cites[0].page, undefined);
  const prose = edge.attachProsePages([{ manualId: 17, title: 'Candela CO2RE' }], 'See page 7-8 and page 7.');
  assert.deepEqual(prose, [{ manualId: 17, title: 'Candela CO2RE' }]);
  // No index row: collection parts keep their own (xAI page_number) cites.
  const plain = edge.mergeIndexedParts(null, [{ text: 'x', source: 'a', page: 42 }]);
  assert.equal(edge.citationsFromParts(plain.citeParts, 5, 'Xeo')[0].page, 42);
});

test('stamped CO2RE-shaped index row cites physical page 150 (fixture)', async () => {
  const edge = await loadEdge();
  const pages: string[] = [];
  for (let n = 1; n <= 161; n++) {
    let body = `Service Manual PB73826EN page body ${n} laser module alignment power measurement`;
    if (n === 7) body = 'Table of Contents list of figures Troubleshooting 7-3 Laser Power 5-19';
    if (n === 149) body = 'Troubleshooting Service Manual PB73826EN 7 - 7 # Message 36 Error Loading Factory Data';
    if (n === 150)
      body =
        'Service Manual Troubleshooting PB73826EN 7 - 8 # Message End User Suggestion Possible Cause Action ' +
        '42 CW Laser Power Too Low Reset power to clear error. Black box. Check thermopile connection on I/O. ' +
        '43 CW Laser Power Too High Reset power to clear error. Black box. Check thermopile connection on I/O. ' +
        'If error persists, contact the service department. Laser module. Replace black box. Replace laser module.';
    if (n === 151)
      body = 'Troubleshooting Service Manual PB73826EN 7 - 9 45 Pulsed Laser Power Too High 48 Calibrate Section 5.6';
    pages.push(`[[pdfpage:${n}]] ${body}`);
  }
  await assertPhysical150(edge, pages.join('\f'));
});

test('real CO2RE extract: error 43 cites physical page 150, never printed 7', async (t) => {
  const path = [process.env.CO2RE_MANUAL_PDF, join(here, '../../fixtures/private/CO2RE.pdf')].find(
    (candidate) => candidate && existsSync(candidate)
  );
  if (!path) {
    t.skip('full CO2RE PDF is not in this environment');
    return;
  }
  const bytes = readFileSync(path);
  assert.equal(bytes.length, CO2RE_BYTES);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), CO2RE_SHA256);
  const text = await extractPdfSearchText(bytes);
  assert.equal((text.match(/\[\[pdfpage:\d+\]\]/g) || []).length, 161);
  await assertPhysical150(await loadEdge(), text);
});

test('edge cites a PRO PLUS passage as manual 5, not the open Pro manual', async () => {
  const edge = await loadEdge();
  const pages: string[] = [];
  for (let n = 1; n <= 178; n++) {
    let body = `GentleMAX PRO PLUS service body ${n}`;
    if (n === 121) body = 'ALEX circuit calibration set TX% 85% before simmer. Calibration Successful.';
    pages.push(`[[pdfpage:${n}]] ${body}`);
  }
  const cites = edge.citationsFromParts(
    [
      {
        text: 'ALEX circuit calibration set TX% 85% before simmer. Calibration Successful.',
        source: 'GentleMAX PRO PLUS Service Manual 8501-00-2410_A_01.pdf',
        fileId: 'file_pro_plus',
        fileName: 'GentleMAX PRO PLUS Service Manual 8501-00-2410_A_01.pdf',
        page: 120,
      },
      {
        text: 'Model GentleMAX PRO P/N 8501-00-9035 Rev 01 front matter for this service manual.',
        source: 'GentleMAX Pro Service Manual.pdf p.12',
        fileId: 'file_pro',
        fileName: 'GentleMAX Pro Service Manual.pdf',
        page: 12,
      },
    ],
    110,
    'Candela GentleMAX Pro Service Manual',
    {
      fileIds: new Set(['file_pro']),
      expectedFilenames: ['GentleMAX Pro Service Manual.pdf'],
      pageCount: 15,
      catalog: [
        {
          id: 5,
          title: 'GentleMAX PRO PLUS Service Manual',
          brand: 'Candela',
          storage_path: 'shared/candela/GentleMAX PRO PLUS Service Manual 8501-00-2410_A_01.pdf',
          xai_file_id: 'file_pro_plus',
          page_count: 178,
        },
      ],
      indexTextByManualId: { 5: pages.join('\f') },
    }
  );
  const plus = cites.find((c) => c.manualId === 5);
  assert.ok(plus, JSON.stringify(cites));
  assert.equal(plus!.page, 121);
  assert.match(plus!.title || '', /GentleMAX PRO PLUS Service Manual/);
  assert.equal(plus!.pageOutOfRange, undefined);
  const pro = cites.find((c) => c.manualId === 110);
  assert.ok(pro, JSON.stringify(cites));
  assert.equal(pro!.page, 12);
  assert.equal(pro!.pageOutOfRange, undefined);
  assert.equal(
    cites.some((c) => c.manualId === 110 && c.page === 120),
    false
  );
});

test('edge citation label spaces the page and drops a repeated manual page', async () => {
  const edge = await loadEdge();
  const line = edge.formatCitationLine([{ manualId: 9, title: 'Rev A', page: 166 }], '');
  assert.match(line, /Rev A, p\. 166/);
  assert.doesNotMatch(line, /Rev A,p\.166|p\.166/);

  const cites = edge.citationsFromParts(
    [
      { text: 'first', source: 'chunk-a', page: 166, section: '1.1' },
      { text: 'again', source: 'chunk-b', page: 166, section: '9.9' },
      { text: 'other', source: 'chunk-c', page: 10 },
    ],
    9,
    'Rev A'
  );
  assert.deepEqual(
    cites.map((c) => c.page),
    [166, 10]
  );
  assert.equal(cites[0].section, '1.1');
});

/** Synthetic GentleMAX leaves: footer "Page 83", threshold on 88–89, weak TX on 95. */
function gentleMaxTransmissionIndex(): string {
  const pages: string[] = [];
  for (let n = 1; n <= 100; n++) {
    let text = `GentleMAX PRO PLUS Service Manual Candela Corporation Page ${n} of 178.`;
    if (n === 49) {
      text += ' 9 System Settings by Wavelength. System settings vary. Minimum Fluence (J/cm2) Maximum Fluence (J/cm2).';
    }
    if (n === 53) text += ' The actual values vary depending on the fluence setting and laser head efficiency.';
    if (n === 86) text += ' See also • Chapter 16, DHP Laser Rail Alignment. • Chapter 18, Calibration.';
    if (n === 87) text += ' 18 Calibration (Cal) Port Verification Procedure. Record fluence. Follow the steps.';
    if (n === 88) {
      text +=
        ' Pulse into the cal port and record the average of the three transmissions. If TX% = <83%, clean the window and repeat until transmission is >83%.';
    }
    if (n === 89) {
      text +=
        ' Record the average of the three transmissions. If TX = <83%, clean or replace the fiber and repeat until transmission is >83%. Perform the steps in the Troubleshooting Guide (Chapter 17).';
    }
    if (n === 92) {
      text +=
        ' 19.1 Alex Performance Test Tables. Average Transmission (C) = (A / B) x 100 = %. Cal port Transmission (D) = %.';
    }
    if (n === 95) {
      text +=
        ' 19.2 Nd:YAG Performance Test Tables. Average Transmission (C) = (A / B) x 100 = %. Cal port Transmission. See also • Chapter 16, DHP Laser Rail Alignment. • Chapter 18, Calibration. TX 83 at the cal port.';
    }
    pages.push(`[[pdfpage:${n}]] ${text}`);
  }
  return pages.join('\f');
}

test('GentleMAX transmission below 83% cites pages 88-89 and Chapter 17, not the cal-port table', async () => {
  const edge = await loadEdge();
  const indexedText = gentleMaxTransmissionIndex();
  const bodies = new Map<number, string>();
  for (const part of indexedText.split('\f')) {
    const stamp = /\[\[pdfpage:(\d+)\]\]/.exec(part);
    if (stamp) bodies.set(Number(stamp[1]), part);
  }
  for (const question of [
    'TX not >83%',
    'transmission below 83%',
    'transmission under 83%',
    'transmission less than 83%',
    'transmission threshold',
  ]) {
    const query = edge.buildSearchQuery(question, 'Candela GentleMAX PRO PLUS', []);
    const indexed = await edge.searchIndexedManualText(
      fakeDb(indexedText),
      5,
      query,
      'Candela GentleMAX PRO PLUS'
    );
    assert.ok(indexed, question);
    assert.ok(indexed.page === 88 || indexed.page === 89, `${question} -> ${indexed.page}`);
    const body = bodies.get(indexed.page!) || '';
    if (/chapter\s*17/i.test(body)) assert.match(indexed.section || '', /17/, `${question} section ${indexed.section}`);
  }
  const fluenceQuery = edge.buildSearchQuery(
    'What is the maximum fluence setting for the GentleMAX Pro Plus?',
    'Candela GentleMAX PRO PLUS',
    []
  );
  const fluence = await edge.searchIndexedManualText(
    fakeDb(indexedText),
    5,
    fluenceQuery,
    'Candela GentleMAX PRO PLUS'
  );
  assert.equal(fluence?.page, 49);
  assert.notEqual(fluence?.section, 'Ch.16');
  const alexQuery = edge.buildSearchQuery('Alex performance test transmission', 'Candela GentleMAX PRO PLUS', []);
  const alex = await edge.searchIndexedManualText(fakeDb(indexedText), 5, alexQuery, 'Candela GentleMAX PRO PLUS');
  assert.equal(alex?.page, 92);
});

test('GentleMAX fluence search uses the PDF page of the settings table, not the next chapter', async () => {
  const edge = await loadEdge();
  const pages: string[] = [];
  for (let n = 1; n <= 100; n++) {
    let text = 'GentleMAX PRO PLUS service manual header.';
    if (n === 49) text += ' 9 System Settings by Wavelength. System settings vary. Minimum Fluence (J/cm2) Maximum Fluence (J/cm2).';
    if (n === 53) text += ' The actual values vary depending on the fluence setting and laser head efficiency.';
    if (n === 86) text += ' See also • Chapter 16, DHP Laser Rail Alignment. • Chapter 18, Calibration.';
    if (n === 87) {
      text += ' 18 Calibration (Cal) Port Verification Procedure. Record fluence. Follow the steps.';
    }
    pages.push(`[[pdfpage:${n}]] ${text}`);
  }
  const query = edge.buildSearchQuery(
    'What is the maximum fluence setting for the GentleMAX Pro Plus?',
    'Candela GentleMAX PRO PLUS',
    []
  );
  const indexed = await edge.searchIndexedManualText(
    fakeDb(pages.join('\f')),
    5,
    query,
    'Candela GentleMAX PRO PLUS'
  );
  assert.ok(indexed, 'indexed hit');
  assert.equal(indexed!.page, 49);
  assert.notEqual(indexed!.section, 'Ch.16');
  assert.doesNotMatch(indexed!.section || '', /16/);
});
