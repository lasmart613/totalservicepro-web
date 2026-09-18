import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import {
  asManualId,
  buildGrokChatPayload,
  excerptManualSearchText,
  manualPathsAlign,
  normalizeManualPath,
  manualPathKey,
  folderPrefixForAiAttach,
  hasAttachablePdfHint,
  pdfPathsForAiAttach,
  resolveManualFromCatalog,
} from './manual-scope.ts';
import {
  folderPrefixForAiAttach as edgeFolderPrefixForAiAttach,
  manualPathKey as edgeManualPathKey,
  normalizeManualPath as edgeNormalizeManualPath,
  pdfPathsForAiAttach as edgePdfPathsForAiAttach,
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
  assert.match(fn, /pdfPathsForAiAttach\(manualMeta\)/);
  assert.match(fn, /collection_ids:\s*\[TSP_COLLECTION_ID\]/);
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
