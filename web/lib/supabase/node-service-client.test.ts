import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createNodeServiceClient } from './node-service-client.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const URL = 'https://example.supabase.co';

/** Run fn as if on Node 20: no global WebSocket. */
function withoutGlobalWebSocket<T>(fn: () => T): T {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  delete (globalThis as { WebSocket?: unknown }).WebSocket;
  try {
    return fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, 'WebSocket', desc);
  }
}

test('plain createClient throws without a global WebSocket (Node 20), so the guard below is real', () => {
  assert.throws(() => withoutGlobalWebSocket(() => createClient(URL, 'k')), /WebSocket/);
});

test('createNodeServiceClient builds without a global WebSocket (Node 20)', () => {
  const client = withoutGlobalWebSocket(() => createNodeServiceClient(URL, 'k'));
  assert.equal(typeof client.rpc, 'function');
});

test('every Netlify function and the service scripts build clients through createNodeServiceClient', () => {
  const functions = readdirSync(join(web, 'netlify/functions'))
    .filter((name) => /\.(mts|ts|mjs|js)$/.test(name))
    .map((name) => `netlify/functions/${name}`);
  assert.ok(functions.includes('netlify/functions/manual-index-catchup.mts'));
  assert.ok(functions.includes('netlify/functions/past-due-downgrade.mts'));
  for (const rel of [
    ...functions,
    'scripts/index-missing-manuals.mjs',
    'scripts/reindex-long-manuals.mjs',
  ]) {
    const src = readFileSync(join(web, rel), 'utf8');
    assert.match(src, /createNodeServiceClient\(/, rel);
    assert.doesNotMatch(src, /\bcreateClient\(/, rel);
  }
});
