import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listingImages } from './parts.ts';
import { isPublicListingObject, publicListingObjectKeys } from '../public-listing-sign.ts';
import { immediateDisplayUrl, parseStoredStorageUrl, serviceRoleSignable } from '../storage-display.ts';
import {
  LISTING_IMAGE_BUCKET,
  LISTING_PHOTO_MAX_BYTES,
  acceptListingPhotoFiles,
  blockListingSaveForPhotoFailure,
  classifyListingPhoto,
  uploadListingPhotos,
  type ListingPhotoBlob,
  type ListingPhotoStorage,
  type ListingPhotoUploadResult,
} from './listing-photos.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const HERE = dirname(fileURLToPath(import.meta.url));

function photo(name: string, type: string, bytes = 32): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/**
 * Postgres storage.foldername() is 1-based. Live read 2026-11-08:
 * index 0 is NULL and index 1 is the owner folder. A write policy that
 * compares [0] to auth.uid() denies every upload.
 */
function folderAt(path: string, index: 0 | 1): string | null {
  const folders = path.split('/').slice(0, -1);
  if (index === 0) return null;
  return folders[index - 1] ?? null;
}

function memoryStorage(opts?: {
  fail?: (path: string, contentType: string) => string | null;
  transientOnce?: boolean;
  publicUrl?: (path: string) => string;
}): ListingPhotoStorage & { objects: Map<string, { type: string; size: number }>; calls: string[] } {
  const objects = new Map<string, { type: string; size: number }>();
  const calls: string[] = [];
  let transientLeft = opts?.transientOnce ? 1 : 0;
  return {
    objects,
    calls,
    async upload(path, body, options) {
      calls.push(`${path} ${options.contentType}`);
      if (transientLeft > 0) {
        transientLeft -= 1;
        return { error: { message: 'TypeError: Failed to fetch' } };
      }
      const deny = opts?.fail?.(path, options.contentType) || null;
      if (deny) return { error: { message: deny } };
      objects.set(path, { type: options.contentType, size: body.size });
      return { error: null };
    },
    publicUrl(path) {
      if (opts?.publicUrl) return opts.publicUrl(path);
      return `https://db.example/storage/v1/object/public/${LISTING_IMAGE_BUCKET}/${path}`;
    },
  };
}

function livePolicyDeny(owner: string) {
  return (path: string) => {
    const allowed = folderAt(path, 0) === owner;
    return allowed ? null : 'new row violates row-level security policy';
  };
}

async function saveListing(
  storage: ListingPhotoStorage,
  files: ListingPhotoBlob[],
  table: Array<{ images: string[]; photos: string[] }>
): Promise<{ saved: boolean; error: string | null; uploaded: ListingPhotoUploadResult }> {
  const uploaded = await uploadListingPhotos(storage, {
    userId: USER,
    files,
    now: 1794169676797,
    action: 'published',
  });
  const blocked = blockListingSaveForPhotoFailure(files.length, uploaded);
  if (blocked || !uploaded.ok) return { saved: false, error: blocked, uploaded };
  table.push({ images: uploaded.urls, photos: uploaded.urls });
  return { saved: true, error: null, uploaded };
}

test('folder index 0 denies the owner and index 1 allows only that folder', () => {
  const path = `${USER}/listings/1794169676797_0.jpg`;
  assert.equal(folderAt(path, 0), null);
  assert.equal(folderAt(path, 1), USER);
  assert.equal(folderAt(path, 0) === USER, false);
  assert.equal(folderAt(path, 1) === USER, true);
  assert.equal(folderAt(`someone-else/listings/a.jpg`, 1) === USER, false);
});

test('live RLS wording blocks the listing save and stores nothing', async () => {
  const storage = memoryStorage({ fail: livePolicyDeny(USER) });
  const table: Array<{ images: string[]; photos: string[] }> = [];
  const saved = await saveListing(storage, [photo('rod.jpg', 'image/jpeg')], table);
  assert.equal(saved.saved, false);
  assert.match(saved.error || '', /not published/);
  assert.match(saved.error || '', /Storage refused this photo/);
  assert.equal(table.length, 0);
  assert.equal(storage.objects.size, 0);
  assert.equal(storage.calls.length, 1);
});

