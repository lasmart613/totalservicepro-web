/** Catalog part photos live in the public part-images bucket. */

export const PART_IMAGE_BUCKET = 'part-images';
export const PART_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PART_PHOTO_MAX_FILES = 6;
/** Photos one account may add in an hour. */
export const PART_PHOTO_USER_HOUR_MAX = 30;
/** Photos one company may add in an hour, across its members. */
export const PART_PHOTO_ORG_HOUR_MAX = 80;
/** Durable cap on objects already stored under this account's prefix. */
export const PART_PHOTO_USER_STORED_MAX = 100;
export const PART_PHOTO_QUOTA_WINDOW_MS = 60 * 60 * 1000;

export type PartPhotoQuotaState = {
  userHits: Map<string, number[]>;
  orgHits: Map<string, number[]>;
};

function recentHits(hits: number[] | undefined, now: number): number[] {
  return (hits || []).filter((stamp) => now - stamp < PART_PHOTO_QUOTA_WINDOW_MS);
}

/** True when this upload stays inside the per-user and per-org hourly counts. Does not record it. */
export function partPhotoQuotaAllows(
  state: PartPhotoQuotaState,
  input: { userId: string; organizationId?: string | number | null; files: number; now?: number }
): { ok: true } | { ok: false; error: string } {
  const files = input.files;
  if (files < 1) return { ok: false, error: 'Choose a photo.' };
  if (files > PART_PHOTO_MAX_FILES) {
    return { ok: false, error: `Upload up to ${PART_PHOTO_MAX_FILES} photos at a time.` };
  }
  const now = input.now ?? Date.now();
  const userCount = recentHits(state.userHits.get(input.userId), now).length;
  if (userCount + files > PART_PHOTO_USER_HOUR_MAX) {
    return { ok: false, error: 'Photo upload limit reached for this account. Try again later.' };
  }
  const orgKey =
    input.organizationId == null || input.organizationId === '' ? '' : String(input.organizationId);
  if (orgKey) {
    const orgCount = recentHits(state.orgHits.get(orgKey), now).length;
    if (orgCount + files > PART_PHOTO_ORG_HOUR_MAX) {
      return { ok: false, error: 'Photo upload limit reached for this company. Try again later.' };
    }
  }
  return { ok: true };
}

export function recordPartPhotoQuota(
  state: PartPhotoQuotaState,
  input: { userId: string; organizationId?: string | number | null; files: number; now?: number }
): void {
  const files = input.files;
  if (files < 1) return;
  const now = input.now ?? Date.now();
  const stamps = Array.from({ length: files }, () => now);
  state.userHits.set(input.userId, recentHits(state.userHits.get(input.userId), now).concat(stamps));
  const orgKey =
    input.organizationId == null || input.organizationId === '' ? '' : String(input.organizationId);
  if (orgKey) {
    state.orgHits.set(orgKey, recentHits(state.orgHits.get(orgKey), now).concat(stamps));
  }
}

export const livePartPhotoQuotaState: PartPhotoQuotaState = { userHits: new Map(), orgHits: new Map() };

export function partPhotoStoredAllows(
  existing: number,
  incoming: number
): { ok: true } | { ok: false; error: string } {
  if (existing + incoming > PART_PHOTO_USER_STORED_MAX) {
    return { ok: false, error: 'Photo upload limit reached for this account.' };
  }
  return { ok: true };
}

export function partPhotoUserPrefix(userId: string): string {
  const id = String(userId || '').replace(/[^a-zA-Z0-9-]/g, '') || 'user';
  return `parts/${id}`;
}

const EXT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function partPhotoContentType(fileName: string, browserType: string): string | null {
  const type = String(browserType || '').toLowerCase();
  if (type === 'image/jpg' || type === 'image/jpeg') return 'image/jpeg';
  if (type === 'image/png' || type === 'image/webp' || type === 'image/gif') return type;
  const ext = String(fileName || '').split('.').pop()?.toLowerCase() || '';
  return EXT_TYPE[ext] || null;
}

/** parts/{userId}/{timestamp}_{index}.ext inside part-images. */
export function partPhotoPath(userId: string, index: number, fileName: string, now = Date.now()): string {
  const raw = String(fileName || '').split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const ext = raw === 'jpeg' ? 'jpg' : EXT_TYPE[raw] ? raw : 'jpg';
  return `${partPhotoUserPrefix(userId)}/${now}_${index}.${ext}`;
}
