import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignReplyToCitationPage,
  answerDeclinesManualCitation,
  footerPagesForIndex,
  printedPageLabel,
  rememberManualIndex,
  attributeCitations,
  boundCitationPage,
  catalogCitationTitle,
  effectivePageCount,
  findCatalogRow,
  indexPageBody,
  modelQualifierIds,
  modelSuffixConflict,
  quotedPagesInAnswer,
  reconcilePhysicalPage,
  resolveQuotedCitationPage,
  type CatalogCiteRow,
} from '../../../supabase/functions/grok-assistant/citation-scope.ts';
import {
  chapterFileKeys,
  collectionHitsFromResponse,
  docMatchesManual,
  filterHitsForManual,
  pickFileIdsForManual,
} from '../../../supabase/functions/grok-assistant/collection-search.ts';

const PRO_TITLE = 'Candela GentleMAX Pro Service Manual';
const PLUS_TITLE = 'Candela GentleMAX PRO PLUS Service Manual';
const PRO_FILE = 'GentleMAX Pro Service Manual.pdf';
const PLUS_FILE = 'GentleMAX PRO PLUS Service Manual 8501-00-2410_A_01.pdf';
const PRO_PATH = 'shared/candela/gentlemax_pro/GentleMAX Pro Service Manual.pdf';
const PLUS_PATH = `shared/candela/${PLUS_FILE}`;
const PLUS_PASSAGE = 'ALEX circuit calibration set TX% 85% before simmer. Calibration Successful.';

const PRO_CHAPTERS = [{ storage_path: PRO_PATH, title: 'GentleMAX Pro Service Manual' }];

function proPlusIndex(): string {
  const pages: string[] = [];
  for (let n = 1; n <= 178; n++) {
    let body = `GentleMAX PRO PLUS service body ${n}`;
    if (n === 6) body = 'Table of contents';
    if (n === 92) body = '19.1 Alex Performance Test Tables';
    if (n === 121) body = PLUS_PASSAGE;
    pages.push(`[[pdfpage:${n}]] ${body}`);
  }
  return pages.join('\f');
}

const PLUS_ROW: CatalogCiteRow = {
  id: 5,
  title: 'GentleMAX PRO PLUS Service Manual',
  brand: 'Candela',
  storage_path: PLUS_PATH,
  xai_file_id: 'file_pro_plus',
  page_count: 178,
};

test('suffix table treats pro and pro plus as different models, in both directions', () => {
  assert.deepEqual(modelQualifierIds('GentleMAX Pro Service Manual'), ['pro']);
  assert.deepEqual(modelQualifierIds(PLUS_FILE), ['pro-plus']);
  assert.equal(modelSuffixConflict(PLUS_FILE, `${PRO_FILE} gentlemax pro`), true);
  assert.equal(modelSuffixConflict(PRO_FILE, `${PLUS_FILE} gentlemax pro plus`), true);
  assert.equal(modelSuffixConflict(PRO_FILE, `${PRO_FILE} gentlemax pro`), false);
  assert.equal(modelSuffixConflict(PLUS_FILE, PLUS_FILE), false);
  assert.equal(modelSuffixConflict('GentleMAX Service Manual.pdf', PRO_FILE), true);

  assert.equal(modelSuffixConflict('Acme Max Pro Operator Manual.pdf', 'Acme Max Operator Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme Max Operator Manual.pdf', 'Acme Max Pro Operator Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme Laser II Service Manual.pdf', 'Acme Laser 2 Service Manual.pdf'), false);
  assert.equal(modelSuffixConflict('Acme Laser III Service Manual.pdf', 'Acme Laser 3 Service Manual.pdf'), false);
  assert.equal(modelSuffixConflict('Acme Laser III Service Manual.pdf', 'Acme Laser II Service Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme S Service Manual.pdf', 'Acme Service Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme SE Service Manual.pdf', 'Acme Service Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme XL Service Manual.pdf', 'Acme Service Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme Elite Service Manual.pdf', 'Acme Service Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme Select Service Manual.pdf', 'Acme Service Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme Ultra Service Manual.pdf', 'Acme Service Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme Gen 2 Service Manual.pdf', 'Acme Service Manual.pdf'), true);
  assert.equal(modelSuffixConflict('Acme Gen 2 Service Manual.pdf', 'Acme Generation 2 Service Manual.pdf'), false);
  assert.equal(modelSuffixConflict('Xeo Service Manual RevB.pdf', 'cutera xeo'), false);
  assert.equal(
    modelSuffixConflict(PLUS_FILE, PLUS_FILE),
    false,
    'part numbers such as 8501-00-2410 are not model suffix 2'
  );
});

