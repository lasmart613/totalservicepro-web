/**
 * equipment-photos and marketplace-images are private buckets.
 * Stored values are often /storage/v1/object/public/<bucket>/<path> strings.
 * Public buckets (part-images, company-assets, logos, user-avatars) stay public URLs.
 */

export const PRIVATE_IMAGE_BUCKETS = new Set(['equipment-photos', 'marketplace-images']);
export const PUBLIC_IMAGE_BUCKETS = new Set(['part-images', 'company-assets', 'logos', 'user-avatars']);

export const LIST_THUMB_WIDTH = 480;
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
export const SIGNED_URL_CACHE_MS = 50 * 60 * 1000;

export const PHOTO_PLACEHOLDER =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="100%" height="100%" fill="#1f2937"/><text x="50%" y="50%" fill="#9ca3af" font-family="sans-serif" font-size="20" text-anchor="middle" dominant-baseline="middle">Photo unavailable</text></svg>'
  );

const STORAGE_MARKERS = [
  '/storage/v1/object/public/',
  '/storage/v1/object/sign/',
  '/storage/v1/object/authenticated/',
  '/storage/v1/render/image/public/',
  '/storage/v1/render/image/sign/',
  '/storage/v1/render/image/authenticated/',
];

export type StoredStorageObject = { bucket: string; path: string; origin: string };

export function parseStoredStorageUrl(url: string | null | undefined): StoredStorageObject | null {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return null;
  for (const marker of STORAGE_MARKERS) {
    const at = raw.indexOf(marker);
    if (at < 0) continue;
    const rest = raw.slice(at + marker.length).split('?')[0].split('#')[0];
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    let bucket = rest.slice(0, slash);
    let path = rest.slice(slash + 1);
    try {
      bucket = decodeURIComponent(bucket);
      path = decodeURIComponent(path);
    } catch {
      /* keep raw segments */
    }
    if (!bucket || !path) return null;
    return { bucket, path, origin: raw.slice(0, at) };
  }
  return null;
}

/**
 * Listing and catalog uploads live under {userId}/listings/ or parts/.
 * Shop equipment photos (equipment/{orgId}/...) stay on the caller's storage RLS.
 */
export function serviceRoleSignable(bucket: string, path: string): boolean {
  if (bucket === 'marketplace-images') return true;
  if (bucket !== 'equipment-photos') return false;
  const normalized = path.replace(/^\/+/, '');
  return normalized.startsWith('parts/') || normalized.includes('/listings/');
}

