-- 000946: backfill service_invoices.invoice_number and refuse new nulls.
--
-- invoice_number was added nullable, with no default, in
-- 20260927_000000_service_invoice_payment_columns.sql. The unique index
-- service_invoices_org_number_uidx (20260813_000000_unique_doc_numbers.sql)
-- ignores nulls, so rows saved before the column existed stayed null.
--
-- The app number (web/lib/billing/doc-numbers.ts generateDocNumber, kind INV)
-- is {ORG_PREFIX}-INV-{YYYYMMDD}-{NN}. Prefix is organizations.ticket_prefix
-- sanitized to A-Z0-9 (max 8), else the first 3 alphanumerics of the org name,
-- else TSP. The date is created_at in organizations.timezone (America/Los_Angeles
-- when that zone is missing or invalid). NN is the next sequence for that org
-- and that day only: the max numeric suffix among numbers matching
-- {PREFIX}-INV-{YYYYMMDD}- with 1 to 4 digits, then +1, zero-padded to 2 while
-- it is below 100. A suffix longer than 4 digits does not count, and another
-- day's number does not carry forward. Whitespace-only invoice_number is
-- treated as null. JSON copies use invoice_data.invoice_number, then
-- invoice_data.invNumber (the same keys as extractNumberFromRow).
--
-- Order inside one transaction:
--   1. drift guards (required columns, integer org id, unique index)
--   2. lock service_invoices (lock_timeout 5s)
--   3. copy a JSON number onto null or whitespace rows when that value is free
--   4. number the remaining blanks in one pass: row_number per org+day after
--      that day's max, skipping any value the unique index owns
--   5. record every filled id in public.service_invoice_number_backfill_audit
--      (RLS on, no grants to anon/authenticated) and NOTICE the mapping
--   6. CHECK (btrim(invoice_number) <> '') NOT VALID
--   7. BEFORE INSERT trigger assigns the next per-org per-day number when the
--      insert leaves invoice_number null or whitespace (SECURITY DEFINER,
--      search_path '', per-org advisory lock)
--   8. ALTER COLUMN invoice_number SET NOT NULL
--   9. record supabase_migrations.schema_migrations version 20261025_000946
--
-- Does not DELETE rows. Rollback:
-- 20261025_000946_service_invoice_number_backfill_rollback.sql
-- nulls exactly the audited ids whose number is still the value this file wrote.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $drift$
DECLARE
  v_org_type oid;
  v_num_type oid;
  v_data_type oid;
  v_id_type oid;
  v_unique boolean;
  v_indexdef text;
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000946 drift: public.service_invoices is missing';
  END IF;
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '000946 drift: public.organizations is missing';
  END IF;

  SELECT atttypid INTO v_id_type
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.service_invoices'::regclass
    AND attname = 'id' AND NOT attisdropped;
  IF v_id_type IS NULL OR v_id_type NOT IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype) THEN
    RAISE EXCEPTION '000946 drift: public.service_invoices.id integer column is missing';
  END IF;

  SELECT atttypid INTO v_org_type
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.service_invoices'::regclass
    AND attname = 'organization_id' AND NOT attisdropped;
  IF v_org_type IS NULL OR v_org_type NOT IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype) THEN
    RAISE EXCEPTION '000946 drift: public.service_invoices.organization_id integer column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'created_at' AND NOT attisdropped
      AND atttypid IN ('timestamp'::regtype, 'timestamptz'::regtype)
  ) THEN
    RAISE EXCEPTION '000946 drift: public.service_invoices.created_at timestamp column is missing';
  END IF;

  SELECT atttypid INTO v_num_type
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.service_invoices'::regclass
    AND attname = 'invoice_number' AND NOT attisdropped;
  IF v_num_type IS NULL OR v_num_type NOT IN ('text'::regtype, 'varchar'::regtype) THEN
    RAISE EXCEPTION '000946 drift: public.service_invoices.invoice_number text column is missing';
  END IF;

  SELECT atttypid INTO v_data_type
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.service_invoices'::regclass
    AND attname = 'invoice_data' AND NOT attisdropped;
  IF v_data_type IS NULL OR v_data_type NOT IN ('json'::regtype, 'jsonb'::regtype, 'text'::regtype) THEN
    RAISE EXCEPTION '000946 drift: public.service_invoices.invoice_data json column is missing';
  END IF;

  SELECT i.indisunique, pg_catalog.pg_get_indexdef(i.indexrelid)
    INTO v_unique, v_indexdef
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'service_invoices_org_number_uidx';
  IF v_unique IS NOT TRUE
     OR v_indexdef NOT LIKE '%(organization_id, invoice_number)%'
     OR v_indexdef NOT ILIKE '%invoice_number IS NOT NULL%' THEN
    RAISE EXCEPTION '000946 drift: unique index service_invoices_org_number_uidx is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.organizations'::regclass
      AND attname = 'id' AND NOT attisdropped
      AND atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)
  ) THEN
    RAISE EXCEPTION '000946 drift: public.organizations.id integer column is missing';
  END IF;