test('word fallback drops a PRO PLUS chunk while manual 110 is selected', () => {
  const keys = chapterFileKeys(PRO_CHAPTERS);
  assert.ok(keys.some((k) => k.toLowerCase() === 'gentlemax'));
  const hits = [
    {
      text: PLUS_PASSAGE,
      source: PLUS_FILE,
      fileId: 'file_pro_plus',
    },
    {
      text: 'Model GentleMAX PRO P/N 8501-00-9035 Rev 01 front matter for this service manual.',
      source: PRO_FILE,
      fileId: 'file_pro',
    },
  ];
  const filtered = filterHitsForManual(hits, {
    tokens: ['candela', 'gentlemax', 'pro'],
    chapterKeys: keys,
    expectedFilenames: [PRO_FILE, 'GentleMAX_Pro_Service_Manual.pdf'],
    requireMatch: true,
  });
  assert.equal(filtered.parts.length, 1);
  assert.equal(filtered.parts[0].fileId, 'file_pro');

  const onlyPlus = filterHitsForManual([hits[0]], {
    tokens: ['candela', 'gentlemax', 'pro'],
    chapterKeys: keys,
    expectedFilenames: [PRO_FILE],
    requireMatch: true,
  });
  assert.equal(onlyPlus.parts.length, 0);

  const plusSelected = filterHitsForManual(hits, {
    tokens: ['candela', 'gentlemax', 'pro', 'plus'],
    chapterKeys: [],
    expectedFilenames: [PLUS_FILE],
    requireMatch: true,
  });
  assert.equal(plusSelected.parts.length, 1);
  assert.equal(plusSelected.parts[0].fileId, 'file_pro_plus');

  assert.equal(docMatchesManual(PLUS_FILE, ['candela', 'gentlemax', 'pro'], keys, [PRO_FILE]), false);
  const ids = pickFileIdsForManual(
    { file_pro_plus: PLUS_FILE },
    [PRO_FILE],
    ['candela', 'gentlemax', 'pro'],
    keys
  );
  assert.equal(ids.has('file_pro_plus'), false);
});

test('xAI page_number one behind a [[pdfpage:N]] stamp cites the stamp', () => {
  const hits = collectionHitsFromResponse({
    matches: [
      {
        file_id: 'file_pro_plus',
        chunk_content: `[[pdfpage:121]] ${PLUS_PASSAGE}`,
        page_number: 120,
        fields: { filename: PLUS_FILE },
      },
    ],
  });
  assert.equal(hits[0].page, 121);
  assert.equal(reconcilePhysicalPage({ reported: 42, passage: 'Flow switch harness pinout.' }), 42);
  assert.equal(reconcilePhysicalPage({ reported: 0, passage: 'Cover page of the service manual.' }), 1);
  const index = proPlusIndex();
  assert.equal(
    reconcilePhysicalPage({ reported: 120, passage: PLUS_PASSAGE, indexText: index }),
    121
  );
  const repeated = `[[pdfpage:7]] ${PLUS_PASSAGE}\f[[pdfpage:150]] ${PLUS_PASSAGE}`;
  assert.equal(
    reconcilePhysicalPage({ reported: 150, passage: PLUS_PASSAGE, indexText: repeated, trustReported: true }),
    150,
    'an index excerpt page is already the stamp and must not jump to an earlier copy'
  );
  assert.equal(effectivePageCount(undefined, index), 178);
  assert.equal(effectivePageCount(15, index), 15);
  assert.equal(boundCitationPage(12, 15).page_out_of_range, undefined);
  assert.equal(boundCitationPage(147, 15).page_out_of_range, true);
  assert.equal(boundCitationPage(147, 15).page, 147);
});

