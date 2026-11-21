'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import { LISTING_IMAGE_BUCKET, type ListingPhotoStorage } from '@/lib/marketplace/listing-photos';

/** Browser upload to marketplace-images only. No second-bucket fallback. */
export function listingPhotoStorage(): ListingPhotoStorage {
  const supabase = getSupabaseClient();
  const bucket = supabase.storage.from(LISTING_IMAGE_BUCKET);
  return {
    async upload(path, body, opts) {
      const { error } = await bucket.upload(path, body, {
        upsert: false,
        contentType: opts.contentType,
      });
      return { error: error ? { message: error.message } : null };
    },
    publicUrl(path) {
      return bucket.getPublicUrl(path).data?.publicUrl || '';
    },
  };
}