END
$drift$;

LOCK TABLE public.service_invoices IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.service_invoice_org_prefix(p_organization_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_raw_prefix text;
  v_name text;
  v_prefix text;
BEGIN
  v_raw_prefix := NULL;
  v_name := NULL;
  IF p_organization_id IS NOT NULL AND pg_catalog.to_regclass('public.organizations') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.organizations'::regclass
        AND attname = 'ticket_prefix' AND NOT attisdropped
    ) THEN
      EXECUTE 'SELECT pg_catalog.btrim(ticket_prefix::text) FROM public.organizations WHERE id = $1'
        INTO v_raw_prefix USING p_organization_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.organizations'::regclass
        AND attname = 'name' AND NOT attisdropped
    ) THEN
      EXECUTE 'SELECT name::text FROM public.organizations WHERE id = $1'
        INTO v_name USING p_organization_id;
    END IF;
  END IF;

  -- Same rules as web/lib/billing/doc-numbers.ts sanitizePrefix.
  v_prefix := pg_catalog.upper(
    pg_catalog.regexp_replace(coalesce(v_raw_prefix, ''::text), '[^A-Za-z0-9]', ''::text, 'g')
  );
  IF v_prefix = '' THEN
    v_prefix := pg_catalog.upper(pg_catalog.substr(
      pg_catalog.regexp_replace(coalesce(v_name, ''::text), '[^A-Za-z0-9]', ''::text, 'g'),
      1, 3
    ));
  END IF;
  IF coalesce(v_prefix, ''::text) = '' THEN
    v_prefix := 'TSP';
  END IF;
  RETURN pg_catalog.substr(v_prefix, 1, 8);
END;
$fn$;
COMMENT ON FUNCTION public.service_invoice_org_prefix(bigint) IS
  '000946 organizations.ticket_prefix sanitized like doc-numbers.ts sanitizePrefix';
