/**
 * Customer / clinic logo upload — same `logos` public bucket used by
 * Company Profile and onboarding (`organizations.logo_url`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
// Raster only. SVG can carry script and the bucket is public, so it is refused
// here and by the logos bucket's allowed_mime_types (000927).
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const LOGO_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);

/** Content type sent to Storage for an accepted logo. */
export function logoContentType(file: File): string {
  const type = String(file.type || '').toLowerCase();
  if (type === 'image/jpg') return 'image/jpeg';
  if (LOGO_TYPES.has(type)) return type;
  const ext = logoExtension(file);
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

export function validateLogoFile(file: File): string | null {
  if (!file) return 'Choose a logo image.';
  if (file.size > LOGO_MAX_BYTES) return 'Logo must be 2 MB or smaller.';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  // Both must be acceptable when present: a .png named SVG, or an SVG type
  // with a .png name, is refused.
  if (!LOGO_EXTS.has(ext) || (type && !LOGO_TYPES.has(type))) {
    return 'Use a PNG, JPG, or WebP image.';
  }
  return null;
}

export function logoExtension(file: File): string {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'jpeg') return 'jpg';
  if (LOGO_EXTS.has(ext)) return ext;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export function isBlobLogoUrl(url?: string | null): boolean {
  return !!url && url.startsWith('blob:');
}

/**
 * Upload to `logos/{customerId}/logo-{ts}.{ext}` and return the public URL.
 * Storage allows this only for an org the caller administers (owner /
 * company_admin / admin) or a CRM customer of such a shop (000927).
 * Does not write `organizations.logo_url` — caller updates the row.
 */
export async function uploadCustomerLogo(
  supabase: SupabaseClient,
  customerId: string | number,
  file: File
): Promise<string> {
  const invalid = validateLogoFile(file);
  if (invalid) throw new Error(invalid);

  const ext = logoExtension(file);
  const path = `${customerId}/logo-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('logos').upload(path, file, {
    upsert: true,
    contentType: logoContentType(file),
  });
  if (upErr) throw new Error(upErr.message || 'Logo upload failed');

  const { data } = supabase.storage.from('logos').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not get logo URL');
  return data.publicUrl;
}
