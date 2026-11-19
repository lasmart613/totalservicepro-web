-- 000964: fields the customer record needs on the existing equipment row.
--
-- public.equipment is already the customer unit (customer_organization_id,
-- location_id from 20260926, manufacturer, model, serial_number, notes).
-- This file does not create another equipment table. It only adds:
--   install_date          date the unit was installed at that customer
--   warranty_or_contract  free text: warranty end, contract name, or number
--   removed_at            soft-remove. NULL means the unit is on the roster.
--                         A non-null value hides the unit from lists but keeps
--                         the row so service_tickets.equipment_id and
--                         service_reports.equipment_id stay valid.
--
-- RLS is unchanged. New columns sit on public.equipment, which is already
-- limited to organization_memberships:
--   equipment_member_select       member of customer_organization_id
--   equipment_facility_manage     owner / creator of that org
--   equipment_service_org_manage  member of a linked service org
--     (organization_customers + is_active_org_member)
-- Column grants below cover databases that privilege equipment by column.
-- Anon does not receive these CRM fields.
--
-- Repo only. Do not apply this file to a live database from the pull request.
-- Never use orgs 4, 153, 154, 1005, 2616, 5509, 5515, or 5516.
--
-- Rollback: 20261119_000964_customer_equipment_record_rollback.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.equipment') IS NULL THEN
    RAISE EXCEPTION '000964: public.equipment is missing; refusing to create a second equipment table';
  END IF;
END $$;

ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS install_date date;

ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS warranty_or_contract text;

ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

COMMENT ON COLUMN public.equipment.install_date IS
  '000964: calendar day the unit was installed for this customer. NULL if unknown.';

COMMENT ON COLUMN public.equipment.warranty_or_contract IS
  '000964: warranty end, contract name, or contract number, whichever the shop has. Free text.';

COMMENT ON COLUMN public.equipment.removed_at IS
  '000964: set when the unit is taken off the roster but tickets or reports still point at this id. NULL means active.';

GRANT SELECT (install_date, warranty_or_contract, removed_at),
      INSERT (install_date, warranty_or_contract, removed_at),
      UPDATE (install_date, warranty_or_contract, removed_at)
  ON public.equipment TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
