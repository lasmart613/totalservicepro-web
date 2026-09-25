import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import {
  asManualId,
  assistantManualPicker,
  buildGrokChatPayload,
  humanizeDeviceCode,
  humanizeGeneralGuidanceDisplay,
  excerptManualSearchText,
  indexedExcerptPage,
  indexedExcerptSection,
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
  const printed = 'Error 43 is described on pages 7-8 of the CO2RE handpiece chapter.';
  assert.equal(indexedExcerptPage(printed, 'handpiece'), undefined);
  const physical = `${'earlier page '.repeat(10)}\f`.repeat(149) + 'pages 7-8 RF deck calibration target';
  assert.equal(indexedExcerptPage(physical, 'RF deck calibration'), 150);
  const stamped = 'pages 7-8 intro\f[[pdfpage:150]] error 43 RF deck calibration';
  assert.equal(indexedExcerptPage(stamped, 'RF deck calibration'), 150);
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
  assert.match(fn, /indexedExcerptPage\(full, query\)/);
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
