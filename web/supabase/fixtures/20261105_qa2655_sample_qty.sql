-- Sample on-hand quantities for QA org 2655 only.
-- NOT part of 000951. Do not run on production. Do not run until 000951 is applied
-- on a non-production database and Larry has approved that step.
-- Reversible: deletes only rows tagged fixture=qa-2655 on organization 2655.
-- Refuses live customer orgs 1005, 5509, 2616, 4, and 5515.

BEGIN;

DO $$
BEGIN
  IF 2655 IN (1005, 5509, 2616, 4, 5515) THEN
    RAISE EXCEPTION 'qa fixture target collided with a live customer org';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 2655) THEN
    RAISE EXCEPTION 'QA org 2655 is not in this database';
  END IF;
  IF to_regclass('public.organization_parts') IS NULL THEN
    RAISE EXCEPTION 'organization_parts is missing; apply 000951 on this non-prod database first';
  END IF;
END $$;

INSERT INTO public.organization_parts (
  organization_id, catalog_part_id, mpn_normalized, quantity_on_hand,
  description_override, field_sources, notes
)
SELECT 2655, p.id, p.mpn_normalized, v.qty, p.name,
       '{"fixture":"qa-2655"}'::jsonb,
       'QA sample only. Delete with the rollback in this file.'
  FROM (VALUES
    ('7122003497', 1),
    ('7122003165', 2),
    ('7122003446', 0)
  ) AS v(mpn, qty)
  JOIN public.parts_catalog p
    ON p.mpn_normalized = v.mpn
   AND lower(btrim(p.brand)) = 'candela'
 WHERE NOT EXISTS (
   SELECT 1 FROM public.organization_parts op
    WHERE op.organization_id = 2655
      AND op.mpn_normalized = v.mpn
 );

COMMIT;

-- Rollback (run only this block to undo the fixture):
-- DELETE FROM public.organization_parts
--  WHERE organization_id = 2655
--    AND field_sources->>'fixture' = 'qa-2655';
