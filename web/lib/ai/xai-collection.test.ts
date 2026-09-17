import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import { grokAssistantUrl, TSP_XAI_COLLECTION_ID, xaiKeysFromEnv } from './xai-collection.ts';

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

test('xai_collection_id is only stamped by the new God attach path', () => {
  const fn = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  const reindex = readFileSync(join(here, '../../app/api/god/manuals/reindex/route.ts'), 'utf8');
  const godPage = readFileSync(join(here, '../../app/admin/god/manuals/page.tsx'), 'utf8');
  const insert = readFileSync(join(here, '../../app/api/god/manuals/route.ts'), 'utf8');
  const types = readFileSync(join(here, '../../src/types/supabase.ts'), 'utf8');

  assert.match(fn, /action === 'attach-collection'/);
  assert.match(fn, /xai_collection_id/);
  assert.match(reindex, /attachCollection/);
  assert.match(godPage, /Attach to Grok collection/);
  assert.doesNotMatch(insert, /xai_collection_id/);
  assert.match(types, /xai_collection_id/);
});
