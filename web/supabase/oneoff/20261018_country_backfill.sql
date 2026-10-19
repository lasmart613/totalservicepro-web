-- One-off: backfill organizations.country and mark the imported-clinic pool
-- (organizations.prospect_pool = 'intl-clinics-1018'). Needs 000929 first.
-- Service role / SQL editor only, after Larry's yes. Deterministic and
-- idempotent: it only fills rows whose country (or prospect_pool) is NULL, and
-- backs up (id, old country, old prospect_pool) to public.migration_backup
-- with label 'country-backfill-1018' before any update (once per row).
-- Rollback: 20261018_country_backfill_rollback.sql
--
-- Rules
--   Import batches (id range AND a matching "Country: X" line in notes; the
--   range alone is never trusted, and an address that ends in a different
--   known country leaves the row NULL):
--     2684-2848 Egypt (notes say "Import: egypt-clinics-1018", not intl-...)
--     2849-2979 United Arab Emirates, 2980-3138 Saudi Arabia, 3139-3505 India
--   Every other org: signals from phone prefix (+1 -> United States, or
--   Canada with a Canadian province; +20/+971/+966/+91/+52/+55; a bare
--   10-digit number counts as +1), state/province (US codes and names,
--   Canadian provinces, a few Egypt/UAE/KSA region names), the address
--   suffix and a US ZIP. The row is set only when every present signal
--   agrees; an unknown '+' prefix or any disagreement leaves it NULL.
--
-- Expected on prod (read-only replica of this logic, 2026-10-18, 2,745 orgs):
--   United States 1,860 | India 367 | Egypt 168 | Saudi Arabia 159 |
--   United Arab Emirates 131 | NULL 60 ; prospect_pool marked: 822
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'country')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'prospect_pool') THEN
    RAISE EXCEPTION 'apply migration 000929 first';
  END IF;
END $$;

