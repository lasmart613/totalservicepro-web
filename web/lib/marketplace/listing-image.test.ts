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

test('list and edit uploads set contentType from detected bytes, not the filename', () => {
  const list = readFileSync(new URL('../../app/marketplace/list/page.tsx', import.meta.url), 'utf8');
  const edit = readFileSync(new URL('../../app/marketplace/parts/[id]/edit/page.tsx', import.meta.url), 'utf8');
  for (const src of [list, edit]) {
    assert.match(src, /inspectListingImage\(/);
    assert.match(src, /contentType: inspected\.contentType/);
    assert.match(src, /inspected\.extension/);
    assert.match(src, /LISTING_IMAGE_ACCEPT/);
    assert.doesNotMatch(src, /contentType:\s*file\.type/);
    assert.doesNotMatch(src, /startsWith\(['"]image\//);
    assert.doesNotMatch(src, /file\.name\.split\(/);
  }
});

test('000968 limits marketplace-images to png, jpeg, and webp and is not applied here', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261122_000968_marketplace_images_mime.sql', import.meta.url),
    'utf8'
  );
  const rollback = readFileSync(
    new URL('../../supabase/migrations/20261122_000968_marketplace_images_mime_rollback.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.match(sql, /WHERE id = 'marketplace-images'/);
  assert.match(sql, /allowed_mime_types = ARRAY\['image\/png', 'image\/jpeg', 'image\/webp'\]::text\[\]/);
  assert.match(sql, /file_size_limit = 5242880/);
  assert.equal(5242880, LISTING_IMAGE_MAX_BYTES);
  assert.doesNotMatch(sql, /INSERT INTO storage\.buckets/i);
  assert.doesNotMatch(sql, /id = 'logos'/);
  assert.doesNotMatch(sql, /\b(4|153|154|1005|2616|5509|5515|5516|5517)\b/);
  const firstSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .split(';')[0]
    .trim();
  assert.equal(firstSql, "SET LOCAL lock_timeout = '5s'");
  assert.match(rollback, /allowed_mime_types = NULL/);
  assert.match(rollback, /file_size_limit = NULL/);
  assert.match(rollback, /WHERE id = 'marketplace-images'/);
  assert.doesNotMatch(rollback, /logos/);
});
