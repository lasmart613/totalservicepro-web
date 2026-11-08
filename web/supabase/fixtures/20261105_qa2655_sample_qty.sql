-- Sample on-hand quantities for a database the operator has already chosen.
-- NOT part of 000951. Do not run this file against production. Do not run it
-- until 000951 is applied on that chosen database and Larry has approved that step.
-- Reversible: deletes only rows tagged fixture=qa-2655 on organization 2655.
--
-- The two settings below are separate operator interlocks. They are not an
-- environment attestation. A production session can set both of them; doing so
-- does not prove the database is local or non-production. This file does not
-- detect hosting, project, or network. Org id 2655 also exists in production,
-- so the org id is not the guard either.
--   SET tsp.allow_qa_fixture = 'local-2655';
--   SET tsp.environment = 'local';
-- Either setting alone is not enough. An unset database writes nothing.

BEGIN;

DO $$
BEGIN
  IF coalesce(current_setting('tsp.allow_qa_fixture', true), '') IS DISTINCT FROM 'local-2655' THEN
    RAISE EXCEPTION 'refusing QA fixture: operator interlock tsp.allow_qa_fixture is not local-2655. This setting is not proof the database is non-production';
  END IF;
  IF coalesce(current_setting('tsp.environment', true), '') IS DISTINCT FROM 'local' THEN
    RAISE EXCEPTION 'refusing QA fixture: operator interlock tsp.environment is not local. This setting is not proof the database is non-production';
  END IF;
  IF 2655 IN (1005, 5509, 2616, 4, 5515) THEN
    RAISE EXCEPTION 'qa fixture target collided with a live customer org';
  END IF;
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'QA org 2655 is not in this database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 2655) THEN
    RAISE EXCEPTION 'QA org 2655 is not in this database';
  END IF;
  IF to_regclass('public.organization_parts') IS NULL THEN
    RAISE EXCEPTION 'organization_parts is missing; apply 000951 on this local database first';
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
