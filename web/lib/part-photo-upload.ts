/** Catalog part photos live in the public part-images bucket. */

export const PART_IMAGE_BUCKET = 'part-images';
export const PART_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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
  const id = String(userId || '').replace(/[^a-zA-Z0-9-]/g, '') || 'user';
  return `parts/${id}/${now}_${index}.${ext}`;
}
