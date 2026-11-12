/**
 * Marketplace listing photos.
 * Objects live at {userId}/listings/{stamp}_{index}.{ext} in the private
 * marketplace-images bucket. The browser stores the public-form URL; display
 * signs it. Upload never falls through to another bucket.
 */

import { parseStoredStorageUrl } from '../storage-display.ts';

export const LISTING_IMAGE_BUCKET = 'marketplace-images';

/** Matches the bucket allow-list after migration 000954. HEIC/HEIF stay out. */
export const LISTING_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type ListingPhotoContentType = (typeof LISTING_PHOTO_CONTENT_TYPES)[number];

/** Phone photos are often several megabytes. Larger files get an explicit error. */
export const LISTING_PHOTO_MAX_BYTES = 12 * 1024 * 1024;

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXT_BY_TYPE: Record<ListingPhotoContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const TYPE_BY_EXT: Record<string, ListingPhotoContentType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export type ListingPhotoBlob = Blob & { name: string; type: string; size: number };

export type ListingPhotoRejection = { name: string; reason: string };

export type ListingPhotoStorage = {
  upload(
    path: string,
    body: Blob,
    opts: { contentType: string }
  ): Promise<{ error: { message: string } | null }>;
  publicUrl(path: string): string;
};

export type ListingPhotoUploadResult =
  | { ok: true; urls: string[]; paths: string[] }
  | { ok: false; error: string; failures: ListingPhotoRejection[] };

function fileExt(name: string): string {
  const raw = String(name || '').split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  return raw;
}

function isHeic(name: string, type: string): boolean {
  const ext = fileExt(name);
  const mime = String(type || '').toLowerCase();
  return ext === 'heic' || ext === 'heif' || mime === 'image/heic' || mime === 'image/heif';
}

export function classifyListingPhoto(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true; contentType: ListingPhotoContentType; ext: string } | { ok: false; reason: string } {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, reason: 'The file is empty.' };
  }
  if (file.size > LISTING_PHOTO_MAX_BYTES) {
    return { ok: false, reason: 'The file is over 12 MB.' };
  }
  if (isHeic(file.name, file.type)) {
    return {
      ok: false,
      reason: 'HEIC/HEIF photos cannot be stored. Export a JPEG, PNG, or WebP and try again.',
    };
  }
  const mime = String(file.type || '').toLowerCase();
  let contentType: ListingPhotoContentType | null = null;
  if (mime === 'image/jpg' || mime === 'image/jpeg' || mime === 'image/pjpeg') contentType = 'image/jpeg';
  else if (mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif') contentType = mime;
  else if (mime === '' || mime === 'application/octet-stream') contentType = TYPE_BY_EXT[fileExt(file.name)] || null;
  if (!contentType) {
    return { ok: false, reason: 'This is not a JPEG, PNG, WebP, or GIF photo.' };
  }
  return { ok: true, contentType, ext: EXT_BY_TYPE[contentType] };
}

export function acceptListingPhotoFiles<T extends { name: string; type: string; size: number }>(
  files: T[]
): { accepted: T[]; rejected: ListingPhotoRejection[] } {
  const accepted: T[] = [];
  const rejected: ListingPhotoRejection[] = [];
  for (const file of files) {
    const classified = classifyListingPhoto(file);
    if (classified.ok) accepted.push(file);
    else rejected.push({ name: file.name || 'photo', reason: classified.reason });
  }
  return { accepted, rejected };
}

function explainServerFailure(serverMessage: string): string {
  const raw = String(serverMessage || '').trim();
  if (/mime type/i.test(raw)) return 'This format is not allowed. Use a JPEG, PNG, WebP, or GIF.';
  if (/row-level security|access denied|unauthorized|permission/i.test(raw)) {
    return 'Storage refused this photo (permission).';
  }
  if (/bucket not found|nosuchbucket/i.test(raw)) return 'Photo storage is not available.';
  if (/too large|payload|entity too large|exceeded/i.test(raw)) return 'The file is too large.';
  if (/network|timeout|fetch|econn|503|502/i.test(raw)) return 'The network dropped the upload.';
  return raw || 'Upload failed.';
}

function isTransient(message: string): boolean {
  return /network|timeout|fetch|econn|503|502/i.test(message);
}

function failureResult(
  failures: ListingPhotoRejection[],
  action: 'published' | 'saved'
): ListingPhotoUploadResult {
  const verb = action === 'published' ? 'published' : 'saved';
  const details = failures.map((failure) => `${failure.name}: ${failure.reason}`).join(' ');
  return {
    ok: false,
    failures,
    error: `Photos were not saved, so the listing was not ${verb}. ${details}`.trim(),
  };
}

async function putObject(
  storage: ListingPhotoStorage,
  path: string,
  body: Blob,
  contentType: string
): Promise<{ error: { message: string } | null }> {
  const once = async () => {
    try {
      return await storage.upload(path, body, { contentType });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      return { error: { message } };
    }
  };
  const first = await once();
  if (!first.error || !isTransient(first.error.message)) return first;
  return once();
}

export async function uploadListingPhotos(
  storage: ListingPhotoStorage,
  input: {
    userId: string;
    files: ListingPhotoBlob[];
    now?: number;
    action?: 'published' | 'saved';
  }
): Promise<ListingPhotoUploadResult> {
  const action = input.action || 'saved';
  const owner = String(input.userId || '').trim().toLowerCase();
  if (!USER_ID.test(owner)) {
    return failureResult([{ name: 'Photos', reason: 'Sign in again before uploading photos.' }], action);
  }
  const files = input.files || [];
  if (!files.length) return { ok: true, urls: [], paths: [] };

  const stamp = input.now ?? Date.now();
  const urls: string[] = [];
  const paths: string[] = [];
  const failures: ListingPhotoRejection[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const name = file.name || `photo ${index + 1}`;
    const classified = classifyListingPhoto(file);
    if (!classified.ok) {
      failures.push({ name, reason: classified.reason });
      continue;
    }
    const path = `${owner}/listings/${stamp}_${index}.${classified.ext}`;
    const stored = await putObject(storage, path, file, classified.contentType);
    if (stored.error) {
      failures.push({ name, reason: explainServerFailure(stored.error.message) });
      continue;
    }
    const url = String(storage.publicUrl(path) || '').trim();
    const parsed = parseStoredStorageUrl(url);
    if (!parsed || parsed.bucket !== LISTING_IMAGE_BUCKET || parsed.path !== path) {
      failures.push({ name, reason: 'The stored photo link was not a marketplace image.' });
      continue;
    }
    urls.push(url);
    paths.push(path);
  }

  if (failures.length || urls.length !== files.length) {
    return failureResult(
      failures.length ? failures : [{ name: 'Photos', reason: 'Not every photo was stored.' }],
      action
    );
  }
  return { ok: true, urls, paths };
}

/**
 * Selected photos must all be stored before a listing insert or update.
 * No photos selected is not a failure.
 */
export function blockListingSaveForPhotoFailure(
  selectedCount: number,
  uploaded: ListingPhotoUploadResult
): string | null {
  if (selectedCount < 1) return null;
  if (!uploaded.ok) return uploaded.error;
  if (uploaded.urls.length !== selectedCount) {
    return 'Photos were not saved, so the listing was not changed.';
  }
  return null;
}
