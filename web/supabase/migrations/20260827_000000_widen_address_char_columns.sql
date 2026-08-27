-- Add Service Ticket → new customer was failing with:
--   value too long for type character(3)
-- The organizations insert (createLinkedCustomer) writes address fields from the
-- ticket / Add Customer form. Live `organizations.state` (and sometimes zip /
-- country / denormalized ticket state) is still CHAR(3) from the original schema
-- while the UI sends a full state name ("Texas"), a US ZIP ("60601"), or
-- "United States". CHAR(3) is the wrong type for that data.
--
-- Widen only short character/varchar address columns. Existing 2–3 letter codes
-- stay valid. Do not touch currency or org type.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.column_name, c.character_maximum_length
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('character', 'character varying')
      AND c.character_maximum_length IS NOT NULL
      AND c.character_maximum_length <= 10
      AND c.column_name IN (
        'state',
        'customer_state',
        'tech_company_state',
        'zip',
        'postal_code',
        'country',
        'country_code'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE text',
      r.table_schema,
      r.table_name,
      r.column_name
    );
  END LOOP;
END $$;

COMMENT ON COLUMN public.organizations.state IS
  'State / province. Accepts 2-letter codes or full names; app maps common US/CA/country input.';
