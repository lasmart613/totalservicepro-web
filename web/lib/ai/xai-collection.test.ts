import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import {
  collectionDocumentNamesMatch,
  grokAssistantUrl,
  manualsNeedingXaiAttach,
  MANUAL_XAI_ATTACH_BATCH,
  needsXaiCollectionStamp,
  sanitizeCollectionFilename,
  TSP_XAI_COLLECTION_ID,
  xaiKeysFromEnv,
} from './xai-collection.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('shared TSP collection id matches live grok-assistant', () => {
  assert.equal(TSP_XAI_COLLECTION_ID, 'collection_4d71cef6-a546-4b8c-9e08-f9c4e77a0c5e');
  assert.equal(
    grokAssistantUrl('https://yljztfajyvjzqikxdddf.supabase.co'),
    'https://yljztfajyvjzqikxdddf.supabase.co/functions/v1/grok-assistant'
  );
  assert.equal(xaiKeysFromEnv({}).apiKey, null);
  assert.equal(xaiKeysFromEnv({ XAI_API_KEY: 'sk' }).managementKey, 'sk');
});

test('xai_collection_id is only stamped by the God attach path (single + bulk)', () => {
  const fn = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  const upload = readFileSync(join(here, '../../../supabase/functions/grok-assistant/xai-collection.ts'), 'utf8');
  const reindex = readFileSync(join(here, '../../app/api/god/manuals/reindex/route.ts'), 'utf8');
  const godPage = readFileSync(join(here, '../../app/admin/god/manuals/page.tsx'), 'utf8');
  const insert = readFileSync(join(here, '../../app/api/god/manuals/route.ts'), 'utf8');
  const types = readFileSync(join(here, '../../src/types/supabase.ts'), 'utf8');

  assert.match(fn, /action === 'attach-collection'/);
  assert.match(fn, /xai_collection_id/);
  assert.match(fn, /listFolderPdfs|folderPrefixForAiAttach/);
  assert.match(fn, /collection_ids:\s*\[TSP_COLLECTION_ID\]/);
  assert.match(fn, /pdfPathsForAiAttach\(manualMeta\)/);
  assert.match(fn, /list\.length === 1/);
  assert.match(fn, /!picks\.length && chapterList\.length/);
  assert.match(upload, /already_present|collectionHasDocumentName/);
  assert.match(reindex, /attachCollection/);
  assert.match(reindex, /manualsNeedingXaiAttach/);
  assert.match(reindex, /afterId/);
  assert.match(godPage, /Attach to Grok collection/);
  assert.match(godPage, /Attach missing Grok collections/);
  assert.doesNotMatch(insert, /xai_collection_id/);
  assert.match(types, /xai_collection_id/);
  assert.equal(MANUAL_XAI_ATTACH_BATCH, 1);
});

test('bulk attach queue is every unstamped file/folder with a PDF hint, not only 721', () => {
  const eliteSm = {
    id: 16,
    xai_collection_id: TSP_XAI_COLLECTION_ID,
    storage_path: 'shared/cynosure/elite',
    is_folder: true,
  };
  const eliteMpx = {
    id: 721,
    xai_collection_id: null,
    storage_path: 'shared/cynosure/elite_mpx/cynosure_elite_mpx_opman.pdf',
  };
  const folderUnstamped = {
    id: 5,
    xai_collection_id: '',
    storage_path: 'shared/candela/mgl',
    is_folder: true,
  };
  const noPdf = { id: 9, xai_collection_id: null, storage_path: '' };
  const already = { id: 40, xai_collection_id: TSP_XAI_COLLECTION_ID, storage_path: 'shared/a.pdf' };

  assert.equal(needsXaiCollectionStamp(eliteMpx), true);
  assert.equal(needsXaiCollectionStamp(eliteSm), false);

  const queue = manualsNeedingXaiAttach([eliteSm, eliteMpx, folderUnstamped, noPdf, already]);
  assert.deepEqual(
    queue.map((m) => m.id),
    [5, 721]
  );
  assert.deepEqual(
    manualsNeedingXaiAttach([eliteSm, eliteMpx, folderUnstamped], { afterId: 5 }).map((m) => m.id),
    [721]
  );
  assert.deepEqual(
    manualsNeedingXaiAttach([eliteSm, eliteMpx, folderUnstamped], { targetId: 721 }).map((m) => m.id),
    [721]
  );
});

test('collection ingest skips already-present document names', () => {
  assert.equal(sanitizeCollectionFilename('cynosure elite mpx opman.pdf'), 'cynosure_elite_mpx_opman.pdf');
  assert.equal(
    collectionDocumentNamesMatch('cynosure_elite_mpx_opman.pdf', 'cynosure elite mpx opman.pdf'),
    true
  );
  assert.equal(collectionDocumentNamesMatch('elite_sm.pdf', 'elite_mpx_opman.pdf'), false);
});
