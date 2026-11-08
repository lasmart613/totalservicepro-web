-- 000951 follow-on, SELECT ONLY. Do not apply. This file only reads.
-- Duplicate normalized manufacturer part numbers within one brand.
-- Identical numbers on different manufacturers stay separate.
-- Review conflicting descriptions before any remap. No blind deletion.

SELECT lower(btrim(brand)) AS brand,
       mpn_normalized,
       count(*) AS copies,
       array_agg(id ORDER BY id) AS ids,
       array_agg(left(coalesce(description, name, ''), 80) ORDER BY id) AS descriptions
  FROM public.parts_catalog
 WHERE coalesce(mpn_normalized, '') <> ''
   AND coalesce(btrim(brand), '') <> ''
 GROUP BY lower(btrim(brand)), mpn_normalized
HAVING count(*) > 1
 ORDER BY brand, mpn_normalized;
