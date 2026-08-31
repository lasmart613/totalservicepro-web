-- Catalog correction: the Candela VBeam PDF in the Service Manual Library is
-- an Operator's Manual, not a Service Manual (Larry, live repairplanet.net).
--
-- Apply this in the Supabase SQL Editor on the live project. The manuals
-- catalog is production data in public.manuals — there is no seed JSON in
-- this repo. This does not replace PDF bytes or storage_path.
--
-- After apply, titles that said "Service Manual" become "Operator's Manual"
-- and doc_kind = 'operator'. A future real VBeam service manual can set
-- doc_kind = 'service' and will not be remapped by the web overlay.

ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS doc_kind text;

COMMENT ON COLUMN public.manuals.doc_kind IS
  'Document type: service | operator | user | technical | parts. Null means infer from title (VBeam family defaults to operator in the web overlay).';

UPDATE public.manuals
SET
  doc_kind = 'operator',
  title = CASE
    WHEN title ~* $$operator'?s?\s+manual$$ AND title !~* 'service\s+manuals?' THEN title
    WHEN title ~* 'service\s+manuals?' THEN
      regexp_replace(title, 'service\s+manuals?', $$Operator's Manual$$, 'gi')
    WHEN title ~* 'user\s+manuals?' THEN
      regexp_replace(title, 'user\s+manuals?', $$Operator's Manual$$, 'gi')
    ELSE trim(both from title) || $$ Operator's Manual$$
  END
WHERE
  coalesce(doc_kind, '') IS DISTINCT FROM 'service'
  AND (
    title ~* 'v[\s_-]*beam'
    OR coalesce(storage_path, '') ~* 'vbeam|v-beam|v_beam'
    OR (
      coalesce(brand, '') ~* 'candela'
      AND title ~* 'perfecta|aesthetica'
    )
  );
