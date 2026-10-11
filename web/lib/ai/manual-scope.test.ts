import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import {
  asManualId,
  assistantManualPicker,
  buildGrokChatPayload,
  collectionSearchRequiresManualMatch,
  manualDisplayLabel,
  selectedManualContext,
  humanizeDeviceCode,
  humanizeGeneralGuidanceDisplay,
  chapterLanguageHints,
  excerptFaultCodeAnchor,
  excerptManualSearchText,
  excerptSpanScoreScale,
  faultCodeTokens,
  indexedExcerptPage,
  indexedExcerptSection,
  preferredExcerptLanguage,
  sectionHeadingOnPage,
  quotedPageSupport,
  generalGuidancePrefix,
  generalGuidanceSystemHint,
  prefixGeneralGuidance,
  manualPathsAlign,
  pdfPageCountFromBytes,
  WHOLE_PDF_ATTACH_MAX_BYTES,
  WHOLE_PDF_ATTACH_MAX_PAGES,
  wholePdfAttachAllowed,
  normalizeManualPath,
  manualPathKey,
  folderPrefixForAiAttach,
  hasAttachablePdfHint,
  pdfPathsForAiAttach,
  resolveManualFromCatalog,
} from './manual-scope.ts';
import {
  folderPrefixForAiAttach as edgeFolderPrefixForAiAttach,
  generalGuidancePrefix as edgeGeneralGuidancePrefix,
  manualPathKey as edgeManualPathKey,
  normalizeManualPath as edgeNormalizeManualPath,
  pdfPathsForAiAttach as edgePdfPathsForAiAttach,
  prefixGeneralGuidance as edgePrefixGeneralGuidance,
  collectionSearchRequiresManualMatch as edgeCollectionSearchRequiresManualMatch,
  selectedManualContext as edgeSelectedManualContext,
  assistantLanguageDirective,
  normalizeReplyLanguage,
  excerptFaultCodeAnchor as edgeExcerptFaultCodeAnchor,
  excerptSpanScoreScale as edgeExcerptSpanScoreScale,
  faultCodeTokens as edgeFaultCodeTokens,
  chapterLanguageHints as edgeChapterLanguageHints,
  excerptManualSearchText as edgeExcerptManualSearchText,
  indexedExcerptPage as edgeIndexedExcerptPage,
  indexedExcerptSection as edgeIndexedExcerptSection,
  preferredExcerptLanguage as edgePreferredExcerptLanguage,
  quotedPageSupport as edgeQuotedPageSupport,
  sectionHeadingOnPage as edgeSectionHeadingOnPage,
} from '../../../supabase/functions/grok-assistant/manual-scope.ts';

const here = dirname(fileURLToPath(import.meta.url));

const ELITE_SM = {
  id: 16,
  title: 'Elite Service Manual',
  brand: 'Cynosure',
  model: 'elite',
  storage_path: 'shared/cynosure/elite',
};
const ELITE_MPX = {
  id: 721,
  title: "Cynosure Elite MPX Operator's Manual (Operating Instructions)",
  brand: 'Cynosure',
  model: 'elite_mpx',
  storage_path: 'shared/cynosure/elite_mpx/cynosure_elite_mpx_opman.pdf',
  is_incomplete: true,
};
const CATALOG = [ELITE_SM, ELITE_MPX];

test('elite SM folder does not collide with elite_mpx file', () => {
  assert.equal(manualPathsAlign('shared/cynosure/elite', 'shared/cynosure/elite'), true);
  assert.equal(
    manualPathsAlign('shared/cynosure/elite/Elite Modular Service Manual.pdf', 'shared/cynosure/elite'),
    true
  );
  assert.equal(
    manualPathsAlign('shared/cynosure/elite', 'shared/cynosure/elite_mpx/cynosure_elite_mpx_opman.pdf'),
    false
  );
  assert.equal(
    manualPathsAlign(
      'shared/cynosure/elite_mpx/cynosure_elite_mpx_opman.pdf',
      'shared/cynosure/elite_mpx/cynosure_elite_mpx_opman.pdf'
    ),
    true
  );
  assert.equal(normalizeManualPath('/Shared/Cynosure/Elite/'), 'Shared/Cynosure/Elite');
  assert.equal(manualPathKey('/Shared/Cynosure/Elite/'), 'shared/cynosure/elite');
  assert.equal(
    manualPathsAlign(
      'shared/cutera/xeo/Xeo Service Manual RevB.pdf',
      'shared/cutera/xeo/xeo service manual revb.pdf'
    ),
    true
  );
});

test('resolveManualFromCatalog prefers id, then exact path, and never picks MPX for Elite SM', () => {
  assert.equal(resolveManualFromCatalog(CATALOG, { manualPath: 'shared/cynosure/elite' })?.id, 16);
  assert.equal(
    resolveManualFromCatalog(CATALOG, {
      manualPath: 'shared/cynosure/elite_mpx/cynosure_elite_mpx_opman.pdf',
    })?.id,
    721
  );
  assert.equal(
    resolveManualFromCatalog(CATALOG, { manualId: 16, manualPath: ELITE_MPX.storage_path })?.id,
    16
  );
  assert.equal(resolveManualFromCatalog(CATALOG, { manualId: 721 })?.id, 721);
  assert.equal(asManualId('721'), 721);
  assert.equal(asManualId('nope'), null);
});

