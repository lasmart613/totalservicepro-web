import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LISTING_IMAGE_MAX_BYTES,
  LISTING_IMAGE_REJECTED,
  LISTING_IMAGE_TOO_LARGE,
  detectListingImage,
  inspectListingImage,
} from './listing-image.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const text = (value: string) => new TextEncoder().encode(value);
const SVG = text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const GIF = text('GIF89a\x01\x00\x01\x00');
const HTML = text('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>');

test('listing image detection accepts png, jpeg, and webp from magic bytes', () => {
  assert.deepEqual(detectListingImage(PNG), { contentType: 'image/png', extension: 'png' });
  assert.deepEqual(detectListingImage(JPEG), { contentType: 'image/jpeg', extension: 'jpg' });
  assert.deepEqual(detectListingImage(WEBP), { contentType: 'image/webp', extension: 'webp' });
});

test('listing image detection rejects svg, svg renamed as png, gif, and html', async () => {
  assert.equal(detectListingImage(SVG), null);
  assert.equal(detectListingImage(GIF), null);
  assert.equal(detectListingImage(HTML), null);
  assert.equal(detectListingImage(Uint8Array.from([0xff, 0xd8])), null);
  assert.equal(detectListingImage(new Uint8Array()), null);

  const renamed = new File([SVG], 'photo.png', { type: 'image/png' });
  const spoofed = await inspectListingImage(renamed);
  assert.deepEqual(spoofed, { ok: false, error: LISTING_IMAGE_REJECTED });

  const svgType = await inspectListingImage(new File([SVG], 'photo.svg', { type: 'image/svg+xml' }));
  assert.equal(svgType.ok, false);
  const gif = await inspectListingImage(new File([GIF], 'anim.gif', { type: 'image/gif' }));
  assert.equal(gif.ok, false);
  const html = await inspectListingImage(new File([HTML], 'page.html', { type: 'text/html' }));
  assert.equal(html.ok, false);
  if (!html.ok) assert.match(html.error, /PNG, JPEG, or WebP/);
});

test('a png named .svg with an svg browser type is still png', async () => {
  const file = new File([PNG], 'photo.svg', { type: 'image/svg+xml' });
  const inspected = await inspectListingImage(file);
  assert.deepEqual(inspected, { ok: true, contentType: 'image/png', extension: 'png' });
  const jpeg = await inspectListingImage(new File([JPEG], 'x.bin', { type: '' }));
  assert.deepEqual(jpeg, { ok: true, contentType: 'image/jpeg', extension: 'jpg' });
  const webp = await inspectListingImage(new File([WEBP], 'x.bin', { type: 'application/octet-stream' }));
  assert.deepEqual(webp, { ok: true, contentType: 'image/webp', extension: 'webp' });
});

