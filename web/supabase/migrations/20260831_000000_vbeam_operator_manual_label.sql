-- Optional doc_kind column only.
-- Do NOT rewrite VBeam titles. #69's overlay used to treat every VBeam as
-- an operator manual; that was wrong. Type comes from the stored title
-- (or PDF text), not from brand/model.

ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS doc_kind text;

COMMENT ON COLUMN public.manuals.doc_kind IS
  'Document type: service | operator | user | technical | parts. Null means infer from title/path. Never infer operator from VBeam/Perfecta/Platinum/Aesthetica alone.';
