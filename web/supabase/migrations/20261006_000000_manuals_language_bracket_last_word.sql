-- Backfill public.manuals.language when a trailing parenthetical's LAST word
-- is a known language name. Examples that the first language migration left as
-- 'en' because the whole bracket was not an exact name:
--   (Service Manual, German)
--   (… German)
--   (notes in Spanish)
--
-- Titles are NOT rewritten. Exact "(German)" / "(Brazilian Portuguese)" rows
-- were already coded by 20261005_000001_manuals_language.sql and stay put.
-- A note whose last word is not a language is left alone, including
-- "(Dutch IFU/Operator; not service manual)" and "(French Operator Manual)".
-- Bare two-letter tokens are not names, so "(Service Manual, DE)" and
-- "(Model No)" are not retagged.
--
-- Apply this file in the Supabase SQL editor as one script. Do not run it
-- from the app. Idempotent: only writes language when the detected code differs,
-- and never demotes a row to English.

UPDATE public.manuals AS m
SET language = map.code
FROM (
  SELECT
    id,
    btrim(
      regexp_replace(
        lower(btrim(regexp_replace(title, '^.*\(\s*([^)]+?)\s*\)\s*$', '\1'))),
        '^.*[ ,;:/]+',
        ''
      ),
      '."''()[]{}!?-–—…'
    ) AS last_word
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
    ('chinese', 'zh'),
    ('中文', 'zh'),
    ('mandarin', 'zh'),
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
    ('indonesian', 'id'),
    ('malay', 'ms'),
    ('hindi', 'hi'),
    ('हिन्दी', 'hi'),
    ('farsi', 'fa'),
    ('persian', 'fa'),
    ('فارسی', 'fa'),
    ('ukrainian', 'uk'),
    ('українська', 'uk'),
    ('english', 'en')
) AS map(word, code)
  ON parsed.last_word = map.word
WHERE m.id = parsed.id
  AND map.code <> 'en'
  AND m.language IS DISTINCT FROM map.code;
