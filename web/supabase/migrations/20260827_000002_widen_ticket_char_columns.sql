-- PR #49 retried organizations / organization_customers on CHAR(3), but the
-- Add Service Ticket submit still inserted service_tickets with:
--   priority='Medium', status='Scheduled', service_type='Repair',
--   customer_city='Orange', assigned_to=<uuid>, scheduled_time, service_date
-- If any of those live columns are still character(3), the ticket insert
-- (or a trigger copying them) raises 22001 after the customer row is created.
--
-- Widen leftover short character columns on the ticket write path. JS also
-- omit-and-retries so production works before this migration is applied.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.column_name, c.character_maximum_length
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name IN (
        'service_tickets',
        'organizations',
        'organization_customers',
        'contacts',
        'sites',
        'lasers',
        'equipment'
      )
      AND c.data_type IN ('character', 'character varying')
      AND c.character_maximum_length IS NOT NULL
      AND c.character_maximum_length <= 36
      AND c.column_name IN (
        'priority',
        'status',
        'service_type',
        'ticket_prefix',
        'customer_city',
        'customer_phone',
        'customer_email',
        'customer_address',
        'customer_state',
        'assigned_to',
        'created_by',
        'scheduled_time',
        'end_time',
        'service_date',
        'equipment_make',
        'equipment_model',
        'serial_number',
        'notes',
        'description',
        'phone',
        'email',
        'city',
        'address',
        'state',
        'zip',
        'country',
        'country_code',
        'currency',
        'biz_type',
        'facility_type'
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
