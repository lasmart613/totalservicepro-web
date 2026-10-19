-- 000933: Find clinics locality follow-up (QA live report on #322 / 000929).
--
-- MAY NEED RENUMBERING: written against main at 4ea31ae (last migration 000931)
-- while the organizations security fix is expected to take 000932. If anything
-- else lands first, bump the number (file name, comments and drift guard text).
--
-- M-1  prospect_state_key() only mapped US state names, so a viewer whose org
--      says 'AB' or 'SP' never matched pool rows that say 'Alberta' or
--      'São Paulo' and fell to rank 2 (any clinic in the country).
--      New prospect_region_key(state, country) maps US states, Canadian
--      provinces/territories, Brazilian states and Mexican states (codes, full
--      names, common abbreviations; accent-, case-, dot- and whitespace-
--      insensitive) to one key 'CC:CODE' on BOTH sides. Unknown values become
--      'raw:<folded text>', so two identical unknown spellings still match.
--      Fallback: same city + same country is rank 0 whenever the two state keys
--      are not both recognised (one side unknown/blank); two recognised but
--      different states (Springfield IL vs MO) never match on city.
--      Countries compare by prospect_country_code() on both sides everywhere
--      (ranking, country_pool, Premium country filter and pills), so
--      'canada' = 'Canada' = 'CA' and 'egypt' = 'Egypt'.
-- I-1  Cities compare through prospect_city_key(): accent-, case-, dot-,
--      hyphen- and whitespace-insensitive, and a trailing "(neighbourhood)" is
--      ignored ('São Paulo (Moema)' = 'Sao Paulo'). Prefix cities ('New Cairo'
--      vs 'Cairo') are NOT merged: they are different municipalities and a
--      safe rule needs a gazetteer (follow-up).
-- L-1  find_clinic_prospects() adds viewer.has_location and
--      viewer.country_pool (pool rows in the viewer's country, NULL when the
--      viewer has no country) so the page can say "no clinics in your country
--      yet" instead of asking for an address the org already has.
--
-- What changes: new internal helpers prospect_fold(text),
-- prospect_city_key(text), prospect_country_code(text),
-- prospect_region_key(text, text), prospect_pool_rows_local(bigint, text,
-- text, text); find_clinic_prospects(text, text, int, int) is replaced in
-- place (same signature, same grants, same tiering/gating, same caps).
-- Untouched: add_prospect_customer, org_is_paid_entitled, and the 000929
-- prospect_state_key / prospect_pool_rows (no longer called; kept so the
-- rollback is a pure restore; drop them in a later cleanup).
--
-- Security: every function is SECURITY DEFINER with search_path '' (the
-- helpers are pure), anon is denied, helpers are not client-callable, and
-- EXECUTE on find_clinic_prospects stays authenticated only.
-- extract()/coalesce() are SQL syntax and stay unqualified on purpose.
-- APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261018_000933_find_clinics_locality_rollback.sql

-- One transaction: lock_timeout applies and PUBLIC never holds EXECUTE between
-- CREATE and REVOKE. Under a tool that already wraps a transaction, BEGIN only
-- warns (25001) and the final COMMIT ends that same transaction.
BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Drift guards
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  -- 000929 must be live and unmodified by anything but 000929 / 000933.
  SELECT string_agg(f, ', ') INTO v_missing
    FROM unnest(ARRAY[
      'public.find_clinic_prospects(text,text,integer,integer)',
      'public.add_prospect_customer(bigint)',
      'public.org_is_paid_entitled(bigint)',
      'public.get_my_org_id()',
      'public.is_active_org_member(bigint)'
    ]) AS f
   WHERE to_regprocedure(f) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '000933 drift: missing function(s): % (000929 must be applied first)', v_missing;
  END IF;
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['id', 'name', 'type', 'city', 'state', 'country', 'prospect_pool', 'is_active']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.organizations'::regclass AND attname = c AND NOT attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '000933 drift: organizations is missing column(s): %', v_missing;
  END IF;
  IF coalesce(obj_description('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure, 'pg_proc'), '') NOT LIKE '000929:%'
     AND coalesce(obj_description('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure, 'pg_proc'), '') NOT LIKE '000933:%' THEN
    RAISE EXCEPTION '000933 drift: find_clinic_prospects was not created by 000929/000933; refusing to replace';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('prospect_fold', 'prospect_city_key', 'prospect_country_code', 'prospect_region_key', 'prospect_pool_rows_local')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_description d
          WHERE d.objoid = p.oid AND d.classoid = 'pg_catalog.pg_proc'::regclass AND d.description LIKE '000933:%')
  ) THEN
    RAISE EXCEPTION '000933 drift: a 000933 helper name already exists and was not created by 000933';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'prospect_pool_rows_local'
       AND pg_catalog.pg_get_function_identity_arguments(p.oid) <> 'p_org bigint, p_country text, p_region text, p_city_key text'
  ) THEN
    RAISE EXCEPTION '000933 drift: prospect_pool_rows_local exists with another signature';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Pure helpers
-- ---------------------------------------------------------------------------
-- Lower-case, strip accents (Latin-1/Latin Extended-A letters used in CA/BR/MX
-- names), hyphen -> space, drop dots and apostrophes, collapse whitespace.
-- NULL for blank. No unaccent extension (not installed on prod, not IMMUTABLE).
CREATE OR REPLACE FUNCTION public.prospect_fold(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT nullif(pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.lower(pg_catalog.translate(p, 'ÁÀÂÃÄÅĀĂĄÇĆČĎÉÈÊËĒĖĘĚÍÌÎÏĪĮŁÑŃŇÓÒÔÕÖØŌŐŘŚŠŞŤÚÙÛÜŪŮŰŲÝŸŽŹŻáàâãäåāăąçćčďéèêëēėęěíìîïīįłñńňóòôõöøōőřśšşťúùûüūůűųýÿžźż-.’''', 'aaaaaaaaacccdeeeeeeeeiiiiiiłnnnoooooøoorssstuuuuuuuuyyzzzaaaaaaaaacccdeeeeeeeeiiiiiiłnnnoooooøoorssstuuuuuuuuyyzzz ')),
           '\s+', ' ', 'g')), '');
$$;
COMMENT ON FUNCTION public.prospect_fold(text) IS
  '000933: folds text for locality matching (lower, no accents, no dots/apostrophes, hyphen=space, single spaces). Internal.';

-- City key: fold, ignoring a trailing "(...)" qualifier and trailing "/" or ",".
CREATE OR REPLACE FUNCTION public.prospect_city_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    public.prospect_fold(pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(coalesce(p, ''), '\s*\([^()]*\)\s*$', ''),
      '[\s/,]+$', '')),
    public.prospect_fold(pg_catalog.translate(p, '()', '')));
