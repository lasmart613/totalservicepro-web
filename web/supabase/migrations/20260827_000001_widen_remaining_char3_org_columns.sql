-- PR #48 widened state/zip/country. Production JS still toasted because the
-- overflowing CHAR(3) was a *different* organizations / organization_customers
-- column we still send: created_by (UUID), phone, biz_type, specialties, or
-- (less likely) type. Live /api/directory already stores type='customer' and
-- type='service_company', so type is probably text — still include it if the
-- live column is actually character(n).
--
-- UUID columns are data_type=uuid and are not touched.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.column_name, c.character_maximum_length
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name IN (
        'organizations',
        'organization_customers',
        'contacts',
        'sites',
        'service_tickets',
        'service_reports',
        'user_profiles'
      )
      AND c.data_type IN ('character', 'character varying')
      AND c.character_maximum_length IS NOT NULL
      AND c.character_maximum_length <= 36
      AND c.column_name IN (
        'type',
        'ticket_prefix',
        'created_by',
        'phone',
        'email',
        'biz_type',
        'facility_type',
        'contact_name',
        'website',
        'notes',
        'address',
        'city',
        'specialties',
        'state',
        'zip',
        'postal_code',
        'country',
        'country_code',
        'customer_state',
        'tech_company_state'
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
