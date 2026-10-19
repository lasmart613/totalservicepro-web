-- Run AFTER 20261018_parts_catalog_photo_move.mjs. Guarded: updates only if the row still has the old URL.
BEGIN;
SET LOCAL lock_timeout = '5s';
UPDATE public.parts_catalog SET image_url = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public/part-images/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp'
 WHERE id = 1033 AND image_url = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public/equipment-photos/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp';
UPDATE public.parts_catalog SET image_url = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public/part-images/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1789087434321_0.jpg'
 WHERE id = 1034 AND image_url = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public/equipment-photos/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1789087434321_0.jpg';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.parts_catalog WHERE id IN (1033,1034) AND image_url LIKE '%/part-images/parts/%') <> 2 THEN
    RAISE EXCEPTION 'parts photo move: expected 2 rows on part-images';
  END IF;
END $$;
COMMIT;