$$;
COMMENT ON FUNCTION public.prospect_city_key(text) IS
  '000933: city key for locality matching (folded; trailing "(...)" qualifier ignored). Internal.';

-- Country key used for every country comparison in 000933 (ranking,
-- country_pool, Premium country filter/pills): 'US' / 'CA' / 'BR' / 'MX' for
-- the four mapped countries (names, codes, any case/accents), otherwise
-- 'raw:<folded name>' (so 'egypt' = 'Egypt'), NULL when blank.
CREATE OR REPLACE FUNCTION public.prospect_country_code(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN x.f IS NULL THEN NULL
    WHEN x.f IN ('united states', 'united states of america', 'usa', 'us', 'u s', 'u s a') THEN 'US'
    WHEN x.f = 'canada' THEN 'CA'
    WHEN x.f IN ('brazil', 'brasil') THEN 'BR'
    WHEN x.f IN ('mexico', 'estados unidos mexicanos') THEN 'MX'
    ELSE 'raw:' || x.f
  END
  FROM (SELECT public.prospect_fold(p) AS f) x;
$$;
COMMENT ON FUNCTION public.prospect_country_code(text) IS
  '000933: country key: US/CA/BR/MX for mapped countries, raw:<folded name> otherwise, NULL when blank. Internal.';

-- Region key on both sides of the match.
--   known country (US/CA/BR/MX): any alias of that country -> 'CC:CODE'
--     (codes, full names, common abbreviations such as Alta, Qro, CDMX).
--   no country: codes and full names only, and only those that name a state
--     in exactly one of US/CA/BR/MX. Codes/names valid in two of them (AL, BC,
--     DF, Distrito Federal, MA, MS, MT, NL, PA, PE, PR, QUE, SC) and 'CA'
--     (California, but also Canada's code) stay raw: until a country is set.
--     Country-specific abbreviations (Alta, Qro, CDMX, ...) are not guessed.
--   other country, or no match: 'raw:<folded state>'.
CREATE OR REPLACE FUNCTION public.prospect_region_key(p_state text, p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH v AS (
    SELECT public.prospect_fold(p_state) AS s, public.prospect_country_code(p_country) AS cc
  )
  SELECT CASE
    WHEN v.s IS NULL THEN NULL
    WHEN v.cc IS NULL THEN coalesce('{"ab":"CA:AB","ac":"BR:AC","acre":"BR:AC","agu":"MX:AGU","aguascalientes":"MX:AGU","ak":"US:AK","alabama":"US:AL","alagoas":"BR:AL","alaska":"US:AK","alberta":"CA:AB","am":"BR:AM","amapa":"BR:AP","amazonas":"BR:AM","ap":"BR:AP","ar":"US:AR","arizona":"US:AZ","arkansas":"US:AR","az":"US:AZ","ba":"BR:BA","bahia":"BR:BA","baja california":"MX:BCN","baja california sur":"MX:BCS","bcn":"MX:BCN","bcs":"MX:BCS","british columbia":"CA:BC","california":"US:CA","cam":"MX:CAM","campeche":"MX:CAM","ce":"BR:CE","ceara":"BR:CE","chh":"MX:CHH","chiapas":"MX:CHP","chihuahua":"MX:CHH","chp":"MX:CHP","ciudad de mexico":"MX:CMX","cmx":"MX:CMX","co":"US:CO","coa":"MX:COA","coahuila":"MX:COA","col":"MX:COL","colima":"MX:COL","colorado":"US:CO","connecticut":"US:CT","ct":"US:CT","dc":"US:DC","de":"US:DE","delaware":"US:DE","district of columbia":"US:DC","dur":"MX:DUR","durango":"MX:DUR","es":"BR:ES","espirito santo":"BR:ES","estado de mexico":"MX:MEX","fl":"US:FL","florida":"US:FL","ga":"US:GA","georgia":"US:GA","go":"BR:GO","goias":"BR:GO","gro":"MX:GRO","gua":"MX:GUA","guanajuato":"MX:GUA","guerrero":"MX:GRO","hawaii":"US:HI","hi":"US:HI","hid":"MX:HID","hidalgo":"MX:HID","ia":"US:IA","id":"US:ID","idaho":"US:ID","il":"US:IL","illinois":"US:IL","in":"US:IN","indiana":"US:IN","iowa":"US:IA","jal":"MX:JAL","jalisco":"MX:JAL","kansas":"US:KS","kentucky":"US:KY","ks":"US:KS","ky":"US:KY","la":"US:LA","louisiana":"US:LA","maine":"US:ME","manitoba":"CA:MB","maranhao":"BR:MA","maryland":"US:MD","massachusetts":"US:MA","mato grosso":"BR:MT","mato grosso do sul":"BR:MS","mb":"CA:MB","md":"US:MD","me":"US:ME","mex":"MX:MEX","mg":"BR:MG","mi":"US:MI","mic":"MX:MIC","michigan":"US:MI","michoacan":"MX:MIC","minas gerais":"BR:MG","minnesota":"US:MN","mississippi":"US:MS","missouri":"US:MO","mn":"US:MN","mo":"US:MO","montana":"US:MT","mor":"MX:MOR","morelos":"MX:MOR","nay":"MX:NAY","nayarit":"MX:NAY","nb":"CA:NB","nc":"US:NC","nd":"US:ND","ne":"US:NE","nebraska":"US:NE","nevada":"US:NV","new brunswick":"CA:NB","new hampshire":"US:NH","new jersey":"US:NJ","new mexico":"US:NM","new york":"US:NY","newfoundland and labrador":"CA:NL","nh":"US:NH","nj":"US:NJ","nle":"MX:NLE","nm":"US:NM","north carolina":"US:NC","north dakota":"US:ND","northwest territories":"CA:NT","nova scotia":"CA:NS","ns":"CA:NS","nt":"CA:NT","nu":"CA:NU","nuevo leon":"MX:NLE","nunavut":"CA:NU","nv":"US:NV","ny":"US:NY","oax":"MX:OAX","oaxaca":"MX:OAX","oh":"US:OH","ohio":"US:OH","ok":"US:OK","oklahoma":"US:OK","on":"CA:ON","ontario":"CA:ON","or":"US:OR","oregon":"US:OR","para":"BR:PA","paraiba":"BR:PB","parana":"BR:PR","pb":"BR:PB","pennsylvania":"US:PA","pernambuco":"BR:PE","pi":"BR:PI","piaui":"BR:PI","prince edward island":"CA:PE","pue":"MX:PUE","puebla":"MX:PUE","puerto rico":"US:PR","qc":"CA:QC","quebec":"CA:QC","queretaro":"MX:QUE","quintana roo":"MX:ROO","rhode island":"US:RI","ri":"US:RI","rio de janeiro":"BR:RJ","rio grande do norte":"BR:RN","rio grande do sul":"BR:RS","rj":"BR:RJ","rn":"BR:RN","ro":"BR:RO","rondonia":"BR:RO","roo":"MX:ROO","roraima":"BR:RR","rr":"BR:RR","rs":"BR:RS","san luis potosi":"MX:SLP","santa catarina":"BR:SC","sao paulo":"BR:SP","saskatchewan":"CA:SK","sd":"US:SD","se":"BR:SE","sergipe":"BR:SE","sin":"MX:SIN","sinaloa":"MX:SIN","sk":"CA:SK","slp":"MX:SLP","son":"MX:SON","sonora":"MX:SON","south carolina":"US:SC","south dakota":"US:SD","sp":"BR:SP","tab":"MX:TAB","tabasco":"MX:TAB","tam":"MX:TAM","tamaulipas":"MX:TAM","tennessee":"US:TN","texas":"US:TX","tla":"MX:TLA","tlaxcala":"MX:TLA","tn":"US:TN","to":"BR:TO","tocantins":"BR:TO","tx":"US:TX","ut":"US:UT","utah":"US:UT","va":"US:VA","ver":"MX:VER","veracruz":"MX:VER","vermont":"US:VT","virginia":"US:VA","vt":"US:VT","wa":"US:WA","washington":"US:WA","west virginia":"US:WV","wi":"US:WI","wisconsin":"US:WI","wv":"US:WV","wy":"US:WY","wyoming":"US:WY","yt":"CA:YT","yuc":"MX:YUC","yucatan":"MX:YUC","yukon":"CA:YT","zac":"MX:ZAC","zacatecas":"MX:ZAC"}'::jsonb ->> v.s, 'raw:' || v.s)
    WHEN v.cc LIKE 'raw:%' THEN 'raw:' || v.s
    ELSE coalesce(v.cc || ':' || ('{"BR|ac":"AC","BR|acre":"AC","BR|al":"AL","BR|alagoas":"AL","BR|am":"AM","BR|amapa":"AP","BR|amazonas":"AM","BR|ap":"AP","BR|ba":"BA","BR|bahia":"BA","BR|ce":"CE","BR|ceara":"CE","BR|df":"DF","BR|distrito federal":"DF","BR|es":"ES","BR|espirito santo":"ES","BR|go":"GO","BR|goias":"GO","BR|ma":"MA","BR|maranhao":"MA","BR|mato grosso":"MT","BR|mato grosso do sul":"MS","BR|mg":"MG","BR|minas gerais":"MG","BR|ms":"MS","BR|mt":"MT","BR|pa":"PA","BR|para":"PA","BR|paraiba":"PB","BR|parana":"PR","BR|pb":"PB","BR|pe":"PE","BR|pernambuco":"PE","BR|pi":"PI","BR|piaui":"PI","BR|pr":"PR","BR|rio de janeiro":"RJ","BR|rio grande do norte":"RN","BR|rio grande do sul":"RS","BR|rj":"RJ","BR|rn":"RN","BR|ro":"RO","BR|rondonia":"RO","BR|roraima":"RR","BR|rr":"RR","BR|rs":"RS","BR|santa catarina":"SC","BR|sao paulo":"SP","BR|sc":"SC","BR|se":"SE","BR|sergipe":"SE","BR|sp":"SP","BR|to":"TO","BR|tocantins":"TO","CA|ab":"AB","CA|alberta":"AB","CA|alta":"AB","CA|bc":"BC","CA|british columbia":"BC","CA|colombie britannique":"BC","CA|ile du prince edouard":"PE","CA|man":"MB","CA|manitoba":"MB","CA|mb":"MB","CA|nb":"NB","CA|new brunswick":"NB","CA|newfoundland":"NL","CA|newfoundland and labrador":"NL","CA|nfld":"NL","CA|nl":"NL","CA|northwest territories":"NT","CA|nouveau brunswick":"NB","CA|nouvelle ecosse":"NS","CA|nova scotia":"NS","CA|ns":"NS","CA|nt":"NT","CA|nu":"NU","CA|nunavut":"NU","CA|nwt":"NT","CA|on":"ON","CA|ont":"ON","CA|ontario":"ON","CA|pe":"PE","CA|pei":"PE","CA|pq":"QC","CA|prince edward island":"PE","CA|province of quebec":"QC","CA|qc":"QC","CA|que":"QC","CA|quebec":"QC","CA|sask":"SK","CA|saskatchewan":"SK","CA|sk":"SK","CA|terre neuve et labrador":"NL","CA|territoires du nord ouest":"NT","CA|yt":"YT","CA|yukon":"YT","CA|yukon territory":"YT","MX|ags":"AGU","MX|agu":"AGU","MX|aguascalientes":"AGU","MX|b c":"BCN","MX|b c s":"BCS","MX|baja california":"BCN","MX|baja california sur":"BCS","MX|bc":"BCN","MX|bcn":"BCN","MX|bcs":"BCS","MX|cam":"CAM","MX|camp":"CAM","MX|campeche":"CAM","MX|cdmx":"CMX","MX|chh":"CHH","MX|chiapas":"CHP","MX|chih":"CHH","MX|chihuahua":"CHH","MX|chis":"CHP","MX|chp":"CHP","MX|ciudad de mexico":"CMX","MX|cmx":"CMX","MX|coa":"COA","MX|coah":"COA","MX|coahuila":"COA","MX|coahuila de zaragoza":"COA","MX|col":"COL","MX|colima":"COL","MX|d f":"CMX","MX|df":"CMX","MX|dgo":"DUR","MX|distrito federal":"CMX","MX|dur":"DUR","MX|durango":"DUR","MX|edo de mexico":"MEX","MX|edo mex":"MEX","MX|edomex":"MEX","MX|estado de mexico":"MEX","MX|gro":"GRO","MX|gto":"GUA","MX|gua":"GUA","MX|guanajuato":"GUA","MX|guerrero":"GRO","MX|hgo":"HID","MX|hid":"HID","MX|hidalgo":"HID","MX|jal":"JAL","MX|jalisco":"JAL","MX|mex":"MEX","MX|mexico city":"CMX","MX|mexico df":"CMX","MX|mexico state":"MEX","MX|mic":"MIC","MX|mich":"MIC","MX|michoacan":"MIC","MX|michoacan de ocampo":"MIC","MX|mor":"MOR","MX|morelos":"MOR","MX|n l":"NLE","MX|nay":"NAY","MX|nayarit":"NAY","MX|nl":"NLE","MX|nle":"NLE","MX|nuevo leon":"NLE","MX|oax":"OAX","MX|oaxaca":"OAX","MX|pue":"PUE","MX|puebla":"PUE","MX|q roo":"ROO","MX|qro":"QUE","MX|qroo":"ROO","MX|que":"QUE","MX|queretaro":"QUE","MX|queretaro de arteaga":"QUE","MX|quintana roo":"ROO","MX|roo":"ROO","MX|san luis potosi":"SLP","MX|sin":"SIN","MX|sinaloa":"SIN","MX|slp":"SLP","MX|son":"SON","MX|sonora":"SON","MX|state of mexico":"MEX","MX|tab":"TAB","MX|tabasco":"TAB","MX|tam":"TAM","MX|tamaulipas":"TAM","MX|tamps":"TAM","MX|tla":"TLA","MX|tlax":"TLA","MX|tlaxcala":"TLA","MX|ver":"VER","MX|veracruz":"VER","MX|veracruz de ignacio de la llave":"VER","MX|yuc":"YUC","MX|yucatan":"YUC","MX|zac":"ZAC","MX|zacatecas":"ZAC","US|ak":"AK","US|al":"AL","US|alabama":"AL","US|alaska":"AK","US|ar":"AR","US|arizona":"AZ","US|arkansas":"AR","US|az":"AZ","US|ca":"CA","US|california":"CA","US|co":"CO","US|colorado":"CO","US|connecticut":"CT","US|ct":"CT","US|dc":"DC","US|de":"DE","US|delaware":"DE","US|district of columbia":"DC","US|fl":"FL","US|florida":"FL","US|ga":"GA","US|georgia":"GA","US|hawaii":"HI","US|hi":"HI","US|ia":"IA","US|id":"ID","US|idaho":"ID","US|il":"IL","US|illinois":"IL","US|in":"IN","US|indiana":"IN","US|iowa":"IA","US|kansas":"KS","US|kentucky":"KY","US|ks":"KS","US|ky":"KY","US|la":"LA","US|louisiana":"LA","US|ma":"MA","US|maine":"ME","US|maryland":"MD","US|massachusetts":"MA","US|md":"MD","US|me":"ME","US|mi":"MI","US|michigan":"MI","US|minnesota":"MN","US|mississippi":"MS","US|missouri":"MO","US|mn":"MN","US|mo":"MO","US|montana":"MT","US|ms":"MS","US|mt":"MT","US|nc":"NC","US|nd":"ND","US|ne":"NE","US|nebraska":"NE","US|nevada":"NV","US|new hampshire":"NH","US|new jersey":"NJ","US|new mexico":"NM","US|new york":"NY","US|nh":"NH","US|nj":"NJ","US|nm":"NM","US|north carolina":"NC","US|north dakota":"ND","US|nv":"NV","US|ny":"NY","US|oh":"OH","US|ohio":"OH","US|ok":"OK","US|oklahoma":"OK","US|or":"OR","US|oregon":"OR","US|pa":"PA","US|pennsylvania":"PA","US|pr":"PR","US|puerto rico":"PR","US|rhode island":"RI","US|ri":"RI","US|sc":"SC","US|sd":"SD","US|south carolina":"SC","US|south dakota":"SD","US|tennessee":"TN","US|texas":"TX","US|tn":"TN","US|tx":"TX","US|ut":"UT","US|utah":"UT","US|va":"VA","US|vermont":"VT","US|virginia":"VA","US|vt":"VT","US|wa":"WA","US|washington":"WA","US|west virginia":"WV","US|wi":"WI","US|wisconsin":"WI","US|wv":"WV","US|wy":"WY","US|wyoming":"WY"}'::jsonb ->> (v.cc || '|' || v.s)), 'raw:' || v.s)
  END
  FROM v;
$$;
COMMENT ON FUNCTION public.prospect_region_key(text, text) IS
  '000933: state/province key CC:CODE for US/CA/BR/MX (codes, names, abbreviations; accent-insensitive), else raw:<folded>. Internal.';

-- ---------------------------------------------------------------------------
-- prospect_pool_rows_local(org, viewer country, viewer region key, viewer city key)  [internal]
-- Same pool as 000929 prospect_pool_rows (imported pool + own linked laser
-- clinics), ranked with the normalized keys:
--   0  same city key, country compatible, and the state keys are equal, or
--      either side is blank, or either side is unrecognised (raw:) -> the
--      city + country fallback;
--   1  same region key, country compatible;
--   2  same country;
--   NULL elsewhere.
-- p_country is the viewer's country KEY (prospect_country_code). "Country
-- compatible": viewer country NULL, or equal country keys.
-- DROP first: the return row gained country_key during review, and CREATE OR
-- REPLACE cannot change a return type. Only find_clinic_prospects calls it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.prospect_pool_rows_local(bigint, text, text, text);
CREATE FUNCTION public.prospect_pool_rows_local(p_org bigint, p_country text, p_region text, p_city_key text)
RETURNS TABLE (id bigint, name text, linked boolean, rank int, country text, country_key text, city text, city_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH links AS (
    SELECT oc.customer_organization_id AS id
      FROM public.organization_customers oc
     WHERE oc.service_organization_id = p_org
  ),
  ids AS (
    SELECT o.id FROM public.organizations o WHERE o.prospect_pool IS NOT NULL
    UNION
    SELECT l.id FROM links l
  ),
  base AS (
    SELECT o.id, o.name, (l.id IS NOT NULL) AS linked, o.country, o.state, o.city
      FROM ids
      JOIN public.organizations o ON o.id = ids.id
      LEFT JOIN links l ON l.id = o.id
     WHERE o.id <> p_org
       AND o.is_active IS DISTINCT FROM false
       AND (o.prospect_pool IS NOT NULL OR lower(coalesce(o.type, '')) = 'laser_clinic')
  ),
  -- Keys are computed once per distinct (state, country) and per distinct
  -- city, not once per row: the helpers are SECURITY DEFINER with a SET
  -- clause, so they are never inlined and each call has a fixed cost.
  skeys AS (
    SELECT d.state, d.country, public.prospect_region_key(d.state, d.country) AS region
      FROM (SELECT DISTINCT b.state, coalesce(b.country, '') AS country FROM base b WHERE b.state IS NOT NULL) d
  ),
  cokeys AS (
    SELECT d.country, public.prospect_country_code(d.country) AS country_key
      FROM (SELECT DISTINCT b.country FROM base b WHERE b.country IS NOT NULL) d
  ),
  ckeys AS (
    SELECT d.city, public.prospect_city_key(d.city) AS city_key
      FROM (SELECT DISTINCT b.city FROM base b WHERE b.city IS NOT NULL) d
  ),
  keyed AS (
    SELECT b.id, b.name, b.linked, b.country, co.country_key,
           nullif(pg_catalog.btrim(coalesce(b.city, '')), '') AS city,
           ck.city_key,
           sk.region,
           (p_country IS NULL OR co.country_key = p_country) AS country_ok
      FROM base b
      LEFT JOIN skeys sk ON sk.state = b.state AND sk.country = coalesce(b.country, '')
      LEFT JOIN ckeys ck ON ck.city = b.city
      LEFT JOIN cokeys co ON co.country = b.country
  )
  SELECT k.id, k.name, k.linked,
         CASE
           WHEN p_city_key IS NOT NULL AND k.city_key = p_city_key AND k.country_ok
                AND (p_region IS NULL OR k.region IS NULL OR k.region = p_region
                     OR p_region LIKE 'raw:%' OR k.region LIKE 'raw:%') THEN 0
           WHEN p_region IS NOT NULL AND k.region = p_region AND k.country_ok THEN 1
           WHEN p_country IS NOT NULL AND k.country_key = p_country THEN 2
           ELSE NULL
         END AS rank,
         k.country, k.country_key, k.city, k.city_key
    FROM keyed k;
$$;
COMMENT ON FUNCTION public.prospect_pool_rows_local(bigint, text, text, text) IS
  '000933: internal pool for find_clinic_prospects with normalized state/city keys and city+country fallback. Not client-callable.';

-- ---------------------------------------------------------------------------
-- find_clinic_prospects: same contract as 000929, plus
--   * viewer region/city keys from the helpers above;
--   * Premium p_city compares by city key; city_counts and Free area_counts
--     group by city key and show the most common spelling;
--   * viewer.has_location / viewer.country_pool for the empty-state copy;
--   * countries compare by prospect_country_code() (ranking, country_pool,
--     Premium p_country filter; country_counts group by key and show the
--     most common spelling).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_clinic_prospects(
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org bigint;
  v_type text;
  v_country text;
  v_ckey text;
  v_state text;
  v_city text;
  v_has_location boolean;
  v_country_pool int;
  v_paid boolean;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := least(greatest(coalesce(p_offset, 0), 0), 50000);
  v_fcountry text := public.prospect_country_code(p_country);
  v_fcity text := public.prospect_city_key(p_city);
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  v_org := public.get_my_org_id();
  IF v_org IS NULL OR NOT public.is_active_org_member(v_org) THEN
    RETURN jsonb_build_object('error', 'no_org');
  END IF;
  SELECT lower(btrim(coalesce(o.type, ''))), nullif(btrim(coalesce(o.country, '')), ''),
         public.prospect_country_code(o.country),
         public.prospect_region_key(o.state, o.country), public.prospect_city_key(o.city),
         (nullif(btrim(coalesce(o.country, '')), '') IS NOT NULL
          OR nullif(btrim(coalesce(o.state, '')), '') IS NOT NULL
          OR nullif(btrim(coalesce(o.city, '')), '') IS NOT NULL)
    INTO v_type, v_country, v_ckey, v_state, v_city, v_has_location
    FROM public.organizations o WHERE o.id = v_org;
  IF v_type IS DISTINCT FROM 'service_company' THEN
    RETURN jsonb_build_object('error', 'not_service_org');
  END IF;
  v_paid := public.org_is_paid_entitled(v_org);

  IF NOT v_paid THEN
    WITH pool AS MATERIALIZED (
      SELECT * FROM public.prospect_pool_rows_local(v_org, v_ckey, v_state, v_city)
    ),
    chosen AS (
      SELECT p.id, p.linked, p.rank FROM pool p WHERE p.rank IS NOT NULL
       ORDER BY p.rank, p.id LIMIT 20
    ),
    rest AS (
      SELECT p.* FROM pool p WHERE NOT EXISTS (SELECT 1 FROM chosen c WHERE c.id = p.id)
    ),
    area AS (
      SELECT mode() WITHIN GROUP (ORDER BY r.country) AS country,
             mode() WITHIN GROUP (ORDER BY r.city) AS city, count(*)::int AS n
        FROM rest r GROUP BY r.country_key, r.city_key
    )
    SELECT jsonb_build_object(
      'tier', 'free',
      'total', (SELECT count(*)::int FROM pool),
      'clinics', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'name', o.name, 'type', o.type, 'address', o.address, 'city', o.city,
          'state', o.state, 'zip', o.zip, 'country', o.country, 'phone', o.phone,
          'email', o.email, 'website', o.website, 'contact_name', o.contact_name,
          'laser_models', o.laser_models, 'facility_type', o.facility_type,
          'is_customer', c.linked, 'local', true) ORDER BY c.rank, c.id), '[]'::jsonb)
        FROM chosen c JOIN public.organizations o ON o.id = c.id),
      'country_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('country', x.country, 'count', x.n)
          ORDER BY x.n DESC, x.country NULLS LAST), '[]'::jsonb)
        FROM (SELECT mode() WITHIN GROUP (ORDER BY r.country) AS country, count(*)::int AS n FROM rest r GROUP BY r.country_key) x),
      'area_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('country', y.country, 'city', y.city, 'count', y.n)
          ORDER BY y.n DESC, y.country NULLS LAST, y.city NULLS LAST), '[]'::jsonb)
        FROM (SELECT * FROM area a ORDER BY a.n DESC, a.country NULLS LAST, a.city NULLS LAST LIMIT 300) y),
      'locked', (SELECT jsonb_build_object(
          'area', count(*) FILTER (WHERE r.rank IN (0, 1))::int,
          'total', count(*)::int) FROM rest r),
      'free_limit', 20,
      'page', jsonb_build_object('limit', 20, 'offset', 0, 'filtered_total', (SELECT count(*)::int FROM chosen), 'has_more', false),
      'country_pool', CASE WHEN v_ckey IS NULL THEN NULL
                           ELSE (SELECT count(*)::int FROM pool p WHERE p.country_key = v_ckey) END
    ) INTO v_out;
  ELSE
    WITH pool AS MATERIALIZED (
      SELECT * FROM public.prospect_pool_rows_local(v_org, v_ckey, v_state, v_city)
    ),
    filtered AS (
      SELECT p.* FROM pool p
       WHERE (v_fcountry IS NULL OR p.country_key = v_fcountry)
         AND (v_fcity IS NULL OR p.city_key = v_fcity)
    ),
    page AS (
      SELECT f.id, f.linked, f.rank, row_number() OVER (ORDER BY coalesce(f.rank, 9), f.name, f.id) AS pos
        FROM filtered f
       ORDER BY coalesce(f.rank, 9), f.name, f.id
       OFFSET v_offset LIMIT v_limit
    ),
    ftotal AS (SELECT count(*)::int AS n FROM filtered)
    SELECT jsonb_build_object(
      'tier', 'premium',
      'total', (SELECT count(*)::int FROM pool),
      'clinics', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'name', o.name, 'type', o.type, 'address', o.address, 'city', o.city,
          'state', o.state, 'zip', o.zip, 'country', o.country, 'phone', o.phone,
          'email', o.email, 'website', o.website, 'contact_name', o.contact_name,
          'laser_models', o.laser_models, 'facility_type', o.facility_type,
          'is_customer', pg.linked, 'local', pg.rank IS NOT NULL) ORDER BY pg.pos), '[]'::jsonb)
        FROM page pg JOIN public.organizations o ON o.id = pg.id),
      'country_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('country', x.country, 'count', x.n)
          ORDER BY x.n DESC, x.country NULLS LAST), '[]'::jsonb)
        FROM (SELECT mode() WITHIN GROUP (ORDER BY p.country) AS country, count(*)::int AS n FROM pool p GROUP BY p.country_key) x),
      'city_counts', (SELECT coalesce(jsonb_agg(jsonb_build_object('city', y.city, 'count', y.n)
          ORDER BY y.n DESC, y.city), '[]'::jsonb)
        FROM (SELECT mode() WITHIN GROUP (ORDER BY p.city) AS city, count(*)::int AS n FROM pool p
               WHERE p.city_key IS NOT NULL AND (v_fcountry IS NULL OR p.country_key = v_fcountry)
               GROUP BY p.city_key ORDER BY count(*) DESC, p.city_key LIMIT 300) y),
      'area_counts', '[]'::jsonb,
      'locked', NULL,
      'free_limit', 20,
      'page', jsonb_build_object('limit', v_limit, 'offset', v_offset,
                                 'filtered_total', (SELECT n FROM ftotal),
                                 'has_more', v_offset + v_limit < (SELECT n FROM ftotal)),
      'country_pool', CASE WHEN v_ckey IS NULL THEN NULL
                           ELSE (SELECT count(*)::int FROM pool p WHERE p.country_key = v_ckey) END
    ) INTO v_out;
  END IF;

  RETURN (v_out - 'country_pool') || jsonb_build_object('viewer', jsonb_build_object(
    'country', v_country, 'state', v_state, 'city', v_city,
    'has_location', coalesce(v_has_location, false),
    'country_pool', v_out -> 'country_pool'));
END;
$$;
COMMENT ON FUNCTION public.find_clinic_prospects(text, text, int, int) IS
  '000933: Find clinics for service_company members. Server-side filter/page (max 100)/aggregates; normalized state/city keys. Free = 20 local rows + counts; Premium = paged rows.';

REVOKE ALL ON FUNCTION public.prospect_fold(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_city_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_country_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_region_key(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_pool_rows_local(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_clinic_prospects(text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_clinic_prospects(text, text, int, int) TO authenticated;

COMMIT;
