import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGN_CONCURRENCY, THUMB_QUALITY, signImagePaths } from './signed-image-urls.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('thumbnail signing receives transform and full-size does not', async () => {
  const calls: Array<{ path: string; ttl: number; options?: unknown }> = [];
  const signer = {
    createSignedUrl: async (path: string, ttl: number, options?: unknown) => {
      calls.push({ path, ttl, options });
      return { data: { signedUrl: `https://signed.example/${path}?n=${calls.length}` }, error: null };
    },
  };
  const cache = new Map();
  const thumb = await signImagePaths(signer, 'equipment-photos', ['listings/a.jpg', 'listings/a.jpg'], 160, {
    cache,
    now: 1_000,
    concurrency: 2,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'listings/a.jpg');
  assert.equal(calls[0].ttl, 3600);
  assert.deepEqual(calls[0].options, {
    transform: { width: 160, quality: THUMB_QUALITY, resize: 'contain' },
  });
  assert.match(thumb['listings/a.jpg'], /listings\/a\.jpg/);

  const again = await signImagePaths(signer, 'equipment-photos', ['listings/a.jpg'], 160, {
    cache,
    now: 2_000,
  });
  assert.equal(calls.length, 1);
  assert.equal(again['listings/a.jpg'], thumb['listings/a.jpg']);

  const full = await signImagePaths(signer, 'equipment-photos', ['listings/a.jpg'], null, {
    cache,
    now: 2_000,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options, undefined);
  assert.notEqual(full['listings/a.jpg'], thumb['listings/a.jpg']);
});

test('list signing stays within the concurrency limit', async () => {
  let active = 0;
  let max = 0;
  const signer = {
    createSignedUrl: async (path: string) => {
      active += 1;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
    },
  };
  const paths = Array.from({ length: 8 }, (_, i) => `listings/${i}.jpg`);
  const signed = await signImagePaths(signer, 'equipment-photos', paths, 960, {
    cache: new Map(),
    concurrency: 2,
  });
  assert.equal(Object.keys(signed).length, 8);
  assert.ok(max <= 2, `max in flight ${max}`);
  assert.ok(max <= SIGN_CONCURRENCY);
});

test('signed URL route signs with transform instead of rewriting the object URL', () => {
  const route = readFileSync(join(here, '../app/api/storage/signed-urls/route.ts'), 'utf8');
  const lasers = readFileSync(join(here, '../lib/org-scoped-read.ts'), 'utf8');
  assert.match(route, /signImagePaths/);
  assert.doesNotMatch(route, /createSignedUrls/);
  assert.doesNotMatch(route, /signedThumbnailUrl/);
  assert.match(lasers, /signImagePaths/);
  assert.doesNotMatch(lasers, /createSignedUrls/);
  assert.doesNotMatch(lasers, /signedThumbnailUrl/);
});
