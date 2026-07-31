-- Unify laser repair needs onto public.service_requests
-- Live reality: marketplace_requests.id = bigint, service_requests.id = uuid,
-- bids.request_id = bigint → remapped to uuid after copy.

-- ── 1) Columns on service_requests ─────────────────────────────────────────
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS manufacturer text;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS serial_number text;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS preferred_date date;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS error_codes text;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS equipment_id bigint;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS source_marketplace_id bigint;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS category text DEFAULT 'service';
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS price numeric;

UPDATE public.service_requests
SET category = COALESCE(NULLIF(TRIM(category), ''), 'service')
WHERE category IS NULL OR btrim(category) = '';

-- ── 2) Copy marketplace_requests → service_requests (new UUIDs) ────────────
INSERT INTO public.service_requests (
  organization_id,
  posted_by,
  created_by,
  title,
  description,
  manufacturer,
  model,
  model_type,
  serial_number,
  urgency,
  preferred_date,
  deadline,
  error_codes,
  location,
  images,
  status,
  category,
  source_marketplace_id,
  created_at,
  updated_at
)
SELECT
  COALESCE(
    mr.organization_id,
    (SELECT up.organization_id FROM public.user_profiles up WHERE up.id = mr.created_by LIMIT 1)
  ),
  mr.created_by,
  mr.created_by,
  COALESCE(NULLIF(TRIM(mr.title), ''), LEFT(COALESCE(mr.description, 'Service request'), 80)),
  mr.description,
  mr.manufacturer,
  mr.model,
  mr.model,
  mr.serial_number,
  COALESCE(mr.urgency, 'Medium'),
  mr.preferred_date,
  mr.preferred_date,
  mr.error_codes,
  NULL,
  COALESCE(mr.images, '[]'::jsonb),
  COALESCE(mr.status, 'open'),
  'service',
  mr.id,
  COALESCE(mr.created_at, now()),
  COALESCE(mr.updated_at, now())
FROM public.marketplace_requests mr
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_requests sr WHERE sr.source_marketplace_id = mr.id
);

-- ── 3) Remap bids.request_id bigint → uuid of service_requests ─────────────
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS request_id_uuid uuid;

UPDATE public.bids b
SET request_id_uuid = sr.id
FROM public.service_requests sr
WHERE b.request_id IS NOT NULL
  AND sr.source_marketplace_id = b.request_id
  AND b.request_id_uuid IS NULL;

-- Drop FK(s) on request_id if any
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'bids' AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%request_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.bids DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Replace request_id with uuid column (keep legacy as request_id_legacy)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bids'
      AND column_name='request_id' AND data_type='bigint'
  ) THEN
    ALTER TABLE public.bids RENAME COLUMN request_id TO request_id_legacy;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bids' AND column_name='request_id_uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bids'
      AND column_name='request_id' AND data_type='uuid'
  ) THEN
    ALTER TABLE public.bids RENAME COLUMN request_id_uuid TO request_id;
  END IF;
END $$;

-- Ensure request_id uuid column exists even if rename path differed
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS request_id uuid;

UPDATE public.bids b
SET request_id = sr.id
FROM public.service_requests sr
WHERE b.request_id IS NULL
  AND b.request_id_legacy IS NOT NULL
  AND sr.source_marketplace_id = b.request_id_legacy;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname='public' AND t.relname='bids' AND c.contype='f'
      AND pg_get_constraintdef(c.oid) ILIKE '%service_requests%'
  ) THEN
    BEGIN
      ALTER TABLE public.bids
        ADD CONSTRAINT bids_request_id_service_requests_fkey
        FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'bids FK note: %', SQLERRM;
    END;
  END IF;
END $$;

-- ── 4) RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can manage their requests" ON public.service_requests;
DROP POLICY IF EXISTS "Owners manage own service_requests" ON public.service_requests;
DROP POLICY IF EXISTS "Anyone authenticated can view open service needs (for bidding)" ON public.service_requests;
DROP POLICY IF EXISTS "Service pros can view open requests" ON public.service_requests;
DROP POLICY IF EXISTS "Authenticated can view open service_requests" ON public.service_requests;

CREATE POLICY "Owners manage own service_requests" ON public.service_requests
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
  );

CREATE POLICY "Authenticated can view open service_requests" ON public.service_requests
  FOR SELECT TO authenticated
  USING (
    status IN ('open', 'bidding')
    OR created_by = auth.uid()
    OR posted_by = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Request owners view bids" ON public.bids;
DROP POLICY IF EXISTS "Owners view bids on their requests" ON public.bids;
DROP POLICY IF EXISTS "Owners view bids on service_requests" ON public.bids;

CREATE POLICY "Owners view bids on service_requests" ON public.bids
  FOR SELECT TO authenticated
  USING (
    request_id IN (
      SELECT id FROM public.service_requests
      WHERE created_by = auth.uid()
         OR posted_by = auth.uid()
         OR organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_service_requests_status ON public.service_requests (status);
CREATE INDEX IF NOT EXISTS idx_service_requests_org ON public.service_requests (organization_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_category ON public.service_requests (category);
CREATE INDEX IF NOT EXISTS idx_service_requests_source_mp ON public.service_requests (source_marketplace_id);
CREATE INDEX IF NOT EXISTS idx_bids_request_id_uuid ON public.bids (request_id);

SELECT
  (SELECT count(*) FROM public.marketplace_requests) AS marketplace_requests_count,
  (SELECT count(*) FROM public.service_requests) AS service_requests_count,
  (SELECT count(*) FROM public.service_requests WHERE source_marketplace_id IS NOT NULL) AS migrated_from_marketplace,
  (SELECT count(*) FROM public.bids WHERE request_id IS NOT NULL) AS bids_with_uuid_request,
  'ok' AS status;