test('open manual 1086 is scoped by id with its title and model, even with an empty label', () => {
  const ritter = {
    id: 1086,
    brand: 'Midmark',
    title: 'Midmark Ritter 112/113 Special Procedure Table Service Manual',
    model: 'ritter_112_113',
    storagePath: 'shared/midmark/ritter_112_113/Midmark_ritter_112_113_Service_Manual.pdf',
  };
  const prompt = selectedManualContext(ritter);
  assert.equal(edgeSelectedManualContext(ritter), prompt);
  assert.match(prompt, /Midmark Ritter 112\/113 Special Procedure Table Service Manual/);
  assert.match(prompt, /ritter_112_113/);
  assert.match(prompt, /id: 1086/);
  assert.match(prompt, /indexed text before any other book/);
  assert.doesNotMatch(prompt, /None selected/);
  assert.equal(
    manualDisplayLabel(ritter.brand, ritter.title),
    'Midmark Ritter 112/113 Special Procedure Table Service Manual'
  );
  assert.equal(collectionSearchRequiresManualMatch({ manualId: 1086, manualLabel: '' }), true);
  assert.equal(edgeCollectionSearchRequiresManualMatch({ manualId: '1086' }), true);
  assert.equal(collectionSearchRequiresManualMatch({ manualId: null, manualLabel: '' }), false);
  assert.match(selectedManualContext({}), /None selected/);

  const payload = buildGrokChatPayload({
    messages: [{ role: 'user', content: 'The back actuator is leaking hydraulic fluid.' }],
    manualId: '1086',
    manualPath: ritter.storagePath,
    manualTitle: ritter.title,
    manualBrand: ritter.brand,
    manualModel: ritter.model,
  });
  assert.equal(payload.manualId, 1086);
  assert.equal(payload.manualTitle, ritter.title);
  assert.equal(payload.manualBrand, 'Midmark');
  assert.equal(payload.manualModel, 'ritter_112_113');
});

test('changing the dropdown sends the new id/path and drops the previous manual’s turns', () => {
  const prior = [
    { role: 'user' as const, content: 'What wavelengths?' },
    { role: 'assistant' as const, content: '— Source: Cynosure Elite MPX Operator’s Manual' },
    { role: 'user' as const, content: 'What wavelengths?' },
  ];
  const next = buildGrokChatPayload({
    messages: prior,
    manualId: 16,
    manualPath: ELITE_SM.storage_path,
    lastSentManualId: 721,
    lastSentManualPath: ELITE_MPX.storage_path,
  });
  assert.equal(next.manualId, 16);
  assert.equal(next.manualPath, 'shared/cynosure/elite');
  assert.equal(next.scopeChanged, true);
  assert.deepEqual(
    next.messages.map((m) => m.content),
    ['What wavelengths?']
  );
  assert.doesNotMatch(next.messages.map((m) => m.content).join('\n'), /Operator/);

  const same = buildGrokChatPayload({
    messages: prior,
    manualId: 721,
    manualPath: ELITE_MPX.storage_path,
    lastSentManualId: 721,
    lastSentManualPath: ELITE_MPX.storage_path,
  });
  assert.equal(same.scopeChanged, false);
  assert.equal(same.messages.length, 3);
});