test('PRO PLUS passage is attributed to manual 5; a real Pro page stays 110', () => {
  const index = proPlusIndex();
  const cites = attributeCitations(
    [
      {
        text: PLUS_PASSAGE,
        source: PLUS_FILE,
        fileId: 'file_pro_plus',
        fileName: PLUS_FILE,
        page: 120,
      },
      {
        text: 'Model GentleMAX PRO P/N 8501-00-9035 Rev 01 front matter for this service manual.',
        source: `${PRO_FILE} p.12`,
        fileId: 'file_pro',
        fileName: PRO_FILE,
        page: 12,
      },
      {
        text: 'A page number past the 15-page Pro fragment must not be treated as a real Pro page.',
        source: PRO_FILE,
        fileName: PRO_FILE,
        fileId: 'file_pro',
        page: 88,
      },
    ],
    110,
    PRO_TITLE,
    {
      fileIds: new Set(['file_pro']),
      expectedFilenames: [PRO_FILE],
      pageCount: 15,
      catalog: [PLUS_ROW],
      indexTextByManualId: { 5: index },
    }
  );

  const plus = cites.find((c) => c.manualId === 5);
  assert.ok(plus, JSON.stringify(cites));
  assert.equal(plus!.page, 121);
  assert.equal(plus!.title, PLUS_TITLE);
  assert.equal(plus!.page_out_of_range, undefined);
  assert.equal(catalogCitationTitle(PLUS_ROW), PLUS_TITLE);

  const pro = cites.find((c) => c.manualId === 110 && c.page === 12);
  assert.ok(pro, JSON.stringify(cites));
  assert.equal(pro!.title, PRO_TITLE);
  assert.equal(pro!.page_out_of_range, undefined);

  const oor = cites.find((c) => c.page === 88);
  assert.ok(oor, JSON.stringify(cites));
  assert.equal(oor!.manualId, 110);
  assert.equal(oor!.page_out_of_range, true);

  assert.equal(
    cites.some((c) => c.manualId === 110 && (c.page === 120 || c.page === 121)),
    false
  );

  const dropped = attributeCitations(
    [
      {
        text: PLUS_PASSAGE,
        source: PLUS_FILE,
        fileName: PLUS_FILE,
        fileId: 'file_pro_plus',
        page: 120,
      },
    ],
    110,
    PRO_TITLE,
    { expectedFilenames: [PRO_FILE], pageCount: 15, catalog: [] }
  );
  assert.deepEqual(dropped, []);

  assert.equal(
    findCatalogRow([PLUS_ROW], { fileId: 'file_pro_plus', fileName: 'renamed-upload.pdf' })?.id,
    5
  );
});

test('a quoted page is used only when it is in range and holds the fault code or the terms', () => {
  const pages: string[] = [];
  for (let n = 1; n <= 178; n++) {
    let body = `GentleMAX PRO PLUS header Page ${n} of 178.`;
    if (n === 89) body += ' If TX = <83%, clean the fiber. Troubleshooting Guide (Chapter 17).';
    if (n === 147) body += ' F14.1 755 nm Simmer Fault. Calibrate laser system. Replace HVPS, flashlamps.';
    if (n === 152) {
      body +=
        ' 31 Laser Rail Spare Parts Item # Part Description Part # 1. ALEX Head 7122-00-9572 2. YAG Head 7122-00-9578 3. Turning Mirror 8015-00-1220 4. Beam Combiner 8055-00-0304';
    }
    if (n === 160) body += ' F14.10 is a different code.';
    pages.push(`[[pdfpage:${n}]] ${body}`);
  }
  const index = pages.join('\f');
  const query =
    'Candela GentleMAX PRO PLUS What does fault code F14.1 mean on this laser fault code 14.1 error 14.1';
  assert.deepEqual(quotedPagesInAnswer('See p. 147.').map((q) => q.pages), [[147]]);
  assert.deepEqual(quotedPagesInAnswer('See pp. 146–148 and page 152.')[0].pages, [146, 147, 148]);
  assert.equal(indexPageBody(index, 147)?.includes('F14.1'), true);
  assert.equal(
    resolveQuotedCitationPage({ answer: 'The table is on page 147.', indexText: index, query, pageCount: 178 }),
    147
  );
  assert.equal(
    resolveQuotedCitationPage({ answer: 'See pp. 146–148.', indexText: index, query, pageCount: 178 }),
    147
  );
  assert.equal(
    resolveQuotedCitationPage({ answer: 'See page 152.', indexText: index, query, pageCount: 178 }),
    undefined
  );
  assert.equal(
    resolveQuotedCitationPage({ answer: 'See page 200.', indexText: index, query, pageCount: 178 }),
    undefined
  );
  assert.equal(
    resolveQuotedCitationPage({ answer: 'See page 147.', indexText: index, query, pageCount: 15 }),
    undefined
  );
  assert.equal(
    resolveQuotedCitationPage({ answer: 'See page 10.', indexText: index, query, pageCount: 178 }),
    undefined
  );
  const tx = 'Candela GentleMAX PRO PLUS transmission below 83%';
  assert.equal(
    resolveQuotedCitationPage({ answer: 'Repeat until TX is above 83%. See p. 89.', indexText: index, query: tx, pageCount: 178 }),
    89
  );
  assert.equal(
    resolveQuotedCitationPage({
      answer: 'The footer says Page 83 of 178.',
      indexText: index,
      query: tx,
      pageCount: 178,
    }),
    undefined
  );
});

