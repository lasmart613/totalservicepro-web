/**
 * Shared image check for uploads into company-assets, user-avatars,
 * equipment-photos, part-images, and marketplace-images.
 *
 * The type comes from the file bytes, not the filename or the browser-reported
 * MIME. SVG can carry script, and a renamed ".png" still has SVG bytes, so
 * both are refused. Bucket allowed_mime_types (000974, not applied by the PR
 * that adds this check) is the Storage API backstop.
 *
 * marketplace-images is a private bucket. Listing pages are served with
 * signed URLs, not the public object URL.
 */

export const LISTING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Profile photos. The Android profile page already refuses anything over 2 MB. */
export const AVATAR_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** company-assets. Onboarding allows 5 MB; the company profile page allows 3 MB. */
export const COMPANY_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const COMPANY_PROFILE_LOGO_MAX_BYTES = 3 * 1024 * 1024;
/**
 * Shop equipment photos. The largest live equipment-photos object is a PNG of
 * 7,684,472 bytes, so the cap is 8 MiB rather than the 5 MB listing cap.
 */
export const EQUIPMENT_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export const LISTING_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

export const LISTING_IMAGE_REJECTED =
  'Use a PNG, JPEG, or WebP photo. Other file types, including SVG, are not allowed.';

export const LISTING_IMAGE_UPLOAD_FAILED = "Couldn't upload this photo.";

export type ListingImageContentType = 'image/png' | 'image/jpeg' | 'image/webp';
export type ListingImageExtension = 'png' | 'jpg' | 'webp';

export type ListingImageDetection = {
  contentType: ListingImageContentType;
  extension: ListingImageExtension;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function imageTooLargeMessage(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  const label = Number.isInteger(mb) ? String(mb) : String(Math.round(mb * 10) / 10);
  return `Photo must be ${label} MB or smaller.`;
}

export const LISTING_IMAGE_TOO_LARGE = imageTooLargeMessage(LISTING_IMAGE_MAX_BYTES);

/** True when a toast should show this text as-is instead of a generic save error. */
export function isStorageImageError(message: string | null | undefined): boolean {
  const text = String(message || '');
  return (
    text === LISTING_IMAGE_REJECTED ||
    text === LISTING_IMAGE_UPLOAD_FAILED ||
    /^Photo must be \d+(?:\.\d+)? MB or smaller\.$/.test(text)
  );
}

function hasPrefix(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/** PNG, JPEG, or WebP from the header. Anything else, including SVG, GIF, and HTML, is null. */
export function detectListingImage(bytes: Uint8Array): ListingImageDetection | null {
  if (hasPrefix(bytes, PNG_SIGNATURE)) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  // RIFF????WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

/**
 * Read the header and size. `name` and `type` on the file are ignored so a
 * renamed SVG or a spoofed browser type cannot pass.
 */
export async function inspectListingImage(
  file: Blob,
  maxBytes: number = LISTING_IMAGE_MAX_BYTES
): Promise<{ ok: true } & ListingImageDetection | { ok: false; error: string }> {
  if (file.size > maxBytes) {
    return { ok: false, error: imageTooLargeMessage(maxBytes) };
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectListingImage(head);
  if (!detected) return { ok: false, error: LISTING_IMAGE_REJECTED };
  return { ok: true, contentType: detected.contentType, extension: detected.extension };
}