test('jpeg, png, and webp persist and are signed after the listing is reloaded', async () => {
  const storage = memoryStorage();
  const files = [
    photo('cover.jpg', 'image/jpeg', 80),
    photo('side.png', 'image/png', 40),
    photo('detail.webp', 'image/webp', 50),
  ];
  const table: Array<{ images: string[]; photos: string[]; status: string; seller_id: string; created_by: string }> = [];
  const uploaded = await uploadListingPhotos(storage, { userId: USER, files, now: 1794169676797, action: 'published' });
  assert.equal(blockListingSaveForPhotoFailure(files.length, uploaded), null);
  assert.equal(uploaded.ok, true);
  if (!uploaded.ok) return;
  table.push({
    images: uploaded.urls,
    photos: uploaded.urls,
    status: 'active',
    seller_id: USER,
    created_by: USER,
  });

  assert.deepEqual(
    [...storage.objects.values()].map((object) => object.type),
    ['image/jpeg', 'image/png', 'image/webp']
  );
  assert.deepEqual(uploaded.paths, [
    `${USER}/listings/1794169676797_0.jpg`,
    `${USER}/listings/1794169676797_1.png`,
    `${USER}/listings/1794169676797_2.webp`,
  ]);

  const row = table[0];
  assert.deepEqual(listingImages(row), uploaded.urls);
  const keys = publicListingObjectKeys([row]);
  for (const url of listingImages(row)) {
    const display = immediateDisplayUrl(url, 160);
    assert.equal(display.sign, true);
    assert.equal(display.src, null);
    const parsed = parseStoredStorageUrl(url);
    assert.ok(parsed);
    assert.equal(parsed?.bucket, LISTING_IMAGE_BUCKET);
    assert.equal(serviceRoleSignable(parsed!.bucket, parsed!.path), true);
    assert.equal(isPublicListingObject(keys, parsed!.bucket, parsed!.path), true);
  }
});

test('a webp mime rejection does not publish a partial listing, and a retry does', async () => {
  let rejectWebp = true;
  const storage = memoryStorage({
    fail: (_path, contentType) =>
      rejectWebp && contentType === 'image/webp' ? 'mime type image/webp is not supported' : null,
  });
  const files = [photo('cover.jpg', 'image/jpeg'), photo('detail.webp', 'image/webp')];
  const table: Array<{ images: string[]; photos: string[] }> = [];
  const first = await saveListing(storage, files, table);
  assert.equal(first.saved, false);
  assert.match(first.error || '', /not published/);
  assert.match(first.error || '', /format is not allowed/);
  assert.equal(table.length, 0);

  rejectWebp = false;
  const second = await saveListing(storage, files, table);
  assert.equal(second.saved, true);
  assert.equal(table.length, 1);
  assert.equal(table[0].images.length, 2);
  assert.equal(listingImages(table[0]).length, 2);
});

test('a dropped network upload is retried once', async () => {
  const storage = memoryStorage({ transientOnce: true });
  const uploaded = await uploadListingPhotos(storage, {
    userId: USER,
    files: [photo('cover.jpg', 'image/jpeg')],
    now: 10,
  });
  assert.equal(uploaded.ok, true);
  assert.equal(storage.calls.length, 2);
  assert.equal(storage.objects.size, 1);
});

test('mobile and gallery filenames are classified from type or extension', () => {
  assert.equal(classifyListingPhoto(photo('cam.jpg', '')).ok, true);
  assert.equal(classifyListingPhoto(photo('cam.jpg', 'application/octet-stream')).ok, true);
  const jpeg = classifyListingPhoto(photo('cam.JPEG', ''));
  assert.equal(jpeg.ok && jpeg.contentType, 'image/jpeg');
  const webp = classifyListingPhoto(photo('shot.webp', ''));
  assert.equal(webp.ok && webp.contentType, 'image/webp');
  const png = classifyListingPhoto({ name: 'scan.png', type: 'image/png', size: 10 });
  assert.equal(png.ok && png.ext, 'png');
  const gif = classifyListingPhoto(photo('anim.gif', 'image/gif'));
  assert.equal(gif.ok && gif.contentType, 'image/gif');

  const heic = classifyListingPhoto(photo('IMG_2048.HEIC', ''));
  assert.equal(heic.ok, false);
  if (!heic.ok) assert.match(heic.reason, /HEIC/);
  const heif = classifyListingPhoto(photo('photo.jpg', 'image/heif'));
  assert.equal(heif.ok, false);

  const text = classifyListingPhoto(photo('notes.txt', 'text/plain'));
  assert.equal(text.ok, false);
  const empty = classifyListingPhoto(photo('empty.jpg', 'image/jpeg', 0));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.reason, /empty/);
  const huge = classifyListingPhoto({ name: 'huge.jpg', type: 'image/jpeg', size: LISTING_PHOTO_MAX_BYTES + 1 });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.match(huge.reason, /12 MB/);

  const picked = acceptListingPhotoFiles([
    photo('ok.jpg', ''),
    photo('phone.HEIC', 'image/heic'),
    photo('nope.pdf', 'application/pdf'),
  ]);
  assert.equal(picked.accepted.length, 1);
  assert.equal(picked.rejected.length, 2);
  assert.match(picked.rejected[0].reason, /HEIC/);
});