test('single-file manuals attach the storage_path PDF; folders use chapters or a prefix', () => {
  assert.deepEqual(pdfPathsForAiAttach(ELITE_MPX), [ELITE_MPX.storage_path]);
  assert.deepEqual(
    pdfPathsForAiAttach({
      storage_path: 'shared/cynosure/elite',
      entry_file_path: 'shared/cynosure/elite/Elite Modular Service Manual.pdf',
      chapter_metadata: [
        { storage_path: 'shared/cynosure/elite/a.pdf' },
        { storage_path: 'shared/cynosure/elite/b.pdf' },
      ],
    }),
    ['shared/cynosure/elite/a.pdf', 'shared/cynosure/elite/b.pdf']
  );
  assert.equal(folderPrefixForAiAttach(ELITE_SM), 'shared/cynosure/elite');
  assert.equal(folderPrefixForAiAttach(ELITE_MPX), null);
  assert.equal(hasAttachablePdfHint(ELITE_MPX), true);
  assert.equal(hasAttachablePdfHint(ELITE_SM), true);
  assert.equal(hasAttachablePdfHint({ storage_path: '' }), false);
  assert.match(excerptManualSearchText('Alex 755 nm and YAG 1064 nm wavelengths.', 'wavelengths'), /1064/);

  const indexed = `${'earlier page '.repeat(20)}\f`.repeat(151) + '(p. 152) RF deck calibration for the CO2RE handpiece. Section 8.4 alignment.';
  assert.equal(indexedExcerptPage(indexed, 'RF deck calibration'), 152);
  assert.equal(indexedExcerptSection(indexed, 'RF deck calibration'), '8.4');
  const feedsOnly = Array.from({ length: 151 }, () => 'handpiece notes').join('\f') + '\f RF deck calibration target value';
  assert.equal(indexedExcerptPage(feedsOnly, 'RF deck calibration'), 152);
  assert.equal(indexedExcerptPage('no markers here about calibration', 'calibration'), undefined);
  assert.equal(indexedExcerptPage('[[pdfpage:12]]\nKühlung des Laserhandstücks prüfen.', 'Kühlung'), 12);
  const printed = 'Error 43 is described on pages 7-8 of the CO2RE handpiece chapter.';
  assert.equal(indexedExcerptPage(printed, 'handpiece'), undefined);
  const physical = `${'earlier page '.repeat(10)}\f`.repeat(149) + 'pages 7-8 RF deck calibration target';
  assert.equal(indexedExcerptPage(physical, 'RF deck calibration'), 150);
  const stamped = 'pages 7-8 intro\f[[pdfpage:150]] error 43 RF deck calibration';
  assert.equal(indexedExcerptPage(stamped, 'RF deck calibration'), 150);

  const pages: string[] = [];
  for (let n = 1; n <= 161; n++) {
    let text = `CO2RE service manual laser section ${n}.`;
    if (n === 7) text += ' Figure 6-43 Error Message Screen. CO2RE laser power high.';
    if (n === 141) text += ' Figure 6-43 Aligning Red Laser to CO2 Laser.';
    if (n === 150) text += ' CW Laser\n  43   Power Too High. Reset power to clear error.';
    if (n === 151) text += ' Pulsed Laser Power Too High. Laser CW Cal data missing.';
    pages.push(`[[pdfpage:${n}]] ${text}`);
  }
  const co2re = pages.join('\f');
  for (const question of [
    'On the CO2RE, what does error #43 CW Laser Power Too High mean',
    'error 43 CW laser power too high',
    'CO2RE error 43',
  ]) {
    const page = indexedExcerptPage(co2re, question);
    assert.ok(page === 150 || page === 151, `${question} -> ${page}`);
    assert.match(excerptManualSearchText(co2re, question), /Power Too High/i);
  }
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

test('transmission below 83% anchors the threshold pages, not the footer or the cal-port table', () => {
  const indexed = gentleMaxTransmissionIndex();
  const label = 'Candela GentleMAX PRO PLUS';
  for (const question of [
    'TX not >83%',
    'transmission below 83%',
    'transmission under 83%',
    'transmission less than 83%',
    'transmission threshold',
  ]) {
    const page = indexedExcerptPage(indexed, `${label} ${question}`);
    assert.ok(page === 88 || page === 89, `${question} -> ${page}`);
    if (question === 'transmission below 83%') assert.equal(page, 89);
  }
  const fluence = indexedExcerptPage(
    indexed,
    `${label} What is the maximum fluence setting for the GentleMAX Pro Plus? procedure specification steps`
  );
  assert.equal(fluence, 49);
});

/** Live GentleMAX PRO PLUS leaves: fault table on 147, Laser Rail Spare Parts on 152. */
function gentleMaxFaultIndex(): string {
  const page147 =
    'GentleMax Pro Plus Service Manual 8501-00-2410 Revision A Candela Corporation, PROPRIETARY Page 147 of 178 Fault Code Symptom or Problem Probable Cause Action If problem persists, contact Candela Service. F12.3 Max Energy Exceeded fault Alex or YAG head energy of last treatment pulse is greater than the maximum allowed. Re-calibrate laser. F13.4 Footswitch fault Footswitch is stuck On. F14.1 755 nm Simmer Fault Alex Simmer circuit fault. Calibrate laser system. If problem persists, contact Candela Service. Replace HVPS, flashlamps. F14.2 1064 nm Simmer Fault YAG Simmer circuit fault. Calibrate laser system. Replace HVPS, flashlamps. F15.1 Delivery System Transmission Low fault.';
  const page152 =
    'GentleMax Pro Plus Service Manual 8501-00-2410 Revision A Candela Corporation, PROPRIETARY Page 152 of 178 31 Laser Rail Spare Parts Figure 95 Laser Rail Components Lower Level Spare Parts Item # Part Description Part # 1. ALEX Head 7122-00-9572 2. YAG Head 7122-00-9578 3. Turning Mirror 8015-00-1220 4. Beam Combiner 8055-00-0304 5. Intermediate Lens 8050-00-9008 6. Shutter 7122-00-9529 7. Head Detector Filter 1301-00-9395 8. Spectrum Head Detector Beamsplitter 8055-00-0309 9. Aiming Beam 7122-00-3477 10. Fiber Receptacle Lens (2) 8050-00-9003 11. Fiber Switch 7122-00-3536 7 16 14 11 12 17 4 3 9 10 6 5 8 2 13 1 15 12';
  const pages: string[] = [];
  for (let n = 1; n <= 178; n++) {
    let text = `GentleMax Pro Plus Service Manual 8501-00-2410 Revision A Candela Corporation, PROPRIETARY Page ${n} of 178.`;
    if (n === 49) {
      text += ' 9 System Settings by Wavelength. Minimum Fluence (J/cm2) Maximum Fluence (J/cm2).';
    }
    if (n === 89) {
      text +=
        ' If TX = <83%, clean or replace the fiber and repeat until transmission is >83%. Perform the steps in the Troubleshooting Guide (Chapter 17).';
    }
    if (n === 147) text = page147;
    if (n === 152) text = page152;
    if (n === 160) text += ' F14.10 Extended rail code. Not the 755 nm simmer fault.';
    pages.push(`[[pdfpage:${n}]] ${text}`);
  }
  return pages.join('\f');
}

const F14_QUERY =
  'Candela GentleMAX PRO PLUS What does fault code F14.1 mean on this laser, and what should I do about it? Cite the manual page. fault code 14.1 error 14.1';

test('F14.1 cites the fault table on page 147, not the Laser Rail spare-parts page', () => {
  const indexed = gentleMaxFaultIndex();
  assert.equal(indexedExcerptPage(indexed, F14_QUERY), 147);
  assert.equal(edgeIndexedExcerptPage(indexed, F14_QUERY), 147);
  assert.equal(quotedPageSupport(indexed.split('\f')[146], F14_QUERY, indexed) > 0, true);
  assert.equal(quotedPageSupport(indexed.split('\f')[151], F14_QUERY, indexed), 0);
  assert.equal(quotedPageSupport(indexed.split('\f')[159], F14_QUERY, indexed), 0);
  assert.equal(edgeQuotedPageSupport(indexed.split('\f')[151], F14_QUERY, indexed), 0);
  const partsQuestion =
    'Candela GentleMAX PRO PLUS What spare parts are listed for the laser rail?';
  assert.equal(indexedExcerptPage(indexed, partsQuestion), 152);
  assert.equal(edgeIndexedExcerptPage(indexed, partsQuestion), 152);
});

/** Lumenis M22 is a model name, not a fault code. Cover has the name; page 5 has the procedure. */
function lumenisM22Index(): string {
  const pages: string[] = [];
  for (let n = 1; n <= 8; n++) {
    let text = 'Lumenis service notes.';
    if (n === 1) text = 'Lumenis M22 Service Manual. Cover.';
    if (n === 5) text = 'Lumenis. Calibrate the fluence. Follow the procedure steps.';
    if (n === 7) {
      text =
        'Lumenis Spare Parts Item # Part # 1. Handpiece 7122-00-9572 2. Lens 8015-00-1220 3. Filter 1301-00-9395 4. Mirror 8055-00-0304';
    }
    pages.push(`[[pdfpage:${n}]] ${text}`);
  }
  return pages.join('\f');
}

function formFeedSpans(hay: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < hay.length; i++) {
    if (hay.charCodeAt(i) !== 12) continue;
    if (i > start) spans.push({ start, end: i });
    start = i + 1;
  }
  if (start < hay.length) spans.push({ start, end: hay.length });
  return spans;
}

test('a model name in the manual label is not a fault code', () => {
  const indexed = lumenisM22Index();
  const label = 'Lumenis M22';
  const question = 'how do I calibrate the fluence';
  const query = `${label} ${question} procedure specification steps`;
  const ignore = faultCodeTokens(label);
  const edgeIgnore = edgeFaultCodeTokens(label);
  assert.deepEqual(ignore.map((code) => code.toLowerCase()), ['m22']);
  assert.deepEqual(edgeIgnore.map((code) => code.toLowerCase()), ['m22']);
  const cover = indexed.split('\f')[0];
  const procedure = indexed.split('\f')[4];
  const parts = indexed.split('\f')[6];
  assert.equal(quotedPageSupport(cover, query, indexed), 111);
  assert.equal(quotedPageSupport(cover, query, indexed, ignore), 0);
  assert.equal(edgeQuotedPageSupport(cover, query, indexed, edgeIgnore), 0);
  assert.equal(quotedPageSupport(procedure, query, indexed, ignore) > 0, true);
  assert.equal(edgeQuotedPageSupport(procedure, query, indexed, edgeIgnore) > 0, true);
  const hay = indexed.toLowerCase();
  const spans = formFeedSpans(hay);
  assert.equal(excerptFaultCodeAnchor(hay, query, spans, new Map(), ignore), -1);
  assert.equal(edgeExcerptFaultCodeAnchor(hay, query, spans, new Map(), edgeIgnore), -1);
  assert.ok(excerptFaultCodeAnchor(hay, query, spans, new Map()) >= 0);
  assert.equal(excerptSpanScoreScale(query, parts, ignore), 1);
  assert.equal(edgeExcerptSpanScoreScale(query, parts, edgeIgnore), 1);
  assert.equal(excerptSpanScoreScale(query, parts), 0.25);
  assert.equal(indexedExcerptPage(indexed, query, ignore), 5);
  assert.equal(edgeIndexedExcerptPage(indexed, query, edgeIgnore), 5);
  assert.equal(indexedExcerptPage(indexed, query), 1);
});

test('maximum fluence anchors the settings page, not the following calibration chapter', () => {
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
  const indexed = pages.join('\f');
  const query =
    'Candela GentleMAX PRO PLUS What is the maximum fluence setting for the GentleMAX Pro Plus? procedure specification steps';
  assert.equal(indexedExcerptPage(indexed, query), 49);
});

test('CO2RE pdftotext reference anchors error 43 on physical page 150', (t) => {
  const path = [
    process.env.CO2RE_PDFTOTEXT,
    '/home/ubuntu/.cursor/projects/workspace/uploads/CO2RE_pdftotext_reference_1dde.txt',
  ].find((candidate) => candidate && existsSync(candidate));
  if (!path) {
    t.skip('CO2RE pdftotext reference is not in this environment');
    return;
  }
  const raw = readFileSync(path, 'utf8');
  const parts = raw.split('\f');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  assert.equal(parts.length, 161);
  const stamped = parts.map((page, index) => `[[pdfpage:${index + 1}]] ${page}`).join('\f');
  for (const question of [
    'On the CO2RE, what does error #43 CW Laser Power Too High mean',
    'error 43 CW laser power too high',
    'CO2RE error 43',
  ]) {
    const page = indexedExcerptPage(stamped, question);
    assert.ok(page === 150 || page === 151, `${question} -> ${page}`);
  }
});

const XEO_105 = {
  id: 105,
  title: 'Cutera Xeo Service Manual',
  storage_path: 'shared/cutera/xeo',
  is_folder: true,
  chapter_metadata: [
    { storage_path: 'shared/cutera/xeo/Xeo Service Manual RevB.pdf' },
    { storage_path: 'shared/cutera/xeo/Xeo System Schematics RevB.pdf' },
    { storage_path: 'shared/cutera/xeo/Xeo Service Manual RevB.pdf' },
  ],
};

test('pdfPathsForAiAttach / normalizeManualPath keep Xeo 105 mixed-case Storage keys', () => {
  const expected = [
    'shared/cutera/xeo/Xeo Service Manual RevB.pdf',
    'shared/cutera/xeo/Xeo System Schematics RevB.pdf',
  ];
  assert.deepEqual(pdfPathsForAiAttach(XEO_105), expected);
  assert.equal(
    normalizeManualPath('/shared/cutera/xeo/Xeo Service Manual RevB.pdf'),
    'shared/cutera/xeo/Xeo Service Manual RevB.pdf'
  );
  assert.equal(
    manualPathKey('/shared/cutera/xeo/Xeo Service Manual RevB.pdf'),
    'shared/cutera/xeo/xeo service manual revb.pdf'
  );
  assert.equal(folderPrefixForAiAttach(XEO_105), 'shared/cutera/xeo');
  assert.deepEqual(edgePdfPathsForAiAttach(XEO_105), expected);
  assert.equal(
    edgeNormalizeManualPath('/shared/cutera/xeo/Xeo Service Manual RevB.pdf'),
    'shared/cutera/xeo/Xeo Service Manual RevB.pdf'
  );
  assert.equal(
    edgeManualPathKey('/shared/cutera/xeo/Xeo Service Manual RevB.pdf'),
    'shared/cutera/xeo/xeo service manual revb.pdf'
  );
  assert.equal(edgeFolderPrefixForAiAttach(XEO_105), 'shared/cutera/xeo');
});

test('scope change compares paths case-insensitively but sends original casing', () => {
  const same = buildGrokChatPayload({
    messages: [{ role: 'user', content: 'schematics?' }],
    manualPath: 'shared/cutera/xeo/Xeo Service Manual RevB.pdf',
    lastSentManualPath: 'shared/cutera/xeo/xeo service manual revb.pdf',
  });
  assert.equal(same.scopeChanged, false);
  assert.equal(same.manualPath, 'shared/cutera/xeo/Xeo Service Manual RevB.pdf');
});

test('assistant answers in the site language and still cites a non-English manual', () => {
  assert.equal(normalizeReplyLanguage('pt-BR'), 'pt');
  assert.equal(normalizeReplyLanguage(''), 'en');
  const block = assistantLanguageDirective({ replyLanguage: 'es', manualLanguage: 'de' });
  assert.match(block, /ANSWER LANGUAGE/);
  assert.match(block, /Spanish \(es\)/);
  assert.match(block, /German \(de\)/);
  assert.match(block, /Still retrieve and cite this manual/);
  assert.match(block, /Write the answer in Spanish/);
  const fn = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  assert.match(fn, /assistantLanguageDirective\(/);
  assert.match(fn, /selectManualRows/);
  assert.match(fn, /\\p\{L\}/);
  assert.match(fn, /Language does not exclude a manual/);
  const client = readFileSync(join(here, '../../app/ai-assistant/AIAssistantClient.tsx'), 'utf8');
  assert.match(client, /replyLanguage: siteLanguage/);
  assert.match(client, /manualLanguage/);
  const payload = buildGrokChatPayload({
    messages: [{ role: 'user', content: 'Was bedeutet Fehler 43?' }],
    manualId: 16,
    manualLanguage: 'de',
    replyLanguage: 'es',
  });
  assert.equal(payload.manualLanguage, 'de');
  assert.equal(payload.replyLanguage, 'es');
});

test('AI assistant and grok-assistant send current id/path and do not skip incomplete PDFs', () => {
  const client = readFileSync(join(here, '../../app/ai-assistant/AIAssistantClient.tsx'), 'utf8');
  const grok = readFileSync(join(here, 'grok-client.ts'), 'utf8');
  const fn = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  const reindex = readFileSync(join(here, '../../app/api/god/manuals/reindex/route.ts'), 'utf8');
  const godPage = readFileSync(join(here, '../../app/admin/god/manuals/page.tsx'), 'utf8');
  const android = readFileSync(join(here, '../../../app/src/main/assets/ai_assistant.html'), 'utf8');

  assert.match(client, /buildGrokChatPayload/);
  assert.match(client, /manualId/);
  assert.match(client, /lastSentRef/);
  assert.match(grok, /manualId/);
  assert.match(fn, /resolveManualFromCatalog/);
  assert.match(fn, /manual_search_index/);
  assert.match(fn, /pdfPathsForAiAttach\(manual/);
  assert.match(fn, /collectionSearchBody/);
  const collectionSearch = readFileSync(
    join(here, '../../../supabase/functions/grok-assistant/collection-search.ts'),
    'utf8'
  );
  assert.match(collectionSearch, /collection_ids:\s*\[collectionId\]/);
  const scopeSrc = readFileSync(join(here, '../../../supabase/functions/grok-assistant/manual-scope.ts'), 'utf8');
  assert.match(scopeSrc, /Never pass this to Storage I\/O/);
  assert.match(scopeSrc, /export function manualPathKey/);
  assert.doesNotMatch(fn, /ns\.includes\(normPath\)|normPath\.includes\(ns\)/);
  assert.match(reindex, /manualId|manual_id/);
  assert.match(reindex, /is_incomplete/);
  assert.doesNotMatch(reindex, /is_incomplete\s*===|skip.*incomplete/i);
  assert.match(godPage, /Index this manual|catalog id/i);
  assert.match(godPage, /Attach to Grok collection/);
  assert.match(godPage, /Attach missing Grok collections/);
  assert.match(reindex, /manualsNeedingXaiAttach|attachCollection/);
  assert.match(android, /manualId/);
});

test('large manuals are not attached, and a missing corpus still gets general guidance', () => {
  assert.equal(WHOLE_PDF_ATTACH_MAX_BYTES, 3 * 1024 * 1024);
  assert.equal(WHOLE_PDF_ATTACH_MAX_PAGES, 60);
  assert.equal(wholePdfAttachAllowed([{ bytes: 7_700_000, pages: 161 }]), false);
  assert.equal(wholePdfAttachAllowed([{ bytes: WHOLE_PDF_ATTACH_MAX_BYTES + 1, pages: 10 }]), false);
  assert.equal(wholePdfAttachAllowed([{ bytes: 900_000, pages: 80 }]), false);
  assert.equal(wholePdfAttachAllowed([{ bytes: 900_000, pages: 40 }]), true);
  assert.equal(wholePdfAttachAllowed([{ bytes: null, pages: null }]), true);
  assert.equal(wholePdfAttachAllowed([]), false);
  assert.equal(pdfPageCountFromBytes('<< /Type /Pages /Count 161 /Kids [1 0 R] >>'), 161);
  assert.equal(pdfPageCountFromBytes('<< /Count 42 /Type /Pages >>'), 42);
  assert.equal(pdfPageCountFromBytes('no pages here'), null);

  const candela = { brand: 'Candela', model: 'CO2RE', title: 'CO2RE Service Manual' };
  const prefix = "I couldn't search this manual's text yet, so this is general guidance for the Candela CO2RE:";
  assert.equal(generalGuidancePrefix(candela), prefix);
  assert.equal(generalGuidancePrefix({ brand: 'Candela', title: 'CO2RE Service Manual' }),
    "I couldn't search this manual's text yet, so this is general guidance for the Candela CO2RE Service Manual:");
  assert.equal(generalGuidancePrefix({ brand: 'Candela', model: 'Candela CO2RE' }), prefix);
  assert.equal(generalGuidancePrefix({ model: 'GentleMax' }),
    "I couldn't search this manual's text yet, so this is general guidance for the GentleMax:");
  const zeiss = { brand: 'Zeiss', model: 'visulas_yag_iii', title: 'Visulas YAG III Service Manual' };
  const zeissPrefix =
    "I couldn't search this manual's text yet, so this is general guidance for the Zeiss Visulas YAG III:";
  assert.equal(humanizeDeviceCode('visulas_yag_iii'), 'Visulas YAG III');
  assert.equal(generalGuidancePrefix(zeiss), zeissPrefix);
  assert.equal(edgeGeneralGuidancePrefix(zeiss), generalGuidancePrefix(zeiss));
  assert.equal(
    humanizeGeneralGuidanceDisplay(
      "I couldn't search this manual's text yet, so this is general guidance for the Zeiss visulas_yag_iii:"
    ),
    zeissPrefix
  );
  assert.match(generalGuidancePrefix({}), /this device:$/);
  const picked = assistantManualPicker(
    [
      { id: '76', brand: 'Zeiss', title: 'Visulas YAG III Service Manual', storage_path: 'shared/zeiss/visulas_yag_iii/manual.pdf' },
      { id: 16, brand: 'Cynosure', title: 'Elite Service Manual', storage_path: 'shared/cynosure/elite' },
    ],
    '76'
  );
  assert.equal(picked?.id, 76);
  assert.equal(picked?.brand, 'Zeiss');
  assert.match(picked?.storagePath || '', /visulas_yag_iii/);
  assert.equal(assistantManualPicker([], 76), null);
  assert.equal(edgeGeneralGuidancePrefix(candela), generalGuidancePrefix(candela));

  const hinted = generalGuidanceSystemHint(candela);
  assert.match(hinted, /general field-service knowledge/);
  assert.match(hinted, /Do not claim you read or cited this manual/);
  assert.match(hinted, /Candela CO2RE/);

  const answered = prefixGeneralGuidance(
    'Check the RF deck calibration.\n\n— Source: Candela CO2RE\n[[cite:id=17&t=CO2RE]]',
    candela
  );
  assert.equal(answered, `${prefix}\n\nCheck the RF deck calibration.`);
  assert.equal(prefixGeneralGuidance('', candela), prefix);
  assert.equal(prefixGeneralGuidance(`${prefix}\n\nAlready noted.`, candela), `${prefix}\n\nAlready noted.`);
  assert.equal(edgePrefixGeneralGuidance('Check the RF deck.', candela), prefixGeneralGuidance('Check the RF deck.', candela));

  const fn = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  const chat = fn.slice(fn.indexOf("body.action === 'chat'"));
  const indexAt = chat.indexOf('searchIndexedManualText');
  const filesAt = chat.indexOf('responses+files failed');
  const completionsAt = chat.indexOf('api.x.ai/v1/chat/completions');
  const prefixAt = chat.indexOf('prefixGeneralGuidance(');
  assert.ok(indexAt > 0 && filesAt > indexAt, 'indexed excerpts run before a whole-PDF attach');
  assert.ok(completionsAt > filesAt && prefixAt > completionsAt, 'general guidance prefixes the model answer');
  assert.match(chat, /!hasCollectionPdfs && !hasManualPassages/);
  assert.match(chat, /wholePdfAttachAllowed\(attachStats\)/);
  assert.match(chat, /if \(!skippedLargePdf\)/);
  assert.match(chat, /signStoragePdf/);
  assert.match(chat, /skip whole-pdf attach/);
  assert.match(chat, /useGeneralGuidance/);
  assert.match(chat, /!hasManualPassages && !hasFaultDBHit && !hasCollectionPdfs/);
  assert.match(chat, /generalGuidanceSystemHint\(/);
  assert.match(chat, /generalGuidance:\s*true/);
  assert.match(
    fn,
    /I couldn't search this manual's text yet, so this is general guidance for the \$\{generalGuidanceDeviceName\(opts\)\}:/
  );
  assert.match(fn, /function humanizeDeviceCode/);
  assert.match(fn, /function indexedExcerptPage/);
  assert.match(fn, /indexedExcerptPage\(full, query, labelCodes, scope\)/);
  assert.match(
    fn,
    /searchIndexedManualText\(db, manualMeta\.id, sq, manualLabel, faultCodeTokens\(manualLabel\), \{/
  );
  assert.doesNotMatch(fn, /\.select\([^\n]*page_count/);
  assert.doesNotMatch(fn, /\.select\([^\n]*xai_file_id/);
  assert.match(fn, /effectivePageCount\(undefined/);
  assert.match(fn, /answerDeclinesManualCitation/);
  assert.match(fn, /alignReplyToCitationPage/);
  assert.match(fn, /settled\.declined/);
  assert.match(fn, /ignoreCodes: faultCodeTokens\(manualLabel\)/);
  const pageFn = fn.slice(fn.indexOf('function lastPhysicalPageStamp'), fn.indexOf('function indexedExcerptSection'));
  assert.match(pageFn, /pdfpage/);
  assert.match(pageFn, /\\f/);
  assert.doesNotMatch(pageFn, /pages\?\|pg/);
  const extractFn = fn.slice(fn.indexOf('export function extractPageRef'), fn.indexOf('function hitPage'));
  assert.match(extractFn, /isPrintedPageRange/);
  assert.match(fn, /yag:\s*'YAG'/);
  const client = readFileSync(join(here, '../../app/ai-assistant/AIAssistantClient.tsx'), 'utf8');
  assert.match(client, /assistantManualPicker/);
  assert.match(client, /fetchAllPages/);
  assert.match(client, /eq\('id', urlManualId\)/);
  assert.match(client, /manualTitle/);
  assert.match(client, /manualModel/);
  const chatLookup = chat.slice(chat.indexOf('let rawId'), chat.indexOf('const nonSys'));
  assert.match(chatLookup, /\.eq\('id', rawId\)/);
  assert.doesNotMatch(chatLookup, /resolveManualFromCatalog\(manuals/);
  assert.match(chat, /selectedManualContext\(/);
  assert.match(chat, /collectionSearchRequiresManualMatch/);
  const rail = readFileSync(join(here, '../../components/ViewerAiPanel.tsx'), 'utf8');
  const viewer = readFileSync(join(here, '../../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(rail, /manualTitle: title/);
  assert.match(rail, /manualModel: model/);
  assert.match(viewer, /model=\{catalogModel\}/);
  assert.match(viewer, /brand,title,model/);
  assert.doesNotMatch(chat, /manualCorpusFallbackMessage\(/);
});

test('AI assistant thread scrolls long replies instead of clipping them', () => {
  const client = readFileSync(join(here, '../../app/ai-assistant/AIAssistantClient.tsx'), 'utf8');
  const css = readFileSync(join(here, '../../app/globals.css'), 'utf8');
  const android = readFileSync(join(here, '../../../app/src/main/assets/ai_assistant.html'), 'utf8');

  assert.match(client, /ai-chat-thread/);
  assert.match(client, /flex-1 min-h-0 overflow-y-auto/);
  assert.match(client, /listRef\.current/);
  assert.doesNotMatch(client, /className="card flex-1/);
  assert.doesNotMatch(client, /max-h-\[min\(52vh/);

  assert.match(css, /\.ai-chat-thread\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.card\s*\{[^}]*overflow:\s*hidden/s);

  assert.match(android, /\.chat-messages\s*\{[^}]*min-height:\s*0/s);
  assert.match(android, /\.chat-messages\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(android, /\.chat-panel\s*\{[^}]*min-height:\s*0/s);
  assert.match(android, /\.chat-outer\s*\{[^}]*overflow:\s*hidden/s);
});

function stampedPages(count: number, fill: (n: number) => string): string {
  const pages: string[] = [];
  for (let n = 1; n <= count; n++) pages.push(`[[pdfpage:${n}]] ${fill(n)}`);
  return pages.join('\f');
}

/** GentleMax Pro operator: title page carries the catalog date; the spec table is p.115. */
function gentleMaxOperatorSpecIndex(): string {
  return stampedPages(120, (n) => {
    let text = 'GentleMax Pro Operator Manual header.';
    if (n === 1) {
      text +=
        ' Candela GentleMAX Pro Operator Manual 8501-00-2200 Rev B June 2012. Table of Contents. Chapter 6 Troubleshooting begins later.';
    }
    if (n === 109) text += ' Chapter 6 Troubleshooting. No delivered-energy specification on this page.';
    if (n === 115) {
      text +=
        ' Maximum Delivered Energy 53 joules (J) Alexandrite; 80 J Nd:YAG. Ambient Temperature Operating: 65 F to 85 F. Relative Humidity 20% to 80%.';
    }
    return text;
  });
}

test('a long catalog title does not hide the spec table behind the title page', () => {
  const indexed = gentleMaxOperatorSpecIndex();
  const label = 'Candela GentleMax Pro Operator Manual (8501-00-2200 Rev B, June 2012)';
  const question = 'What is the maximum delivered energy for the Alexandrite and the Nd:YAG?';
  const query = `${label} ${question} procedure specification steps`;
  const scope = { label };
  assert.equal(indexedExcerptPage(indexed, query, undefined, scope), 115);
  assert.equal(edgeIndexedExcerptPage(indexed, query, undefined, scope), 115);
  const excerpt = excerptManualSearchText(indexed, query, 8000, undefined, scope);
  assert.match(excerpt, /53 joules/);
  assert.match(excerpt, /80 J Nd:YAG/);
  assert.match(edgeExcerptManualSearchText(indexed, query, 8000, undefined, scope), /53 joules/);
  const tempQuery = `${label} What is the ambient operating temperature and humidity? procedure specification steps`;
  assert.equal(indexedExcerptPage(indexed, tempQuery, undefined, scope), 115);
  assert.equal(edgeIndexedExcerptPage(indexed, tempQuery, undefined, scope), 115);
  // The date tokens that exist only on the title page win when the label fills the term budget.
  assert.equal(indexedExcerptPage(indexed, query), 1);
});

test('eyewear optical density is not lost to a long model label or the optical rail', () => {
  const indexed = stampedPages(80, (n) => {
    let text = 'Candela VBeam header.';
    if (n === 1) {
      text += ' Candela VBeam2 Perfecta Aesthetica Platinum Operator Manual 8502-00-0810 Rev C March 2011.';
    }
    if (n === 71) text += ' OPTICAL DENSITY OF AT LEAST 4.9 AT 591 - 597 NM. Single-wavelength eyewear is not enough. Page 2 of 5.';
    if (n === 74) text += ' Optical Rail alignment steps. Page 5 of 5.';
    return text;
  });
  const label = 'Candela VBeam2 (Perfecta, Aesthetica, or Platinum) Operator Manual (8502-00-0810 Rev C, March 2011)';
  const question = 'What optical density eyewear is required at 591 to 597 nm?';
  const query = `${label} ${question}`;
  const scope = { label };
  const ignore = faultCodeTokens(label);
  assert.equal(indexedExcerptPage(indexed, query, ignore, scope), 71);
  assert.equal(edgeIndexedExcerptPage(indexed, query, ignore, scope), 71);
  assert.match(excerptManualSearchText(indexed, query, 8000, ignore, scope), /OPTICAL DENSITY OF AT LEAST 4\.9/);
  // VBeam2 is a model token on the title page. Without the label ignore-list it anchors there.
  assert.equal(indexedExcerptPage(indexed, query, undefined, scope), 1);
});

test('an excerpt of a short cited page keeps the answer that sits before the anchor', () => {
  const early = 'Electrical Adjustments, Topic 3.2, verifies the Fan Speed Controller PCB and the speaker volume. ';
  const filler = 'calibration notes '.repeat(120);
  const late = 'topic verifies the speaker volume final adjustment.';
  const indexed = stampedPages(8, (n) => {
    if (n === 1) return early + filler + late;
    if (n === 8) return 'ZZLATEPAGE is past the excerpt window.';
    return `UltraPulse Encore filler page ${n}. ${'body '.repeat(200)}`;
  });
  const query = 'speaker volume topic verifies';
  const excerpt = excerptManualSearchText(indexed, query);
  assert.match(excerpt, /Fan Speed Controller PCB/);
  assert.match(edgeExcerptManualSearchText(indexed, query), /Fan Speed Controller PCB/);
  assert.ok(excerpt.indexOf('Fan Speed Controller') < excerpt.indexOf('final adjustment'));
  assert.doesNotMatch(excerpt, /ZZLATEPAGE/);
});

test('numeric fault codes cite the fault table, not a later block diagram', () => {
  const indexed = stampedPages(900, (n) => {
    if (n === 1) {
      return 'Fault 2 2.1 System H/W Test - ROM checksum failure. Turn system off for 5 seconds and retry.';
    }
    if (n === 53) return 'Fault 2 Beam Shutter Malfunction. The shutter did not open. Replace the shutter.';
    if (n === 243) return 'Platform 1 Functional Block Diagram. LASER CONTROL SECTION BLOCK DIAGRAM. 7122-00-3948.';
    if (n === 879) return 'GentleLASE Functional Block Diagram. CONTROL SYSTEM BLOCK DIAGRAM. Fault 2 see the drawing.';
    return `service manual header page ${n}.`;
  });
  const gmax = 'GentleMAX what does fault 2.1 mean';
  assert.equal(indexedExcerptPage(indexed, gmax), 1);
  assert.equal(edgeIndexedExcerptPage(indexed, gmax), 1);
  assert.equal(indexedExcerptSection(indexed, gmax), undefined);
  const glase = 'GentleLASE what does Fault 2 mean';
  assert.equal(indexedExcerptPage(indexed, glase), 53);
  assert.equal(edgeIndexedExcerptPage(indexed, glase), 53);
  const diagram = 'GentleLASE show the block diagram for fault 2';
  assert.equal(indexedExcerptPage(indexed, diagram), 879);
  assert.equal(edgeIndexedExcerptPage(indexed, diagram), 879);
});

test('fault retrieval prefers the chapter language that matches the question', () => {
  const chapters = [
    { storage_path: 'shared/candela/smoothbeam/8501-00-1620-en.pdf', title: 'SmoothBeam English', language: 'English' },
    { storage_path: 'shared/candela/smoothbeam/8501-00-1626-pt.pdf', title: 'SmoothBeam Portuguese', language: 'Portuguese' },
  ];
  const hints = chapterLanguageHints(chapters);
  assert.deepEqual(hints, edgeChapterLanguageHints(chapters));
  assert.ok(hints.some((hint) => hint.language === 'en' && hint.markers.includes('8501-00-1620')));
  assert.ok(hints.some((hint) => hint.language === 'pt' && hint.markers.includes('8501-00-1626')));
  const indexed = stampedPages(880, (n) => {
    if (n === 69) {
      return 'SmoothBeam 8501-00-1620 Rev D Fault 7 TEC Temperature Fault. Check the rear cooling fans.';
    }
    if (n === 871) {
      return 'SmoothBeam 8501-00-1626 Rev D Fault 7 TEC Temperature Fault. Check the rear cooling fans. Falha 7. Qual deve verificar os ventiladores. A falha não deve continuar.';
    }
    return `SmoothBeam header ${n}.`;
  });
  const question = 'SmoothBeam Fault 7 TEC temperature rear cooling fans';
  const english = { label: 'Candela SmoothBeam', language: { prefer: preferredExcerptLanguage({ question, replyLanguage: 'en' }), hints } };
  assert.equal(preferredExcerptLanguage({ question, replyLanguage: 'en' }), 'en');
  assert.equal(edgePreferredExcerptLanguage({ question, replyLanguage: 'en' }), 'en');
  assert.equal(indexedExcerptPage(indexed, question, undefined, english), 69);
  assert.equal(edgeIndexedExcerptPage(indexed, question, undefined, english), 69);
  const portugueseQuestion = 'Qual é a falha 7 TEC e o que deve verificar';
  assert.equal(preferredExcerptLanguage({ question: portugueseQuestion }), 'pt');
  const portuguese = {
    language: { prefer: preferredExcerptLanguage({ question: portugueseQuestion, replyLanguage: 'en' }), hints },
  };
  assert.equal(indexedExcerptPage(indexed, portugueseQuestion, undefined, portuguese), 871);
  assert.equal(edgeIndexedExcerptPage(indexed, portugueseQuestion, undefined, portuguese), 871);
  const locale = {
    language: { prefer: preferredExcerptLanguage({ question, replyLanguage: 'pt-BR' }), hints },
  };
  assert.equal(preferredExcerptLanguage({ question, replyLanguage: 'pt-BR' }), 'pt');
  assert.equal(indexedExcerptPage(indexed, question, undefined, locale), 871);
});

test('section labels are real headings on the cited page', () => {
  const preventative =
    '[[pdfpage:63]] 13 Preventative Maintenance Procedure. Clean the DI water path. ' +
    '• Chapter 26, DI Water Temperature Calibration Procedure. • Chapter 25, Rail Check. See Chapter 21.';
  const anchor63 = preventative.indexOf('DI water');
  assert.equal(sectionHeadingOnPage(preventative, anchor63), '13');
  assert.equal(edgeSectionHeadingOnPage(preventative, anchor63), '13');

  const errors = '[[pdfpage:75]] 5.5.4 Error Codes and Descriptions. Error 221 water temperature greater than 65c.';
  const anchor75 = errors.indexOf('221');
  assert.equal(sectionHeadingOnPage(errors, anchor75), '5.5.4');
  assert.equal(indexedExcerptSection(errors, 'error 221 water temperature'), '5.5.4');
  assert.equal(edgeIndexedExcerptSection(errors, 'error 221 water temperature'), '5.5.4');

  const specs =
    '[[pdfpage:24]] 2.3 CUSTOMER DEMONSTRATION walk the controls. ' +
    '2.4 PRODUCT SPECIFICATIONS. Electrical 100-120 or 208-240 VAC, 15-20 A.';
  const anchor24 = specs.indexOf('Electrical');
  assert.equal(sectionHeadingOnPage(specs, anchor24), '2.4');
  assert.equal(edgeSectionHeadingOnPage(specs, anchor24), '2.4');

  const hz = '[[pdfpage:22]] Table 1-1 Specifications. Up to 10 Hz. (Up to 2 Hz for LE systems). Page 22.';
  assert.equal(sectionHeadingOnPage(hz, hz.indexOf('Hz for')), undefined);
  assert.equal(indexedExcerptSection(hz, '2 Hz for LE systems'), undefined);

  const list = '[[pdfpage:66]] 6) Specific faults occur only after cleaning the window or replacing the delivery system.';
  assert.equal(sectionHeadingOnPage(list, list.indexOf('cleaning')), undefined);

  const part = '[[pdfpage:243]] LASER CONTROL SECTION BLOCK DIAGRAM sheet 7122-00-3948.';
  assert.equal(sectionHeadingOnPage(part, part.indexOf('7122')), undefined);

  const alignment = '[[pdfpage:40]] RF deck calibration for the handpiece. Section 8.4 alignment.';
  assert.equal(indexedExcerptSection(alignment, 'RF deck calibration'), '8.4');
});