test('a model name in the manual label does not make the cover a quoted fault page', () => {
  const pages: string[] = [];
  for (let n = 1; n <= 8; n++) {
    let body = 'Lumenis service notes.';
    if (n === 1) body = 'Lumenis M22 Service Manual. Cover.';
    if (n === 5) body = 'Lumenis. Calibrate the fluence. Follow the procedure steps.';
    pages.push(`[[pdfpage:${n}]] ${body}`);
  }
  const index = pages.join('\f');
  const query = 'Lumenis M22 how do I calibrate the fluence procedure specification steps';
  const ignoreCodes = ['M22'];
  assert.equal(
    resolveQuotedCitationPage({ answer: 'See p. 1.', indexText: index, query, pageCount: 8, ignoreCodes }),
    undefined
  );
  assert.equal(
    resolveQuotedCitationPage({ answer: 'See page 5.', indexText: index, query, pageCount: 8, ignoreCodes }),
    5
  );
  assert.equal(
    resolveQuotedCitationPage({ answer: 'See p. 1.', indexText: index, query, pageCount: 8 }),
    1
  );
});

test('a refusal is not a citation, and a printed footer is not the PDF page', () => {
  assert.equal(
    answerDeclinesManualCitation('The retrieved passages do not contain the speaker volume adjustment.'),
    true
  );
  assert.equal(answerDeclinesManualCitation('This detail is not in the selected manual.'), true);
  assert.equal(answerDeclinesManualCitation('No information about that procedure was found.'), true);
  assert.equal(answerDeclinesManualCitation("The passages don't describe a fan-speed adjustment."), true);
  assert.equal(answerDeclinesManualCitation('Do not use single-wavelength eyewear for this wavelength.'), false);
  assert.equal(answerDeclinesManualCitation('Use OD 4.9 eyewear at 591 to 597 nm.'), false);
  assert.equal(
    answerDeclinesManualCitation('Fault 2.1 is not described as a user-serviceable fault; call service.'),
    false
  );

  const pages: string[] = [];
  for (let n = 1; n <= 80; n++) {
    let body = `body ${n}`;
    if (n === 66) body = 'Calibration reminder after cleaning the window. Page 54 of 178.';
    if (n === 71) body = 'OPTICAL DENSITY OF AT LEAST 4.9 AT 591 - 597 NM. Page 2 of 5.';
    if (n === 74) body = 'Page 5 of 5. Alignment steps. No optical density on this sheet.';
    pages.push(`[[pdfpage:${n}]] ${body}`);
  }
  const index = pages.join('\f');
  assert.equal(
    alignReplyToCitationPage('The reminder is on page 54 of 178.', 66, index),
    'The reminder is on page 66.'
  );
  assert.equal(
    alignReplyToCitationPage('See page 2 of 5 for the optical density.', 71, index),
    'See page 71 for the optical density.'
  );
  assert.equal(
    alignReplyToCitationPage('The value is on page 74.', 71, index),
    'The value is on page 74.'
  );
  assert.equal(boundCitationPage(156, 80).page_out_of_range, true);
  assert.equal(effectivePageCount(undefined, index), 80);
});