REVOKE ALL ON FUNCTION public.service_invoice_org_prefix(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_invoice_org_zone(p_organization_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_zone text;
BEGIN
  v_zone := NULL;
  IF p_organization_id IS NOT NULL AND pg_catalog.to_regclass('public.organizations') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.organizations'::regclass
        AND attname = 'timezone' AND NOT attisdropped
    ) THEN
      EXECUTE 'SELECT pg_catalog.btrim(timezone::text) FROM public.organizations WHERE id = $1'
        INTO v_zone USING p_organization_id;
    END IF;
  END IF;
  v_zone := coalesce(nullif(v_zone, ''::text), 'America/Los_Angeles'::text);
  BEGIN
    PERFORM pg_catalog.to_char(pg_catalog.now() AT TIME ZONE v_zone, 'YYYYMMDD');
  EXCEPTION WHEN others THEN
    v_zone := 'America/Los_Angeles';
  END;
  RETURN v_zone;
END;
$fn$;
COMMENT ON FUNCTION public.service_invoice_org_zone(bigint) IS
  '000946 IANA zone for invoice dates, or America/Los_Angeles';
REVOKE ALL ON FUNCTION public.service_invoice_org_zone(bigint) FROM PUBLIC, anon, authenticated;

-- Seq of {PREFIX}-INV-{YYYYMMDD}-{NN} when NN is 1..4 digits. Anything else,
-- including a longer suffix, is not part of that day's sequence (parseSeq).
CREATE OR REPLACE FUNCTION public.service_invoice_day_seq(p_number text, p_stem text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_number IS NULL OR p_stem IS NULL OR pg_catalog.btrim(p_stem) = '' THEN NULL
    WHEN pg_catalog.upper(pg_catalog.btrim(p_number))
         ~ ('^' || pg_catalog.upper(pg_catalog.btrim(p_stem)) || '[0-9]{1,4}$')
    THEN NULLIF(
      (pg_catalog.regexp_match(pg_catalog.upper(pg_catalog.btrim(p_number)), '[0-9]{1,4}$'))[1]::integer,
      0
    )
    ELSE NULL
  END
$fn$;
COMMENT ON FUNCTION public.service_invoice_day_seq(text, text) IS
  '000946 1-4 digit suffix when the number matches {PREFIX}-INV-{YYYYMMDD}- exactly';
REVOKE ALL ON FUNCTION public.service_invoice_day_seq(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_invoice_next_number(p_organization_id bigint, p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_prefix text;
  v_zone text;
  v_at timestamptz;
  v_ymd text;
  v_stem text;
  v_max integer;
  v_n integer;
  v_candidate text;
BEGIN
  -- One allocator per org. Null org shares a single lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'tsp.service_invoice_number:' || coalesce(p_organization_id::text, ''::text),
      0
    )
  );

  v_prefix := public.service_invoice_org_prefix(p_organization_id);
  v_zone := public.service_invoice_org_zone(p_organization_id);
  v_at := coalesce(p_at, pg_catalog.now());
  v_ymd := pg_catalog.to_char(v_at AT TIME ZONE v_zone, 'YYYYMMDD');
  v_stem := v_prefix || '-INV-' || v_ymd || '-';

  SELECT coalesce(max(public.service_invoice_day_seq(si.invoice_number, v_stem)), 0)
    INTO v_max
  FROM public.service_invoices si
  WHERE si.organization_id IS NOT DISTINCT FROM p_organization_id;

  v_n := v_max + 1;
  LOOP
    IF v_n < 100 THEN
      v_candidate := v_stem || pg_catalog.lpad(v_n::text, 2, '0'::text);
    ELSE
      v_candidate := v_stem || v_n::text;
    END IF;
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.service_invoices si
      WHERE si.organization_id IS NOT DISTINCT FROM p_organization_id
        AND si.invoice_number = v_candidate
    );
    v_n := v_n + 1;
    IF v_n > v_max + 100000 THEN
      RAISE EXCEPTION '000946 could not allocate a unique invoice number for organization %', p_organization_id;
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$fn$;
COMMENT ON FUNCTION public.service_invoice_next_number(bigint, timestamptz) IS
  '000946 next {PREFIX}-INV-{YYYYMMDD}-{NN} for one org on that day; the sequence resets each day';
REVOKE ALL ON FUNCTION public.service_invoice_next_number(bigint, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.service_invoice_number_backfill_audit (
  invoice_id text PRIMARY KEY,
  organization_id text,
  old_invoice_number text,
  new_invoice_number text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT service_invoice_number_backfill_audit_source_chk
    CHECK (source IN ('json', 'sequence'))
);
COMMENT ON TABLE public.service_invoice_number_backfill_audit IS
  '000946 ids whose null invoice_number this migration filled. Rollback nulls these rows only while the number is still new_invoice_number.';

ALTER TABLE public.service_invoice_number_backfill_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_invoice_number_backfill_audit FROM PUBLIC, anon, authenticated;

DO $backfill$
DECLARE
  rec record;
  v_obj jsonb;
  v_num text;
  v_json int := 0;
  v_seq int := 0;
BEGIN
  -- Pass 1: JSON number, oldest first, only when the unique index would accept it.
  -- Whitespace-only invoice_number is missing, same as null.
  FOR rec IN
    SELECT si.id, si.organization_id, si.invoice_number AS old_invoice_number, si.invoice_data, si.created_at
    FROM public.service_invoices si
    WHERE si.invoice_number IS NULL OR pg_catalog.btrim(si.invoice_number) = ''
    ORDER BY si.created_at ASC NULLS LAST, si.id ASC
  LOOP
    v_obj := NULL;
    v_num := NULL;
    IF rec.invoice_data IS NOT NULL THEN
      BEGIN
        v_obj := rec.invoice_data::text::jsonb;
      EXCEPTION WHEN others THEN
        v_obj := NULL;
      END;
      IF v_obj IS NOT NULL AND pg_catalog.jsonb_typeof(v_obj) = 'string' THEN
        BEGIN
          v_obj := (v_obj #>> '{}')::jsonb;
        EXCEPTION WHEN others THEN
          v_obj := NULL;
        END;
      END IF;
      IF v_obj IS NOT NULL AND pg_catalog.jsonb_typeof(v_obj) = 'object' THEN
        v_num := nullif(btrim(coalesce(v_obj->>'invoice_number', '')), '');
        IF v_num IS NULL THEN
          v_num := nullif(btrim(coalesce(v_obj->>'invNumber', '')), '');
        END IF;
      END IF;
    END IF;

    IF v_num IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.service_invoices o
      WHERE o.organization_id IS NOT DISTINCT FROM rec.organization_id
        AND o.invoice_number = v_num
    ) THEN
      RAISE NOTICE '000946 json skip id=% org=% number=% reason=unique-index-collision', rec.id, rec.organization_id, v_num;
      CONTINUE;
    END IF;

    UPDATE public.service_invoices
    SET invoice_number = v_num
    WHERE id = rec.id
      AND (invoice_number IS NULL OR pg_catalog.btrim(invoice_number) = '');
    IF FOUND THEN
      INSERT INTO public.service_invoice_number_backfill_audit
        (invoice_id, organization_id, old_invoice_number, new_invoice_number, source)
      VALUES (rec.id::text, rec.organization_id::text, nullif(pg_catalog.btrim(rec.old_invoice_number), ''), v_num, 'json');
      v_json := v_json + 1;
      RAISE NOTICE '000946 backfill source=json id=% org=% before=% after=%',
        rec.id, rec.organization_id, coalesce(rec.old_invoice_number, '<null>'), v_num;
    END IF;
  END LOOP;

  -- Pass 2: one scan. row_number() per org + created_at day, after that day's
  -- max 1-4 digit {PREFIX}-INV-{ymd}- suffix. A longer suffix does not count.
  CREATE TEMP TABLE pg_temp_invoice_number_seq_assign (
    id bigint PRIMARY KEY,
    organization_id bigint,
    old_invoice_number text,
    new_invoice_number text
  ) ON COMMIT DROP;

  WITH blanks AS (
    SELECT si.id,
           si.organization_id,
           si.invoice_number AS old_invoice_number,
           coalesce(si.created_at, pg_catalog.now()) AS created_at
    FROM public.service_invoices si
    WHERE si.invoice_number IS NULL OR pg_catalog.btrim(si.invoice_number) = ''
  ),
  org_ids AS (
    SELECT b.organization_id FROM blanks b
    UNION
    SELECT si.organization_id
    FROM public.service_invoices si
    WHERE si.invoice_number IS NOT NULL AND pg_catalog.btrim(si.invoice_number) <> ''
  ),
  org_meta AS (
    SELECT o.organization_id,
           public.service_invoice_org_prefix(o.organization_id) AS prefix,
           public.service_invoice_org_zone(o.organization_id) AS zone
    FROM org_ids o
  ),
  parsed AS (
    SELECT si.organization_id,
           (pg_catalog.regexp_match(
              pg_catalog.upper(pg_catalog.btrim(si.invoice_number)),
              '-INV-([0-9]{8})-[0-9]{1,4}$'
            ))[1] AS ymd,
           public.service_invoice_day_seq(
             si.invoice_number,
             m.prefix || '-INV-' || coalesce(
               (pg_catalog.regexp_match(
                  pg_catalog.upper(pg_catalog.btrim(si.invoice_number)),
                  '-INV-([0-9]{8})-[0-9]{1,4}$'
                ))[1],
               ''
             ) || '-'
           ) AS seq
    FROM public.service_invoices si
    JOIN org_meta m ON m.organization_id IS NOT DISTINCT FROM si.organization_id
    WHERE si.invoice_number IS NOT NULL AND pg_catalog.btrim(si.invoice_number) <> ''
  ),
  maxes AS (
    SELECT p.organization_id, p.ymd, max(p.seq) AS base_seq
    FROM parsed p
    WHERE p.seq IS NOT NULL AND p.ymd IS NOT NULL
    GROUP BY p.organization_id, p.ymd
  ),
  ranked AS (
    SELECT b.id,
           b.organization_id,
           b.old_invoice_number,
           m.prefix || '-INV-' || pg_catalog.to_char(b.created_at AT TIME ZONE m.zone, 'YYYYMMDD') || '-' AS stem,
           pg_catalog.to_char(b.created_at AT TIME ZONE m.zone, 'YYYYMMDD') AS ymd,
           row_number() OVER (
             PARTITION BY b.organization_id, pg_catalog.to_char(b.created_at AT TIME ZONE m.zone, 'YYYYMMDD')
             ORDER BY b.created_at ASC, b.id ASC
           )::integer AS rn
    FROM blanks b
    JOIN org_meta m ON m.organization_id IS NOT DISTINCT FROM b.organization_id
  ),
  assigned AS (
    SELECT r.id,
           r.organization_id,
           r.old_invoice_number,
           r.stem,
           coalesce(x.base_seq, 0) + r.rn AS seq
    FROM ranked r
    LEFT JOIN maxes x
      ON x.organization_id IS NOT DISTINCT FROM r.organization_id
     AND x.ymd = r.ymd
  ),
  updated AS (
    UPDATE public.service_invoices si
    SET invoice_number = CASE
          WHEN a.seq < 100 THEN a.stem || pg_catalog.lpad(a.seq::text, 2, '0')
          ELSE a.stem || a.seq::text
        END
    FROM assigned a
    WHERE si.id = a.id
      AND (si.invoice_number IS NULL OR pg_catalog.btrim(si.invoice_number) = '')
    RETURNING si.id, si.invoice_number AS new_invoice_number
  )
  INSERT INTO pg_temp_invoice_number_seq_assign (id, organization_id, old_invoice_number, new_invoice_number)
  SELECT u.id, a.organization_id, a.old_invoice_number, u.new_invoice_number
  FROM updated u
  JOIN assigned a ON a.id = u.id;

  INSERT INTO public.service_invoice_number_backfill_audit
    (invoice_id, organization_id, old_invoice_number, new_invoice_number, source)
  SELECT s.id::text,
         s.organization_id::text,
         nullif(pg_catalog.btrim(s.old_invoice_number), ''),
         s.new_invoice_number,
         'sequence'
  FROM pg_temp_invoice_number_seq_assign s;
  GET DIAGNOSTICS v_seq = ROW_COUNT;

  FOR rec IN
    SELECT s.id, s.organization_id, s.old_invoice_number, s.new_invoice_number
    FROM pg_temp_invoice_number_seq_assign s
    ORDER BY s.organization_id ASC NULLS FIRST, s.id ASC
  LOOP
    RAISE NOTICE '000946 backfill source=sequence id=% org=% before=% after=%',
      rec.id, rec.organization_id, coalesce(rec.old_invoice_number, '<null>'), rec.new_invoice_number;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.service_invoices
    WHERE invoice_number IS NULL OR pg_catalog.btrim(invoice_number) = ''
  ) THEN
    RAISE EXCEPTION '000946 backfill left null or blank invoice_number values';
  END IF;
  RAISE NOTICE '000946 backfilled % invoice_number values (json=% sequence=%)', v_json + v_seq, v_json, v_seq;
END
$backfill$;

DO $blankchk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'service_invoices_invoice_number_not_blank'
      AND conrelid = 'public.service_invoices'::regclass
  ) THEN
    ALTER TABLE public.service_invoices
      ADD CONSTRAINT service_invoices_invoice_number_not_blank
      CHECK (btrim(invoice_number) <> '') NOT VALID;
  END IF;
