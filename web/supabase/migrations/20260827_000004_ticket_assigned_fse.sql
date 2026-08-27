-- Ticket Edit / New Service Call assign an FSE (user_profiles.id).
-- service_tickets.assigned_to is the historical column and has an FK on
-- typed schemas, but live may still have a leftover CHAR(3) assigned_to
-- (PR #51 omit-and-retry drops the UUID so create does not toast).
-- assigned_fse is the durable uuid/text slot. JS writes both and retries
-- when either column is missing or too short.
--
-- 000003 is customer social links (PR #50). This is the next slot.

ALTER TABLE public.service_tickets
  ADD COLUMN IF NOT EXISTS assigned_fse uuid;

COMMENT ON COLUMN public.service_tickets.assigned_fse IS
  'Assigned field service engineer (user_profiles.id). Used when assigned_to cannot store a UUID.';

CREATE INDEX IF NOT EXISTS idx_service_tickets_assigned_fse
  ON public.service_tickets (assigned_fse);

-- If assigned_to is still a short character type, do not convert it to uuid
-- (existing 3-char leftovers would fail). Widen to text so a UUID can land
-- after this migration is applied; JS still omits it until then.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.column_name, c.data_type, c.character_maximum_length
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'service_tickets'
      AND c.column_name IN ('assigned_to', 'assigned_fse')
      AND c.data_type IN ('character', 'character varying')
      AND c.character_maximum_length IS NOT NULL
      AND c.character_maximum_length < 36
  LOOP
    EXECUTE format(
      'ALTER TABLE public.service_tickets ALTER COLUMN %I TYPE text',
      r.column_name
    );
  END LOOP;
END $$;
