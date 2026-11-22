SET LOCAL lock_timeout = '5s';

-- 000970: marketplace-images owner check. NOT APPLIED by the PR that adds
-- this file. Do not run it against production from that change.
--
-- 20260620 created the write policies with (storage.foldername(name))[0].
-- Postgres arrays are 1-indexed, so [0] is always NULL and every owner
-- INSERT, UPDATE, and DELETE fails the check. Listing photos are stored at
-- {auth.uid()}/listings/... The predicates below are the 20260620 policies
-- with [0] replaced by [1]. Names, roles, commands, and the rest of each
-- expression are unchanged. The public SELECT policy is not modified.
-- The bucket stays private.
--
-- Rollback: 20261122_000970_marketplace_images_policy_index_rollback.sql
-- restores those three policies with [0].

DROP POLICY IF EXISTS "Authenticated users can upload listing images" ON storage.objects;
CREATE POLICY "Authenticated users can upload listing images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'marketplace-images' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update own listing images" ON storage.objects;
CREATE POLICY "Users can update own listing images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'marketplace-images' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete own listing images" ON storage.objects;
CREATE POLICY "Users can delete own listing images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'marketplace-images' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

SELECT '000970 ok' AS status;