END
$blankchk$;

CREATE OR REPLACE FUNCTION public.service_invoices_assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.invoice_number IS NOT NULL AND pg_catalog.btrim(NEW.invoice_number) <> '' THEN
    NEW.invoice_number := pg_catalog.btrim(NEW.invoice_number);
    RETURN NEW;
  END IF;
  NEW.invoice_number := public.service_invoice_next_number(
    NEW.organization_id,
    coalesce(NEW.created_at, pg_catalog.now())
  );
  IF NEW.invoice_number IS NULL OR pg_catalog.btrim(NEW.invoice_number) = '' THEN
    RAISE EXCEPTION '000946 invoice number assignment returned empty';
  END IF;
  RETURN NEW;
END;
$fn$;
COMMENT ON FUNCTION public.service_invoices_assign_invoice_number() IS
  '000946 BEFORE INSERT: assign the next per-org per-day invoice number when the column is null or whitespace';
REVOKE ALL ON FUNCTION public.service_invoices_assign_invoice_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_invoices_assign_invoice_number ON public.service_invoices;
CREATE TRIGGER service_invoices_assign_invoice_number
  BEFORE INSERT ON public.service_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.service_invoices_assign_invoice_number();

ALTER TABLE public.service_invoices
  ALTER COLUMN invoice_number SET NOT NULL;

