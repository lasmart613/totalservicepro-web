/**
 * Signed image URLs. createSignedUrls cannot send a transform, so each
 * (path, width) is signed with createSignedUrl. Results stay in memory
 * for less time than the URL itself.
 */

import { SIGNED_URL_TTL_SECONDS, snapThumbWidth } from './storage-display.ts';

export const THUMB_QUALITY = 70;
export const SIGN_CONCURRENCY = 6;
/** Shorter than SIGNED_URL_TTL_SECONDS so a cached URL is still usable. */
export const SIGNED_URL_SERVER_CACHE_MS = 15 * 60 * 1000;

export type ThumbTransform = {
  width: number;
  quality: number;
  resize: 'contain';
};

export function thumbnailTransform(width: number): ThumbTransform {
  return { width: snapThumbWidth(width), quality: THUMB_QUALITY, resize: 'contain' };
}

export type ImageSigner = {
  createSignedUrl: (
    path: string,
    expiresIn: number,
    options?: {
      download?: string | boolean;
      transform?: { width?: number; height?: number; resize?: 'cover' | 'contain' | 'fill'; quality?: number };
      cacheNonce?: string;
    }
  ) => Promise<
    | { data: { signedUrl?: string } | null; error: { message?: string } | null }
    | { data: { signedUrl: string } | null; error: { message: string } | null }
  >;
};

type CacheEntry = { url: string; exp: number };

const memoryCache = new Map<string, CacheEntry>();

export function clearSignedImageUrlCache(): void {
  memoryCache.clear();
}

function cacheKey(bucket: string, path: string, width: number | null): string {
  return `${bucket}\n${path}\n${width == null ? 'full' : snapThumbWidth(width)}`;
}

/**
 * Sign each path. A thumbnail width passes transform into createSignedUrl.
 * width null signs the original object with no transform.
 */
export async function signImagePaths(
  signer: ImageSigner,
  bucket: string,
  paths: string[],
  width: number | null,
  opts?: {
    concurrency?: number;
    now?: number;
    ttlSeconds?: number;
    cache?: Map<string, CacheEntry>;
  }
): Promise<Record<string, string>> {
  const cache = opts?.cache ?? memoryCache;
  const now = opts?.now ?? Date.now();
  const ttl = opts?.ttlSeconds ?? SIGNED_URL_TTL_SECONDS;
  const concurrency = Math.max(1, opts?.concurrency ?? SIGN_CONCURRENCY);
  const snapped = width == null ? null : snapThumbWidth(width);
  const transform = snapped == null ? undefined : thumbnailTransform(snapped);
  const unique = [...new Set(paths.filter(Boolean))];
  const out: Record<string, string> = {};
  const pending: string[] = [];

  for (const path of unique) {
    const hit = cache.get(cacheKey(bucket, path, snapped));
    if (hit && hit.exp > now) {
      out[path] = hit.url;
      continue;
    }
    pending.push(path);
  }

  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const path = pending[cursor];
      cursor += 1;
      try {
        const result = transform
          ? await signer.createSignedUrl(path, ttl, { transform })
          : await signer.createSignedUrl(path, ttl);
        if (result.error || !result.data?.signedUrl) {
          console.error('[signed-urls] sign failed', bucket, path, result.error?.message || 'empty');
          continue;
        }
        out[path] = result.data.signedUrl;
        cache.set(cacheKey(bucket, path, snapped), {
          url: result.data.signedUrl,
          exp: now + SIGNED_URL_SERVER_CACHE_MS,
        });
      } catch (err) {
        console.error('[signed-urls] sign failed', bucket, path, err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () => worker());
  await Promise.all(workers);
  return out;
}
