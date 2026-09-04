-- Bulk catalog upload staging for Parts Suppliers and owner-side marketplace sellers.
-- Original file lives in the private marketplace-uploads bucket.
-- Rows are staging only — a Grok agent / God later creates marketplace_listings
-- under the uploading organization_id.
--
-- Does not alter marketplace_listings schema. Safe for live orgs.

CREATE TABLE IF NOT EXISTS public.marketplace_upload_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  original_filename text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'marketplace-uploads',
  storage_path text,
  content_type text,
  byte_size integer,
  catalog_kind text NOT NULL DEFAULT 'part',
  status text NOT NULL DEFAULT 'pending',
  row_count integer NOT NULL DEFAULT 0,
  listed_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  email_sent boolean NOT NULL DEFAULT false,
  email_error text,
  notified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_upload_batches_status_chk
    CHECK (status IN ('pending', 'processing', 'listed', 'error', 'partial')),
  CONSTRAINT marketplace_upload_batches_kind_chk
    CHECK (catalog_kind IN ('part', 'consumable', 'used', 'mixed'))
);

CREATE TABLE IF NOT EXISTS public.marketplace_upload_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.marketplace_upload_batches(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  catalog_kind text NOT NULL DEFAULT 'part',
  sku text,
  title text,
  brand text,
  model text,
  condition text,
  price numeric,
  qty integer,
  description text,
  category text,
  photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  marketplace_listing_id uuid REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  processed_at timestamptz,
  processed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_upload_rows_status_chk
    CHECK (status IN ('pending', 'processing', 'listed', 'error')),
  CONSTRAINT marketplace_upload_rows_kind_chk
    CHECK (catalog_kind IN ('part', 'consumable', 'used')),
  CONSTRAINT marketplace_upload_rows_batch_row_uniq UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS marketplace_upload_batches_org_created_idx
  ON public.marketplace_upload_batches (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_upload_batches_status_idx
  ON public.marketplace_upload_batches (status);
CREATE INDEX IF NOT EXISTS marketplace_upload_rows_batch_idx
  ON public.marketplace_upload_rows (batch_id, row_number);
CREATE INDEX IF NOT EXISTS marketplace_upload_rows_org_status_idx
  ON public.marketplace_upload_rows (organization_id, status);
CREATE INDEX IF NOT EXISTS marketplace_upload_rows_listing_idx
  ON public.marketplace_upload_rows (marketplace_listing_id);

COMMENT ON TABLE public.marketplace_upload_batches IS
  'Header for a supplier/reseller CSV/XLSX catalog upload. Staging only; not live listings.';
COMMENT ON TABLE public.marketplace_upload_rows IS
  'One staged catalog line per spreadsheet row. Agent sets status listed/error and marketplace_listing_id.';

ALTER TABLE public.marketplace_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_upload_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_upload_batches_select_org ON public.marketplace_upload_batches;
CREATE POLICY marketplace_upload_batches_select_org ON public.marketplace_upload_batches
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
    OR organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS marketplace_upload_batches_insert_org ON public.marketplace_upload_batches;
CREATE POLICY marketplace_upload_batches_insert_org ON public.marketplace_upload_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
      OR organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS marketplace_upload_rows_select_org ON public.marketplace_upload_rows;
CREATE POLICY marketplace_upload_rows_select_org ON public.marketplace_upload_rows
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
    OR organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS marketplace_upload_rows_insert_org ON public.marketplace_upload_rows;
CREATE POLICY marketplace_upload_rows_insert_org ON public.marketplace_upload_rows
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
    OR organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = auth.uid())
  );

-- No authenticated UPDATE/DELETE: status + marketplace_listing_id are God / service-role only.

DROP TRIGGER IF EXISTS update_marketplace_upload_batches_updated_at ON public.marketplace_upload_batches;
CREATE TRIGGER update_marketplace_upload_batches_updated_at
  BEFORE UPDATE ON public.marketplace_upload_batches
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_marketplace_upload_rows_updated_at ON public.marketplace_upload_rows;
CREATE TRIGGER update_marketplace_upload_rows_updated_at
  BEFORE UPDATE ON public.marketplace_upload_rows
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketplace-uploads',
  'marketplace-uploads',
  false,
  10485760,
  ARRAY[
    'text/csv',
    'text/plain',
    'application/octet-stream',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS marketplace_uploads_insert_own_org ON storage.objects;
CREATE POLICY marketplace_uploads_insert_own_org ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'marketplace-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND (
      (storage.foldername(name))[1] IN (
        SELECT organization_id::text FROM public.user_profiles WHERE id = auth.uid()
      )
      OR (storage.foldername(name))[1] IN (
        SELECT organization_id::text FROM public.organization_memberships WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS marketplace_uploads_select_own_org ON storage.objects;
CREATE POLICY marketplace_uploads_select_own_org ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'marketplace-uploads'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT organization_id::text FROM public.user_profiles WHERE id = auth.uid()
      )
      OR (storage.foldername(name))[1] IN (
        SELECT organization_id::text FROM public.organization_memberships WHERE user_id = auth.uid()
      )
    )
  );

NOTIFY pgrst, 'reload schema';