LOCK TABLE public.organizations IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE country_backfill_1018 ON COMMIT DROP AS
WITH src AS (
  SELECT o.id, o.country AS old_country, o.prospect_pool AS old_pool, o.notes, o.address, o.state, o.zip, o.phone,
         upper(btrim(coalesce(o.state, ''))) AS st,
         lower(btrim(coalesce(o.state, ''))) AS stl,
         btrim(coalesce(o.zip, '')) AS z,
         regexp_replace(coalesce(o.phone, ''), '[^0-9+]', '', 'g') AS ph,
         lower(btrim(coalesce(o.address, ''))) AS addr
  FROM public.organizations o
),
sig AS (
  SELECT s.*,
    CASE
      WHEN s.id BETWEEN 2684 AND 2848 THEN 'Egypt'
      WHEN s.id BETWEEN 2849 AND 2979 THEN 'United Arab Emirates'
      WHEN s.id BETWEEN 2980 AND 3138 THEN 'Saudi Arabia'
      WHEN s.id BETWEEN 3139 AND 3505 THEN 'India'
    END AS batch_country,
    substring(coalesce(s.notes, '') FROM '(?n)^Country:[ \t]*([^\r\n]+?)[ \t]*$') AS note_country,
    CASE
      WHEN s.ph LIKE '+1%' THEN 'NANP'
      WHEN s.ph LIKE '+20%' THEN 'Egypt'
      WHEN s.ph LIKE '+971%' THEN 'United Arab Emirates'
      WHEN s.ph LIKE '+966%' THEN 'Saudi Arabia'
      WHEN s.ph LIKE '+91%' THEN 'India'
      WHEN s.ph LIKE '+52%' THEN 'Mexico'
      WHEN s.ph LIKE '+55%' THEN 'Brazil'
      WHEN s.ph LIKE '+%' THEN 'OTHER'
      -- bare digits: a 10-digit NANP number (optional leading 1, extension allowed)
      WHEN s.ph ~ '^1?[2-9][0-9]{9}' THEN 'NANP'
      ELSE NULL
    END AS phone_sig,
    CASE
      WHEN s.st IN ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY')
        OR s.stl IN ('alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','district of columbia','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming')
        THEN 'United States'
      WHEN s.st IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
        OR s.stl IN ('alberta','british columbia','manitoba','new brunswick','newfoundland and labrador','nova scotia','northwest territories','nunavut','ontario','prince edward island','quebec','québec','saskatchewan','yukon')
        THEN 'Canada'
      WHEN s.stl IN ('cairo','giza','alexandria') THEN 'Egypt'
      WHEN s.stl IN ('dubai','abu dhabi','sharjah') THEN 'United Arab Emirates'
      WHEN s.stl IN ('riyadh','jeddah','makkah','madinah','eastern province') THEN 'Saudi Arabia'
      ELSE NULL
    END AS state_sig,
    CASE
      WHEN s.addr ~ '(,|\s)(usa|u\.s\.a\.|united states( of america)?)$' THEN 'United States'
      WHEN s.addr ~ ',\s*canada$' THEN 'Canada'
      WHEN s.addr ~ ',\s*egypt$' THEN 'Egypt'
      WHEN s.addr ~ ',\s*(united arab emirates|uae)$' THEN 'United Arab Emirates'
      WHEN s.addr ~ ',\s*saudi arabia$' THEN 'Saudi Arabia'
      WHEN s.addr ~ ',\s*india$' THEN 'India'
      WHEN s.addr ~ ',\s*(mexico|méxico)$' THEN 'Mexico'
      WHEN s.addr ~ ',\s*(brazil|brasil)$' THEN 'Brazil'
      ELSE NULL
    END AS addr_sig,
    (s.z ~ '^[0-9]{5}(-[0-9]{4})?$') AS us_zip
  FROM src s
),
dec AS (
  SELECT g.*,
    CASE
      -- import batches: id range AND matching "Country:" note, never the range alone
      WHEN g.batch_country IS NOT NULL THEN
        CASE WHEN g.note_country = g.batch_country
              AND (g.addr_sig IS NULL OR g.addr_sig = g.batch_country) THEN g.batch_country END
      ELSE (
        WITH c(v) AS (
          SELECT CASE WHEN g.phone_sig = 'NANP'
                      THEN CASE WHEN g.state_sig = 'Canada' OR g.addr_sig = 'Canada' THEN 'Canada' ELSE 'United States' END
                      ELSE g.phone_sig END
          UNION ALL SELECT g.state_sig
          UNION ALL SELECT g.addr_sig
          UNION ALL SELECT CASE WHEN g.us_zip THEN 'United States' END
        )
        SELECT CASE WHEN count(DISTINCT v) = 1 AND bool_and(v IS DISTINCT FROM 'OTHER') THEN min(v) END
        FROM c WHERE v IS NOT NULL
      )
    END AS new_country
  FROM sig g
)
 SELECT d.id, d.old_country, d.old_pool, d.new_country,
        CASE WHEN d.batch_country IS NOT NULL AND d.new_country = d.batch_country
             THEN 'intl-clinics-1018' END AS new_pool
   FROM dec d;

-- Backup first (once per row for this label)
INSERT INTO public.migration_backup (label, source_table, row_pk, row_data)
SELECT 'country-backfill-1018', 'organizations', b.id::text,
       jsonb_build_object('id', b.id, 'country', b.old_country, 'prospect_pool', b.old_pool)
  FROM country_backfill_1018 b
 WHERE ((b.old_country IS NULL AND b.new_country IS NOT NULL)
        OR (b.old_pool IS NULL AND b.new_pool IS NOT NULL))
   AND NOT EXISTS (SELECT 1 FROM public.migration_backup m
                    WHERE m.label = 'country-backfill-1018' AND m.source_table = 'organizations'
                      AND m.row_pk = b.id::text);

UPDATE public.organizations o
   SET country = b.new_country
  FROM country_backfill_1018 b
 WHERE o.id = b.id AND o.country IS NULL AND b.new_country IS NOT NULL;

UPDATE public.organizations o
   SET prospect_pool = b.new_pool
  FROM country_backfill_1018 b
 WHERE o.id = b.id AND o.prospect_pool IS NULL AND b.new_pool IS NOT NULL;

-- Result
SELECT coalesce(country, '(null)') AS country, count(*) AS orgs,
       count(*) FILTER (WHERE prospect_pool IS NOT NULL) AS pool
  FROM public.organizations GROUP BY 1 ORDER BY 2 DESC;

COMMIT;
