import assert from 'node:assert/strict';
import test from 'node:test';
import {
  immediateDisplayUrl,
  nextPhotoSrc,
  parseStoredStorageUrl,
  partImageThumbnailUrl,
  PHOTO_PLACEHOLDER,
  resolveStoredImageUrls,
  serviceRoleSignable,
  signedThumbnailUrl,
} from './storage-display.ts';

const LISTING =
  'https://db.example/storage/v1/object/public/equipment-photos/0d04a116-38a8-4ba0-8738-7981e398f551/listings/1787347953497_0.jpg';
const PART =
  'https://db.example/storage/v1/object/public/equipment-photos/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp';
const HUGE =
  'https://db.example/storage/v1/object/public/equipment-photos/679eb571-d6b9-44d4-8506-7dff6300eb7d/listings/1788734903483_0.png';

test('stored public equipment-photos URLs parse to bucket and path', () => {
  assert.deepEqual(parseStoredStorageUrl(LISTING), {
    bucket: 'equipment-photos',
    path: '0d04a116-38a8-4ba0-8738-7981e398f551/listings/1787347953497_0.jpg',
    origin: 'https://db.example',
  });
  assert.deepEqual(parseStoredStorageUrl(`${PART}?token=1`), {
    bucket: 'equipment-photos',
    path: 'parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp',
    origin: 'https://db.example',
  });
  assert.equal(serviceRoleSignable('equipment-photos', '0d04a116-38a8-4ba0-8738-7981e398f551/listings/1787347953497_0.jpg'), true);
  assert.equal(serviceRoleSignable('equipment-photos', 'parts/abc/photo.webp'), true);
  assert.equal(serviceRoleSignable('equipment-photos', 'equipment/22/laser.jpg'), false);
  assert.equal(serviceRoleSignable('marketplace-images', 'user/listings/a.png'), true);
  assert.equal(serviceRoleSignable('part-images', 'thumb.webp'), false);
  assert.equal(serviceRoleSignable('logos', 'org/logo.png'), false);
});

test('part-images thumbnails are width-limited public renders; logos stay public object URLs', () => {
  const part = 'https://db.example/storage/v1/object/public/part-images/catalog/lamp.jpg';
  const logo = 'https://db.example/storage/v1/object/public/logos/9/logo.png';
  assert.equal(
    partImageThumbnailUrl(part, 480),
    'https://db.example/storage/v1/render/image/public/part-images/catalog/lamp.jpg?width=480&resize=contain'
  );
  assert.equal(partImageThumbnailUrl(logo, 480), null);
  assert.deepEqual(immediateDisplayUrl(part, 320), {
    src: 'https://db.example/storage/v1/render/image/public/part-images/catalog/lamp.jpg?width=320&resize=contain',
    sign: false,
  });
  assert.deepEqual(immediateDisplayUrl(logo, 320), { src: logo, sign: false });
  assert.deepEqual(immediateDisplayUrl(LISTING, 480), { src: null, sign: true });
  const again = partImageThumbnailUrl(part, 480);
  assert.equal(again, partImageThumbnailUrl(part, 480));
});

test('batched signed URLs request a width-limited render and can fall back to the object', () => {
  const signed = 'https://db.example/storage/v1/object/sign/equipment-photos/679eb571-d6b9-44d4-8506-7dff6300eb7d/listings/1788734903483_0.png?token=abc';
  const thumb = signedThumbnailUrl(signed, 480);
  const url = new URL(thumb);
  assert.equal(url.pathname, '/storage/v1/render/image/sign/equipment-photos/679eb571-d6b9-44d4-8506-7dff6300eb7d/listings/1788734903483_0.png');
  assert.equal(url.searchParams.get('token'), 'abc');
  assert.equal(url.searchParams.get('width'), '480');
  assert.equal(url.searchParams.get('resize'), 'contain');
  const full = nextPhotoSrc(thumb, false);
  assert.match(full, /\/object\/sign\//);
  assert.equal(new URL(full).searchParams.get('width'), null);
  assert.equal(nextPhotoSrc(full, true), PHOTO_PLACEHOLDER);
});

test('private URLs are signed once per path and a second resolve reuses the cache', async () => {
  const calls: Array<{ bucket: string; paths: string[]; width: number }> = [];
  const cache = new Map();
  const sign = async (bucket: string, paths: string[], width: number) => {
    calls.push({ bucket, paths: [...paths], width });
    return Object.fromEntries(paths.map((path) => [path, `https://signed.example/${bucket}/${path}?w=${width}`]));
  };
  const first = await resolveStoredImageUrls([LISTING, HUGE, PART, LISTING], { width: 480, sign, cache, now: 1_000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bucket, 'equipment-photos');
  assert.deepEqual(calls[0].paths.sort(), [
    '0d04a116-38a8-4ba0-8738-7981e398f551/listings/1787347953497_0.jpg',
    '679eb571-d6b9-44d4-8506-7dff6300eb7d/listings/1788734903483_0.png',
    'parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp',
  ].sort());
  assert.equal(first[0], first[3]);
  assert.match(String(first[1]), /1788734903483_0\.png\?w=480/);

  const second = await resolveStoredImageUrls([LISTING, HUGE], { width: 480, sign, cache, now: 2_000 });
  assert.equal(calls.length, 1);
  assert.equal(second[0], first[0]);
});