export function isPrivateImageBucket(bucket: string): boolean {
  return PRIVATE_IMAGE_BUCKETS.has(bucket);
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Width-limited render URL for the public part-images bucket. Other public buckets stay as stored. */
export function partImageThumbnailUrl(url: string, width: number): string | null {
  const parsed = parseStoredStorageUrl(url);
  if (!parsed || parsed.bucket !== 'part-images') return null;
  const w = clampWidth(width);
  return `${parsed.origin}/storage/v1/render/image/public/${encodeURIComponent(parsed.bucket)}/${encodePath(parsed.path)}?width=${w}&resize=contain`;
}

export function clampWidth(width: number | null | undefined, fallback = LIST_THUMB_WIDTH): number {
  const n = Number(width);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(64, Math.min(1600, Math.round(n)));
}

export type ImmediateDisplay = { src: string | null; sign: boolean };

/**
 * Synchronous display decision.
 * Private buckets must be signed before the browser requests them.
 */
export function immediateDisplayUrl(url: string | null | undefined, width = LIST_THUMB_WIDTH): ImmediateDisplay {
  const raw = String(url || '').trim();
  if (!raw) return { src: null, sign: false };
  if (raw.startsWith('blob:') || raw.startsWith('data:')) return { src: raw, sign: false };
  const parsed = parseStoredStorageUrl(raw);
  if (!parsed) return { src: raw, sign: false };
  if (isPrivateImageBucket(parsed.bucket)) return { src: null, sign: true };
  if (parsed.bucket === 'part-images') {
    return { src: partImageThumbnailUrl(raw, width) || raw, sign: false };
  }
  return { src: raw, sign: false };
}

export type SignRequest = { bucket: string; path: string; width: number; url: string };

export function signCacheKey(bucket: string, path: string, width: number): string {
  return `${bucket}\n${path}\n${clampWidth(width)}`;
}

export type CachedSignedUrl = { url: string; exp: number };

/**
 * Resolve a list of stored URLs. Private objects are signed in one call per bucket+width.
 * Repeated paths reuse the cache and are not sent again.
 */
export async function resolveStoredImageUrls(
  urls: Array<string | null | undefined>,
  opts: {
    width?: number;
    sign: (bucket: string, paths: string[], width: number) => Promise<Record<string, string>>;
    cache?: Map<string, CachedSignedUrl>;
    now?: number;
  }
): Promise<Array<string | null>> {
  const width = clampWidth(opts.width);
  const cache = opts.cache || new Map<string, CachedSignedUrl>();
  const now = opts.now ?? Date.now();
  const needed = new Map<string, { bucket: string; path: string; width: number }>();

  const plans = urls.map((url) => {
    const immediate = immediateDisplayUrl(url, width);
    if (!immediate.sign) return { kind: 'direct' as const, src: immediate.src };
    const parsed = parseStoredStorageUrl(String(url || ''));
    if (!parsed || !isPrivateImageBucket(parsed.bucket)) return { kind: 'direct' as const, src: immediate.src };
    const key = signCacheKey(parsed.bucket, parsed.path, width);
    const hit = cache.get(key);
    if (hit && hit.exp > now) return { kind: 'cached' as const, src: hit.url };
    needed.set(`${parsed.bucket}\n${width}\n${parsed.path}`, { bucket: parsed.bucket, path: parsed.path, width });
    return { kind: 'sign' as const, key, path: parsed.path, bucket: parsed.bucket };
  });

  const groups = new Map<string, { bucket: string; width: number; paths: string[] }>();
  for (const item of needed.values()) {
    const groupKey = `${item.bucket}\n${item.width}`;
    const group = groups.get(groupKey) || { bucket: item.bucket, width: item.width, paths: [] };
    group.paths.push(item.path);
    groups.set(groupKey, group);
  }

  for (const group of groups.values()) {
    let signed: Record<string, string> = {};
    try {
      signed = (await opts.sign(group.bucket, group.paths, group.width)) || {};
    } catch (err) {
      console.error('[storage-display] sign failed', group.bucket, err);
      signed = {};
    }
    for (const path of group.paths) {
      const url = signed[path];
      if (!url) continue;
      cache.set(signCacheKey(group.bucket, path, group.width), { url, exp: now + SIGNED_URL_CACHE_MS });
    }
  }

  return plans.map((plan) => {
    if (plan.kind !== 'sign') return plan.src;
    return cache.get(plan.key)?.url || null;
  });
}

/**
 * This repo's supabase-js createSignedUrls does not send transform.
 * A signed object URL can still ask the image renderer for a width limit.
 * If the renderer rejects it, nextPhotoSrc falls back to the original signed object.
 */
export function signedThumbnailUrl(signedUrl: string, width: number): string {
  const raw = String(signedUrl || '').trim();
  if (!raw || !raw.includes('/storage/v1/object/sign/')) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  url.pathname = url.pathname.replace('/storage/v1/object/sign/', '/storage/v1/render/image/sign/');
  url.searchParams.set('width', String(clampWidth(width)));
  url.searchParams.set('resize', 'contain');
  return url.toString();
}

export function nextPhotoSrc(currentSrc: string, alreadyTriedFull: boolean): string {
  if (!alreadyTriedFull && currentSrc.includes('/render/image/sign/')) {
    try {
      const url = new URL(currentSrc);
      url.pathname = url.pathname.replace('/render/image/sign/', '/object/sign/');
      url.searchParams.delete('width');
      url.searchParams.delete('height');
      url.searchParams.delete('resize');
      url.searchParams.delete('quality');
      return url.toString();
    } catch {
      return PHOTO_PLACEHOLDER;
    }
  }
  return PHOTO_PLACEHOLDER;
}

export function photoImgOnError(event: { currentTarget: HTMLImageElement }): void {
  const img = event.currentTarget;
  const next = nextPhotoSrc(img.src, img.dataset.fallback === '1');
  img.dataset.fallback = '1';
  if (img.src === next) return;
  img.src = next;
}