test('listing photos over 5 MB are rejected before the bucket sees them', async () => {
  assert.equal(LISTING_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
  const big = new File([PNG], 'big.png', { type: 'image/png' });
  Object.defineProperty(big, 'size', { value: LISTING_IMAGE_MAX_BYTES + 1 });
  const inspected = await inspectListingImage(big);
  assert.deepEqual(inspected, { ok: false, error: LISTING_IMAGE_TOO_LARGE });
});

test('list and edit uploads set contentType from detected bytes and only use marketplace-images', () => {
  const list = readFileSync(new URL('../../app/marketplace/list/page.tsx', import.meta.url), 'utf8');
  const edit = readFileSync(new URL('../../app/marketplace/parts/[id]/edit/page.tsx', import.meta.url), 'utf8');
  for (const src of [list, edit]) {
    assert.match(src, /inspectListingImage\(/);
    assert.match(src, /contentType: inspected\.contentType/);
    assert.match(src, /inspected\.extension/);
    assert.match(src, /LISTING_IMAGE_ACCEPT/);
    assert.match(src, /LISTING_IMAGE_UPLOAD_FAILED/);
    assert.doesNotMatch(src, /contentType:\s*file\.type/);
    assert.doesNotMatch(src, /startsWith\(['"]image\//);
    assert.doesNotMatch(src, /file\.name\.split\(/);
    assert.doesNotMatch(src, /equipment-photos/);
  }
  const listUpload = list.slice(list.indexOf('const uploadImages'), list.indexOf('async function rememberManufacturer'));
  const editUpload = edit.slice(edit.indexOf('const uploadNewImages'), edit.indexOf('const orderedImages'));
  for (const src of [listUpload, editUpload]) {
    assert.match(src, /storage\.from\('marketplace-images'\)/);
    assert.match(src, /toast\.error\(LISTING_IMAGE_UPLOAD_FAILED\)/);
    assert.doesNotMatch(src, /console\.warn/);
    assert.doesNotMatch(src, /equipment/);
  }
  assert.match(edit, /listingPhotoLimit\(/);
  assert.match(edit, /setPhotoLimit\(listingPhotoLimit\(org\)\)/);
  assert.doesNotMatch(edit, /8 - existingImages|allPreviews\.length < 8|Up to 8 photos/);
});

test('000968 accepts the production jpeg list, NULL, or the target, and rollback does not widen the bucket', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261122_000968_marketplace_images_mime.sql', import.meta.url),
    'utf8'
  );
  const rollback = readFileSync(
    new URL('../../supabase/migrations/20261122_000968_marketplace_images_mime_rollback.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /private bucket/i);
  assert.doesNotMatch(sql, /public marketplace-images bucket/i);
  assert.match(sql, /to_regclass\('storage\.buckets'\) IS NULL/);
  assert.match(sql, /row marketplace-images does not exist/);
  assert.match(sql, /ARRAY\['image\/jpeg', 'image\/jpg'\]::text\[\]/);
  assert.match(sql, /ARRAY\['image\/png', 'image\/jpeg', 'image\/webp'\]::text\[\]/);
  assert.match(sql, /file_size_limit = 5242880/);
  assert.equal(5242880, LISTING_IMAGE_MAX_BYTES);
  assert.doesNotMatch(sql, /SET public/i);
  assert.doesNotMatch(sql, /INSERT INTO storage\.buckets/i);
  const firstSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .split(';')[0]
    .trim();
  assert.equal(firstSql, "SET LOCAL lock_timeout = '5s'");
  assert.match(rollback, /ARRAY\['image\/jpeg', 'image\/jpg'\]::text\[\]/);
  assert.match(rollback, /file_size_limit = NULL/);
  assert.doesNotMatch(rollback, /allowed_mime_types = NULL/);
  assert.doesNotMatch(rollback, /SET public/i);
});

test('000970 changes only the foldername index from 0 to 1', () => {
  const original = readFileSync(
    new URL('../../supabase/migrations/20260620_000000_marketplace_tables_and_rls.sql', import.meta.url),
    'utf8'
  );
  const forward = readFileSync(
    new URL('../../supabase/migrations/20261122_000970_marketplace_images_policy_index.sql', import.meta.url),
    'utf8'
  );
  const rollback = readFileSync(
    new URL('../../supabase/migrations/20261122_000970_marketplace_images_policy_index_rollback.sql', import.meta.url),
    'utf8'
  );
  const expr = /bucket_id = 'marketplace-images' \s*AND \(storage\.foldername\(name\)\)\[(\d)\] = auth\.uid\(\)::text/g;
  const indexes = (sql: string) => [...sql.matchAll(expr)].map((match) => match[1]);
  const normalized = (sql: string) =>
    [...sql.matchAll(expr)].map((match) => match[0].replace(/\[\d\]/, '[N]').replace(/\s+/g, ' '));
  assert.deepEqual(indexes(original), ['0', '0', '0']);
  assert.deepEqual(indexes(forward), ['1', '1', '1']);
  assert.deepEqual(indexes(rollback), ['0', '0', '0']);
  assert.deepEqual(normalized(forward), normalized(original));
  assert.deepEqual(normalized(rollback), normalized(original));
  for (const name of [
    'Authenticated users can upload listing images',
    'Users can update own listing images',
    'Users can delete own listing images',
  ]) {
    assert.equal((forward.match(new RegExp(`CREATE POLICY "${name}"`, 'g')) || []).length, 1);
    assert.equal((rollback.match(new RegExp(`CREATE POLICY "${name}"`, 'g')) || []).length, 1);
  }
  assert.doesNotMatch(forward, /DROP POLICY IF EXISTS "Public can view listing images"/);
  assert.match(forward, /NOT APPLIED/);
});
