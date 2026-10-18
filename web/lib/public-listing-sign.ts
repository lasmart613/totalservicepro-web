/**
 * Which private-bucket objects the service role may sign for anyone
 * (/api/storage/signed-urls). Only photos of a public marketplace listing:
 * the object must be referenced by images/photos of a listing whose status is
 * public, and sit under that listing seller's {uid}/listings/ folder.
 * Anything else (parts/ catalog photos, equipment photos, a guessed path)
 * goes through the caller's own JWT and storage RLS, or is not signed.
 */
import { parseStoredStorageUrl } from './storage-display.ts';
import { isPublicListingStatus } from './marketplace/ownership.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** {uid}/listings/{file} -> uid; otherwise null. */
export function listingPathOwner(path: string): string | null {
  const parts = String(path || '').replace(/^\/+/, '').split('/');
  if (parts.length !== 3 || parts[1] !== 'listings' || !parts[2]) return null;
  if (parts.some((p) => p === '..' || p === '.')) return null;
  return UUID_RE.test(parts[0]) ? parts[0].toLowerCase() : null;
}

export type ListingPhotoRow = {
  status?: string | null;
  seller_id?: string | null;
  created_by?: string | null;
  images?: unknown;
  photos?: unknown;
};

function urls(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/** bucket\npath keys a public listing references, limited to its seller's folder. */
export function publicListingObjectKeys(rows: ListingPhotoRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows || []) {
    if (!isPublicListingStatus(row.status ?? null)) continue;
    const owners = new Set([row.seller_id, row.created_by].filter(Boolean).map((v) => String(v).toLowerCase()));
    for (const url of [...urls(row.images), ...urls(row.photos)]) {
      const parsed = parseStoredStorageUrl(url);
      if (!parsed) continue;
      const owner = listingPathOwner(parsed.path);
      if (!owner || !owners.has(owner)) continue;
      out.add(`${parsed.bucket}\n${parsed.path.replace(/^\/+/, '')}`);
    }
  }
  return out;
}

export function isPublicListingObject(keys: Set<string>, bucket: string, path: string): boolean {
  return keys.has(`${bucket}\n${String(path || '').replace(/^\/+/, '')}`);
}
