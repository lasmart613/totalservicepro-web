-- public.manuals.language: ISO 639-1 code for the PDF.
-- Nullable so a row can be unknown. Default is 'en'. Existing rows with no
-- recognized title suffix are set to 'en' below.
--
-- Titles are NOT rewritten. A suffix such as "(German)" stays on the title
-- so shelf labels, citations, storage-adjacent names, and doc_kind
-- classifiers keep the string they already use. The column is the filter key.
--
-- Apply this file in the Supabase SQL editor as one script. Do not run it
-- from the app, and do not apply it twice expecting titles to change.
-- Idempotent: ADD COLUMN / constraint / index are guarded, and the backfill
-- only writes language.

ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS language text;

COMMENT ON COLUMN public.manuals.language IS
  'ISO 639-1 language of the manual PDF. Null is treated as English by the app. Default en. Trailing title suffixes such as (German) are kept on title.';

-- Trailing "(Language)" only. A longer note such as "(Dutch IFU/Operator; not service manual)" does not match.
UPDATE public.manuals AS m
SET language = map.code
FROM (
  SELECT
    id,
    regexp_replace(
      lower(btrim(regexp_replace(title, '^.*\(\s*([^)]+?)\s*\)\s*$', '\1'))),
      '\s+',
      ' ',
      'g'
    ) AS suffix
  FROM public.manuals
  WHERE title ~ '\([^)]+\)\s*$'
) AS parsed
JOIN (
  VALUES
    ('german', 'de'),
    ('deutsch', 'de'),
    ('spanish', 'es'),
    ('español', 'es'),
    ('espanol', 'es'),
    ('french', 'fr'),
    ('français', 'fr'),
    ('francais', 'fr'),
    ('italian', 'it'),
    ('italiano', 'it'),
    ('japanese', 'ja'),
    ('日本語', 'ja'),
    ('portuguese', 'pt'),
    ('português', 'pt'),
    ('portugues', 'pt'),
    ('brazilian portuguese', 'pt'),
    ('português do brasil', 'pt'),
    ('portugues do brasil', 'pt'),
    ('chinese', 'zh'),
    ('中文', 'zh'),
    ('mandarin', 'zh'),
    ('simplified chinese', 'zh'),
    ('traditional chinese', 'zh'),
    ('dutch', 'nl'),
    ('nederlands', 'nl'),
    ('korean', 'ko'),
    ('한국어', 'ko'),
    ('russian', 'ru'),
    ('русский', 'ru'),
    ('arabic', 'ar'),
    ('العربية', 'ar'),
    ('hebrew', 'he'),
    ('עברית', 'he'),
    ('polish', 'pl'),
    ('polski', 'pl'),
    ('swedish', 'sv'),
    ('svenska', 'sv'),
    ('danish', 'da'),
    ('dansk', 'da'),
    ('norwegian', 'no'),
    ('norsk', 'no'),
    ('finnish', 'fi'),
    ('suomi', 'fi'),
    ('turkish', 'tr'),
    ('türkçe', 'tr'),
    ('turkce', 'tr'),
    ('greek', 'el'),
    ('ελληνικά', 'el'),
    ('czech', 'cs'),
    ('čeština', 'cs'),
    ('cestina', 'cs'),
    ('hungarian', 'hu'),
    ('magyar', 'hu'),
    ('romanian', 'ro'),
    ('română', 'ro'),
    ('romana', 'ro'),
    ('thai', 'th'),
    ('ไทย', 'th'),
    ('vietnamese', 'vi'),
    ('tiếng việt', 'vi'),
    ('tieng viet', 'vi'),
    ('indonesian', 'id'),
    ('bahasa indonesia', 'id'),
    ('malay', 'ms'),
    ('bahasa melayu', 'ms'),
    ('hindi', 'hi'),
    ('हिन्दी', 'hi'),
    ('farsi', 'fa'),
    ('persian', 'fa'),
    ('فارسی', 'fa'),
    ('ukrainian', 'uk'),
    ('українська', 'uk'),
    ('english', 'en'),
    ('en', 'en'),
    ('de', 'de'),
    ('es', 'es'),
    ('fr', 'fr'),
    ('it', 'it'),
    ('ja', 'ja'),
    ('pt', 'pt'),
    ('zh', 'zh'),
    ('nl', 'nl'),
    ('ko', 'ko'),
    ('ru', 'ru'),
    ('ar', 'ar'),
    ('he', 'he'),
    ('pl', 'pl'),
    ('sv', 'sv'),
    ('da', 'da'),
    ('no', 'no'),
    ('fi', 'fi'),
    ('tr', 'tr'),
    ('el', 'el'),
    ('cs', 'cs'),
    ('hu', 'hu'),
    ('ro', 'ro'),
    ('th', 'th'),
    ('vi', 'vi'),
    ('id', 'id'),
    ('ms', 'ms'),
    ('hi', 'hi'),
    ('fa', 'fa'),
    ('uk', 'uk')
) AS map(suffix, code)
  ON parsed.suffix = map.suffix
WHERE m.id = parsed.id
  AND m.language IS DISTINCT FROM map.code;

UPDATE public.manuals
SET language = 'en'
WHERE language IS NULL;

ALTER TABLE public.manuals
  ALTER COLUMN language SET DEFAULT 'en';

ALTER TABLE public.manuals
  DROP CONSTRAINT IF EXISTS manuals_language_check;

ALTER TABLE public.manuals
  ADD CONSTRAINT manuals_language_check
  CHECK (language IS NULL OR language ~ '^[a-z]{2}$');

CREATE INDEX IF NOT EXISTS idx_manuals_language
  ON public.manuals (language);