test('an unsigned-in id and a non-storage link do not count as uploaded', async () => {
  const storage = memoryStorage();
  const badUser = await uploadListingPhotos(storage, {
    userId: 'not-a-user',
    files: [photo('a.jpg', 'image/jpeg')],
  });
  assert.equal(badUser.ok, false);
  assert.equal(storage.calls.length, 0);

  const badLink = memoryStorage({ publicUrl: () => 'https://cdn.example/a.jpg' });
  const uploaded = await uploadListingPhotos(badLink, {
    userId: USER,
    files: [photo('a.jpg', 'image/jpeg')],
    now: 4,
  });
  assert.equal(uploaded.ok, false);
  assert.match(uploaded.ok ? '' : uploaded.error, /not saved/);
  assert.equal(blockListingSaveForPhotoFailure(1, uploaded) !== null, true);
});

test('no selected photos does not block a listing save', () => {
  assert.equal(blockListingSaveForPhotoFailure(0, { ok: true, urls: [], paths: [] }), null);
});

test('migration 000954 fixes the owner-folder index and mime list without a public write', () => {
  const forward = readFileSync(join(HERE, '../../supabase/migrations/20261108_000954_listing_photo_upload.sql'), 'utf8');
  const rollback = readFileSync(
    join(HERE, '../../supabase/migrations/20261108_000954_listing_photo_upload_rollback.sql'),
    'utf8'
  );
  const code = forward
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const undo = rollback
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  assert.equal(code.match(/\(storage\.foldername\(name\)\)\[1\]/g)?.length, 4);
  assert.doesNotMatch(code, /\(storage\.foldername\(name\)\)\[0\]/);
  assert.match(code, /position\('\[0\]'/);
  assert.match(code, /image\/webp/);
  assert.match(code, /image\/png/);
  assert.match(code, /image\/gif/);
  assert.match(code, /TO authenticated/);
  assert.doesNotMatch(code, /public\s*=\s*true/i);
  assert.doesNotMatch(code, /FOR INSERT[\s\S]*TO public/i);
  assert.doesNotMatch(code, /DROP POLICY IF EXISTS "Public can view listing images"/);

  assert.equal(undo.match(/\(storage\.foldername\(name\)\)\[0\]/g)?.length, 3);
  assert.match(undo, /ARRAY\['image\/jpeg', 'image\/jpg'\]/);
  assert.doesNotMatch(undo, /public\s*=\s*true/i);
});

test('create and edit listing pages stop saving when photo upload fails', () => {
  const list = readFileSync(join(HERE, '../../app/marketplace/list/page.tsx'), 'utf8');
  const edit = readFileSync(join(HERE, '../../app/marketplace/parts/[id]/edit/page.tsx'), 'utf8');
  const client = readFileSync(join(HERE, './listing-photos-client.ts'), 'utf8');
  for (const src of [list, edit]) {
    assert.match(src, /uploadListingPhotos/);
    assert.match(src, /blockListingSaveForPhotoFailure/);
    assert.match(src, /acceptListingPhotoFiles/);
    assert.match(src, /data-testid="listing-photo-error"/);
    assert.doesNotMatch(src, /equipment-photos/);
    assert.doesNotMatch(src, /image upload failed/);
    assert.doesNotMatch(src, /startsWith\('image\/'\)/);
  }
  assert.match(client, /LISTING_IMAGE_BUCKET/);
  assert.match(client, /upsert:\s*false/);
  assert.doesNotMatch(client, /equipment/);
  assert.doesNotMatch(client, /upsert:\s*true/);
});