DO $book$
DECLARE
  has_name boolean;
  has_statements boolean;
  statements_required boolean;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION '000946 drift: supabase_migrations.schema_migrations is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'supabase_migrations.schema_migrations'::regclass
      AND i.indisunique
      AND a.attname = 'version'
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION '000946 drift: supabase_migrations.schema_migrations.version is not unique';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations' AND column_name = 'name'
  ) INTO has_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations' AND column_name = 'statements'
  ) INTO has_statements;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
      AND column_name = 'statements' AND is_nullable = 'NO'
  ) INTO statements_required;

  IF has_name AND has_statements THEN
    IF statements_required THEN
      INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
      VALUES ('20261025_000946', 'service_invoice_number_backfill', ARRAY['service_invoice_number_backfill']::text[])
      ON CONFLICT (version) DO NOTHING;
    ELSE
      INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
      VALUES ('20261025_000946', 'service_invoice_number_backfill', NULL)
      ON CONFLICT (version) DO NOTHING;
    END IF;
  ELSIF has_name THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20261025_000946', 'service_invoice_number_backfill')
    ON CONFLICT (version) DO NOTHING;
  ELSE
    INSERT INTO supabase_migrations.schema_migrations (version)
    VALUES ('20261025_000946')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END
$book$;

NOTIFY pgrst, 'reload schema';

COMMIT;
