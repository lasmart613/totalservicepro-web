-- Exact rollback: restore the original equipment-photos URLs (source objects were never deleted).
-- Optional cleanup after rollback: remove part-images objects parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp and parts/0d04a116-38a8-4ba0-8738-7981e398f551/1789087434321_0.jpg via the Storage API.
BEGIN;
SET LOCAL lock_timeout = '5s';
UPDATE public.parts_catalog SET image_url = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public/equipment-photos/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp'
 WHERE id = 1033 AND image_url = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public/part-images/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp';
UPDATE public.parts_catalog SET image_url = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public/equipment-photos/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1789087434321_0.jpg'
 WHERE id = 1034 AND image_url = 'https://yljztfajyvjzqikxdddf.supabase.co/storage/v1/object/public/part-images/parts/0d04a116-38a8-4ba0-8738-7981e398f551/1789087434321_0.jpg';
COMMIT;
