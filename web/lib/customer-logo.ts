/**
 * Customer / clinic logo upload — same `logos` public bucket used by
 * Company Profile and onboarding (`organizations.logo_url`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']);
const LOGO_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);

export function validateLogoFile(file: File): string | null {
  if (!file) return 'Choose a logo image.';
  if (file.size > LOGO_MAX_BYTES) return 'Logo must be 2 MB or smaller.';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!LOGO_TYPES.has(file.type) && !LOGO_EXTS.has(ext)) {
    return 'Use a PNG, JPG, WebP, or SVG image.';
  }
  return null;
}

export function logoExtension(file: File): string {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'jpeg') return 'jpg';
  if (LOGO_EXTS.has(ext)) return ext;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/svg+xml') return 'svg';
  return 'jpg';
}

export function isBlobLogoUrl(url?: string | null): boolean {
  return !!url && url.startsWith('blob:');
}

/**
 * Upload to `logos/{customerId}/logo-{ts}.{ext}` and return the public URL.
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
    contentType: file.type || undefined,
  });
  if (upErr) throw new Error(upErr.message || 'Logo upload failed');

  const { data } = supabase.storage.from('logos').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not get logo URL');
  return data.publicUrl;
}