test('a printed footer is rewritten only when the mapping is unambiguous', () => {
  const pad = 'service notes '.repeat(40);
  const twoFooters = `${pad}see Page 2 of 5. ${pad}Page 55 of 178`;
  assert.equal(printedPageLabel(twoFooters), undefined);
  const earlyOnly = `Page 54 of 178 ${'x'.repeat(250)}`;
  assert.equal(printedPageLabel(earlyOnly), undefined);
  const repeated = `Page 54 of 178 ${'x'.repeat(250)} Page 54 of 178`;
  assert.equal(printedPageLabel(repeated), 54);

  const pages: string[] = [];
  for (let n = 1; n <= 80; n++) {
    let body = `${pad}body ${n}.`;
    if (n === 54) body = `${pad}The DI cartridge is installed in the bay. Page 40 of 178.`;
    if (n === 63) body = `${pad}Window cleaning reminder. Page 54 of 178.`;
    if (n === 64) body = `see Page 2 of 5 before the drawing. ${pad}Page 55 of 178`;
    if (n === 70) body = `${pad}Another leaf. Page 54 of 178.`;
    pages.push(`[[pdfpage:${n}]] ${body}`);
  }
  const index = pages.join('\f');
  const query = 'Where is the DI cartridge installed';
  assert.equal(
    alignReplyToCitationPage('The DI cartridge is on page 54.', 63, index, { query, pageCount: 178 }),
    'The DI cartridge is on page 54.'
  );
  assert.equal(
    alignReplyToCitationPage('The DI cartridge is on page 54 of 178.', 63, index, { query, pageCount: 178 }),
    'The DI cartridge is on page 54 of 178.'
  );
  assert.equal(
    alignReplyToCitationPage('See pp. 54-55 for the range.', 63, index),
    'See pp. 54-55 for the range.'
  );
  assert.equal(
    alignReplyToCitationPage('See page 54.2 for the decimal.', 63, index),
    'See page 54.2 for the decimal.'
  );
  assert.equal(
    alignReplyToCitationPage('see page 2 for the sheet.', 64, index),
    'see page 2 for the sheet.'
  );
  assert.equal(printedPageLabel(indexPageBody(index, 64) || ''), undefined);
  // Page 70 carries the same footer, so a bare "page 54" is not rewritten.
  // "page 54 of 178" still names the footer on the cited page.
  const noCartridge = 'Where is the window cleaning reminder';
  assert.equal(
    alignReplyToCitationPage('The reminder is on page 54.', 63, index, { query: noCartridge, pageCount: 178 }),
    'The reminder is on page 54.'
  );
  assert.equal(
    alignReplyToCitationPage('The reminder is on page 54 of 178.', 63, index, { query: noCartridge, pageCount: 178 }),
    'The reminder is on page 63.'
  );
});

test('footer-to-pages map is cached once per index load', () => {
  const pad = 'service notes '.repeat(40);
  const pages: string[] = [];
  for (let n = 1; n <= 80; n++) {
    let body = `${pad}body ${n}.`;
    if (n === 63) body = `${pad}Window cleaning reminder. Page 54 of 178.`;
    if (n === 70) body = `${pad}Another leaf. Page 54 of 178.`;
    pages.push(`[[pdfpage:${n}]] ${body}`);
  }
  const index = pages.join('\f');
  const first = rememberManualIndex(9, index);
  const second = rememberManualIndex(9, index);
  assert.equal(first, second);
  assert.equal(footerPagesForIndex(index), first);
  assert.deepEqual(first.get(54), [63, 70]);
  assert.equal(
    alignReplyToCitationPage('The reminder is on page 54.', 63, index),
    'The reminder is on page 54.',
  );
  assert.equal(
    alignReplyToCitationPage('The reminder is on page 54 of 178.', 63, index),
    'The reminder is on page 63.',
  );
  const changedText = `${index}\f[[pdfpage:81]] ${pad}Page 54 of 178.`;
  const changed = rememberManualIndex(9, changedText);
  assert.notEqual(changed, first);
  assert.deepEqual(changed.get(54), [63, 70, 81]);
  assert.equal(footerPagesForIndex(changedText), changed);
  assert.deepEqual(footerPagesForIndex(index).get(54), [63, 70]);
});
