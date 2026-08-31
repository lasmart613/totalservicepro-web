-- If the original #69 UPDATE was applied, it set every VBeam row to
-- doc_kind = operator. Reset from the stored title only. No title or PDF
-- changes. Do not run this from an agent session against production.
--
-- Scope is VBeam-family rows only.

ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS doc_kind text;

UPDATE public.manuals
SET doc_kind = CASE
  WHEN title ~* 'technical\s+manuals?' THEN 'technical'
  ELSE 'service'
END
WHERE (
    title ~* 'v[\s_-]*beam'
    OR coalesce(storage_path, '') ~* 'vbeam|v-beam|v_beam'
    OR (
      coalesce(brand, '') ~* 'candela'
      AND title ~* 'perfecta|aesthetica|platinum'
    )
  )
  AND (
    title ~* 'service\s+manuals?'
    OR title ~* 'technical\s+manuals?'
    OR title ~* 'repair\s+manuals?'
  );

UPDATE public.manuals
SET doc_kind = 'operator'
WHERE (
    title ~* 'v[\s_-]*beam'
    OR coalesce(storage_path, '') ~* 'vbeam|v-beam|v_beam'
    OR (
      coalesce(brand, '') ~* 'candela'
      AND title ~* 'perfecta|aesthetica|platinum'
    )
  )
  AND (title ~* $$operator'?s?\s+manual$$ OR title ~* 'user\s+manuals?')
  AND title !~* 'service\s+manuals?'
  AND title !~* 'technical\s+manuals?'
  AND title !~* 'repair\s+manuals?';
