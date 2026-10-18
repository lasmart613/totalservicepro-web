CREATE FUNCTION pg_temp.s1(a text, b text, c text, d text, e text, f text) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT public.directory_registration_step1(a, b, c, d, e, nullif(f, ''), gen_random_uuid()) $$;
CREATE FUNCTION pg_temp.cool() RETURNS void LANGUAGE sql AS
  $$ UPDATE public.directory_registration_attempts SET taken_at = taken_at - interval '1 day 1 minute' WHERE key_kind = 'global' $$;
-- privileges
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.directory_registration_step1(text,text,text,text,text,text,uuid)','EXECUTE'), 'anon cannot run step1');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.directory_registration_step1(text,text,text,text,text,text,uuid)','EXECUTE'), 'authenticated cannot run step1');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.directory_registration_step2(uuid,jsonb)','EXECUTE'), 'anon cannot run step2');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.directory_find_duplicate(text,text,text,bigint)','EXECUTE'), 'authenticated cannot run find_duplicate');
SELECT pg_temp.ok(has_function_privilege('service_role','public.directory_registration_step2(uuid,jsonb)','EXECUTE'), 'service_role can run step2');
SELECT pg_temp.ok(NOT has_table_privilege(r,'public.directory_registrations','SELECT') AND NOT has_table_privilege(r,'public.directory_registration_attempts','INSERT'), 'no table privilege for '||r)
  FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT pg_temp.ok(bool_and(prosecdef) AND bool_and(proconfig @> ARRAY['search_path=""']), 'all functions definer + empty search_path')
  FROM pg_proc WHERE proname LIKE 'directory\_%';
SELECT pg_temp.ok(NOT has_table_privilege(r,'public.directory_form_tickets','SELECT'), 'no ticket table privilege for '||r) FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.directory_registrations'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.directory_registration_attempts'::regclass), 'RLS on both tables');
SET ROLE anon;
DO $$ BEGIN PERFORM pg_temp.s1('X Co','service','a@b.com',NULL,NULL,'ip'); RAISE WARNING 'FAILED anon call runs';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon call is 42501'; END $$;
RESET ROLE;

SET ROLE service_role;
CREATE TEMP TABLE r1 AS SELECT pg_temp.s1(' Delta Laser Repair ','service','Pat@DeltaLaser.com','az','85004','ip-a') AS j;
RESET ROLE;
SELECT pg_temp.ok((SELECT j->>'status' FROM r1)='created', 'step1 creates');
SELECT pg_temp.ok(o.type='service_company' AND o.is_active=false AND o.list_in_directory=false AND o.is_premium=false
  AND o.email='pat@deltalaser.com' AND o.state='AZ' AND o.zip='85004' AND o.name='Delta Laser Repair' AND o.created_by IS NULL,
  'pending org: unlisted, inactive, normalized')
  FROM public.organizations o WHERE o.id=(SELECT organization_id FROM public.directory_registrations WHERE id=(SELECT (j->>'registration_id')::uuid FROM r1));
SELECT pg_temp.ok((SELECT NOT (j ? 'organization_id') FROM r1), 'step1 never returns an org id');
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE list_in_directory AND is_active IS DISTINCT FROM false AND id > 3)=0, 'nothing new is listed');

SET ROLE service_role;
SELECT pg_temp.ok((pg_temp.s1('Echo Parts','supplier','e@echo-parts.com',NULL,NULL,'ip-b')->>'status')='created', 'supplier ok');
SELECT pg_temp.ok((pg_temp.s1('Fox Rentals','rental','f@foxrent.com',NULL,NULL,'ip-b')->>'status')='created', 'rental ok');
SELECT pg_temp.ok((pg_temp.s1('Golf Derm Clinic','clinic','g@golfderm.com',NULL,NULL,'ip-b')->>'status')='created', 'clinic ok');
RESET ROLE;
SELECT pg_temp.ok((SELECT string_agg(type, ',' ORDER BY id) FROM public.organizations WHERE name IN ('Echo Parts','Fox Rentals','Golf Derm Clinic'))
  = 'parts_supplier,laser_rental,laser_clinic', 'org type mapping');

SET ROLE service_role;
SELECT pg_temp.ok((pg_temp.s1('Bad','vendor','x@y.com',NULL,NULL,'ip-c')->>'reason')='invalid', 'unknown kind rejected');
SELECT pg_temp.ok((pg_temp.s1('Okay Co','service','not-an-email',NULL,NULL,'ip-c')->>'reason')='invalid', 'bad email rejected');
SELECT pg_temp.ok((pg_temp.s1('Okay Co','service','a@okay.com','Arizona',NULL,'ip-c')->>'reason')='invalid', 'bad state rejected');
SELECT pg_temp.ok((pg_temp.s1('Okay Co','service','a@okay.com',NULL,'8500','ip-c')->>'reason')='invalid', 'bad zip rejected');
SELECT pg_temp.ok((pg_temp.s1('Okay Co','service','a@okay.com',NULL,NULL,'')->>'status')='created', 'no IP: allowed (email + global caps still apply)');
SELECT pg_temp.ok((pg_temp.s1('Inc.','service','a@okay2.com',NULL,NULL,'ip-c')->>'reason')='invalid', 'name of only suffixes rejected');

-- dedupe
CREATE TEMP TABLE dup AS SELECT pg_temp.s1('ACME laser service LLC','service','new@acmelaser.com',NULL,NULL,'ip-d') j;
GRANT SELECT ON dup TO service_role;
SELECT pg_temp.ok((j - 'registration_id') = '{"ok": true, "status": "created"}'::jsonb AND (j->>'registration_id') ~ '^[0-9a-f-]{36}$', 'M-2: dupe by name+email domain answers exactly like a new sign-up') FROM dup;
SELECT pg_temp.ok((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(j) k) = (SELECT array_agg(k ORDER BY k) FROM r1, jsonb_object_keys(r1.j) k), 'M-2: same reply keys for match and miss') FROM dup;
SELECT pg_temp.ok((pg_temp.s1('the beta medical parts','supplier','x@betaparts.com',NULL,NULL,'ip-d') - 'registration_id') = '{"ok": true, "status": "created"}'::jsonb, 'dupe by website host: same created reply');
SELECT pg_temp.ok((pg_temp.s1('Acme Laser Service','service','someone@gmail.com',NULL,NULL,'ip-e')->>'status')='created', 'free-mail domain is not a dedupe key');
SELECT pg_temp.ok((pg_temp.s1('Acme Imaging','service','new2@acmelaser.com',NULL,NULL,'ip-e')->>'status')='created', 'same domain, different name is not a dupe');
SELECT pg_temp.ok((pg_temp.s1('Delta Laser Repair','service','pat@deltalaser.com',NULL,NULL,'ip-f')->>'status')='created', 'repeat sign-up -> same created reply, no second org');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE directory_norm_name(name)='delta laser repair')=1, 'one Delta org');
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE directory_norm_name(name)='acme laser service')=2, 'review created no org');
SELECT pg_temp.ok((SELECT matched_organization_id FROM public.directory_registrations WHERE email_norm='new@acmelaser.com')=1, 'match kept server-side for review');
SELECT pg_temp.ok(organization_id IS NULL AND status='possible_duplicate' AND step=1 AND company_name='ACME laser service LLC', 'match row: no org, awaiting step 2') FROM public.directory_registrations WHERE email_norm='new@acmelaser.com';
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step2((SELECT (j->>'registration_id')::uuid FROM dup), '{"contact_name":"Mallory","phone":"805-555-0100","city":"Ojai","name":"Hijack","list_in_directory":true}')->>'status')='received', 'M-2: step 2 on a match answers received');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT (j->>'registration_id')::uuid FROM dup), '{"phone":"1"}')->>'reason')='expired', 'match step 2 is single use');
RESET ROLE;
SELECT pg_temp.ok(details->>'contact_name'='Mallory' AND details->>'city'='Ojai' AND NOT details ? 'name' AND NOT details ? 'list_in_directory' AND step=2, 'match step 2 saved details on the registration only') FROM public.directory_registrations WHERE email_norm='new@acmelaser.com';
SELECT pg_temp.ok((SELECT name||'|'||coalesce(contact_name,'-')||'|'||coalesce(phone,'-') FROM public.organizations WHERE id=1)='Acme Laser Service, Inc.|-|(805) 555-0100', 'M-2: the matched live org is untouched');
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step2(gen_random_uuid(), '{"contact_name":"Bot"}')->>'status')='received', 'honeypot decoy id: same received answer');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.directory_registrations WHERE details->>'contact_name'='Bot'), 'decoy step 2 wrote nothing');
SELECT pg_temp.cool();

-- rate limits
SELECT pg_temp.cool();
SET ROLE service_role;
SELECT pg_temp.s1('RL '||i,'service','rl'||i||'@rl'||i||'.com',NULL,NULL,'ip-rl') FROM generate_series(1,5) i;
SELECT pg_temp.ok((pg_temp.s1('RL 6','service','rl6@rl6.com',NULL,NULL,'ip-rl')->>'reason')='rate_limited', '6th from one IP in 10 min is limited');
SELECT pg_temp.ok((pg_temp.s1('RL 7','service','rl7@rl7.com',NULL,NULL,'ip-rl2')->>'status')='created', 'other IP unaffected');
SELECT pg_temp.s1('Em '||i,'service','same@em.com',NULL,NULL,'ip-em'||i) FROM generate_series(1,3) i;
SELECT pg_temp.ok((pg_temp.s1('Em 4','service','SAME@em.com',NULL,NULL,'ip-em4')->>'reason')='rate_limited', '4th for one email per day is limited (case-insensitive)');
RESET ROLE;
UPDATE public.directory_registration_attempts SET taken_at = taken_at - interval '11 minutes' WHERE key_value='ip-rl';
SET ROLE service_role;
SELECT pg_temp.ok((pg_temp.s1('RL 8','service','rl8@rl8.com',NULL,NULL,'ip-rl')->>'status')='created', 'IP window slides after 10 min');
RESET ROLE;
INSERT INTO public.directory_registration_attempts (key_kind,key_value,taken_at) SELECT 'ip','ip-day',now()-interval '1 hour' FROM generate_series(1,20);
SET ROLE service_role;
SELECT pg_temp.ok((pg_temp.s1('Day','service','d@day.com',NULL,NULL,'ip-day')->>'reason')='rate_limited', '20 per IP per day');
RESET ROLE;
INSERT INTO public.directory_registration_attempts (key_kind,key_value,taken_at) VALUES ('ip','old',now()-interval '2 days');
SET ROLE service_role;
SELECT pg_temp.s1('Cleanup','service','c@cleanup.com',NULL,NULL,'ip-clean');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.directory_registration_attempts WHERE key_value='old'), 'expired attempts pruned');
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE name='RL 6')=0, 'limited call created nothing');
-- M-1: email variants share one key
SELECT pg_temp.cool();
SET ROLE service_role;
SELECT pg_temp.s1('Var '||i,'service',e,NULL,NULL,'ip-var'||i) FROM unnest(ARRAY['pat.lee@gmail.com','PatLee+1@gmail.com','p.a.t.l.e.e@googlemail.com']) WITH ORDINALITY u(e,i);
SELECT pg_temp.ok((pg_temp.s1('Var 4','service','patlee+zz@gmail.com',NULL,NULL,'ip-var4')->>'reason')='rate_limited', 'M-1: gmail dot/+tag variants count as one email');
SELECT pg_temp.s1('Fw '||i,'service',e,NULL,NULL,'ip-fw'||i) FROM unnest(ARRAY['ops@fwcorp.com','ops+a@fwcorp.com','OPS+b@fwcorp.com']) WITH ORDINALITY u(e,i);
SELECT pg_temp.ok((pg_temp.s1('Fw 3','service','ｏｐｓ@fwcorp.com',NULL,NULL,'ip-fw3')->>'reason')='rate_limited', 'M-1: fullwidth variant counts as the same email');
SELECT pg_temp.ok((pg_temp.s1('Cy','service','op'||chr(1089)||'@fwcorp.com',NULL,NULL,'ip-cy')->>'reason')='invalid', 'M-1: Cyrillic look-alike email refused');
-- M-1: no IP does not share a bucket
SELECT pg_temp.ok(bool_and((pg_temp.s1('NoIP '||i,'service','n'||i||'@noip'||i||'.com',NULL,NULL,'')->>'status')='created'), 'M-1: 8 no-IP sign-ups are not locked out together') FROM generate_series(1,8) i;
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.directory_registration_attempts WHERE key_kind='ip' AND key_value IN ('', 'unknown')), 'M-1: no shared unknown IP bucket');
-- L-2: single-use ticket
CREATE TEMP TABLE tk AS SELECT gen_random_uuid() n;
GRANT SELECT ON tk TO service_role;
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step1('Tick One','service','t1@tick1.com',NULL,NULL,'ip-tk',(SELECT n FROM tk))->>'status')='created', 'L-2: ticket first use');
SELECT pg_temp.ok((public.directory_registration_step1('Tick Two','service','t2@tick2.com',NULL,NULL,'ip-tk',(SELECT n FROM tk))->>'reason')='ticket_used', 'L-2: ticket reuse refused');
SELECT pg_temp.ok((public.directory_registration_step1('东京','service','t3@tick3.com',NULL,NULL,'ip-tk2',gen_random_uuid())->>'status')='created', 'L-1: CJK-only name registers');
SELECT pg_temp.ok((public.directory_registration_step1('!!','service','t4@tick4.com',NULL,NULL,'ip-tk3',gen_random_uuid())->>'reason')='invalid', 'L-1: name needs a letter or digit');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.directory_registration_attempts WHERE key_value='ip-tk3'), 'invalid input uses no rate-limit slot');
INSERT INTO public.directory_form_tickets VALUES (gen_random_uuid(), now() - interval '4 hours');
SET ROLE service_role; SELECT pg_temp.s1('Prune T','service','pt@prune.com',NULL,NULL,'ip-pt'); RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.directory_form_tickets WHERE used_at < now() - interval '3 hours'), 'old tickets pruned');
-- bidi stored clean
SET ROLE service_role;
SELECT pg_temp.s1('Bidi'||chr(8238)||'Co <script>alert(1)</script>','service','b@bidico.com',NULL,NULL,'ip-bd');
RESET ROLE;
SELECT pg_temp.ok(name = 'BidiCo <script>alert(1)</script>', 'bidi stripped when stored; markup kept as inert text') FROM public.organizations WHERE email='b@bidico.com';
-- M-1: global cap
SELECT pg_temp.cool();
INSERT INTO public.directory_registration_attempts (key_kind,key_value,taken_at) SELECT 'global','all',now()-interval '5 minutes' FROM generate_series(1,30);
SET ROLE service_role;
SELECT pg_temp.ok((pg_temp.s1('Glob','service','g@globcap.com',NULL,NULL,'ip-fresh-'||gen_random_uuid())->>'reason')='rate_limited', 'M-1: 31st sign-up in an hour is refused for everyone (fresh IP + email)');
RESET ROLE;
UPDATE public.directory_registration_attempts SET taken_at = now() - interval '2 hours' WHERE key_kind='global';
INSERT INTO public.directory_registration_attempts (key_kind,key_value,taken_at) SELECT 'global','all',now()-interval '3 hours' FROM generate_series(1,70);
SET ROLE service_role;
SELECT pg_temp.ok((pg_temp.s1('Glob','service','g@globcap.com',NULL,NULL,'ip-fresh2')->>'reason')='rate_limited', 'M-1: 101st in a day is refused');
RESET ROLE;
SELECT pg_temp.cool();


-- step 2
CREATE TEMP TABLE d AS SELECT (j->>'registration_id')::uuid rid, (SELECT organization_id FROM public.directory_registrations WHERE id=(j->>'registration_id')::uuid) oid FROM r1;
GRANT SELECT ON d TO service_role;
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM d),
  '{"contact_name":"Pat Lee","phone":"602-555-0123","website":"https://deltalaser.com","address":"1 Main St","city":"Phoenix","state":"az","zip":"85004",
    "brands":["Candela","Cutera"," ","Candela"],"modalities":["Aesthetic lasers","IPL"],"coverage":["AZ","NM"],"years_in_business":"12","num_techs":"4",
    "description":"Field service.","services_offered":"PM, repair",
    "type":"customer","list_in_directory":true,"is_active":true,"is_premium":true,"plan":"premium","created_by":"00000000-0000-0000-0000-000000000001","name":"Hijack"}')->>'status')='received', 'step2 accepts bound token');
RESET ROLE;
SELECT pg_temp.ok(o.contact_name='Pat Lee' AND o.phone='602-555-0123' AND o.city='Phoenix' AND o.state='AZ' AND o.years_in_business=12 AND o.num_techs=4
  AND o.supported_brands @> ARRAY['Candela','Cutera'] AND cardinality(o.supported_brands)=2 AND o.specialties=ARRAY['Aesthetic lasers','IPL'] AND o.service_territories @> ARRAY['AZ','NM'],
  'step2 fields saved') FROM public.organizations o WHERE id=(SELECT oid FROM d);
SELECT pg_temp.ok(o.type='service_company' AND NOT o.list_in_directory AND NOT o.is_active AND NOT o.is_premium AND o.plan IS NULL AND o.created_by IS NULL AND o.name='Delta Laser Repair',
  'step2 ignores type/listing/premium/owner/name keys') FROM public.organizations o WHERE id=(SELECT oid FROM d);
SELECT pg_temp.ok((SELECT name FROM public.organizations WHERE id=1)='Acme Laser Service, Inc.', 'live org untouched');
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM d), '{"phone":"1"}')->>'reason')='expired', 'step2 is single use');
RESET ROLE;
-- expiry + approved org
CREATE TEMP TABLE e AS SELECT r.id rid, r.organization_id oid FROM public.directory_registrations r JOIN public.organizations o ON o.id=r.organization_id WHERE o.name='Echo Parts';
CREATE TEMP TABLE f AS SELECT r.id rid, r.organization_id oid FROM public.directory_registrations r JOIN public.organizations o ON o.id=r.organization_id WHERE o.name='Fox Rentals';
CREATE TEMP TABLE g AS SELECT r.id rid, r.organization_id oid FROM public.directory_registrations r JOIN public.organizations o ON o.id=r.organization_id WHERE o.name='Golf Derm Clinic';
GRANT SELECT ON e, f, g TO service_role;
UPDATE public.directory_registrations SET created_at = now() - interval '2 hours 1 minute' WHERE id=(SELECT rid FROM e);
UPDATE public.organizations SET is_active = true WHERE id=(SELECT oid FROM f);
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM e),'{}')->>'reason')='expired', 'step2 refuses after 2 hours');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM f),'{}')->>'reason')='expired', 'step2 refuses an org already approved/active');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM g),'"str"')->>'reason')='invalid', 'step2 refuses non-object fields');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM g),'{"phone":"602.555.0199"}')->>'status')='received', 'different name + known phone is not a dupe');
RESET ROLE;
SELECT pg_temp.ok(status='pending', 'name must match for phone dedupe') FROM public.directory_registrations WHERE id=(SELECT rid FROM g);
-- phone dedupe at step 2 (free-mail step 1 passes, phone catches it)
SET ROLE service_role;
CREATE TEMP TABLE h AS SELECT pg_temp.s1('Gamma Rentals LLC','rental','gamma.owner@gmail.com',NULL,NULL,'ip-h') j;
SELECT pg_temp.ok((SELECT j->>'status' FROM h)='created', 'free-mail step1 of a known company is created (pending)');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT (j->>'registration_id')::uuid FROM h),'{"phone":"602.555.0199"}')->>'status')='received', 'step2 with a known phone still answers neutrally');
RESET ROLE;
SELECT pg_temp.ok(status='possible_duplicate' AND matched_organization_id=3, 'step2 phone match flagged for review') FROM public.directory_registrations WHERE id=(SELECT (j->>'registration_id')::uuid FROM h);
SELECT pg_temp.ok(status='pending' AND step=2 AND completed_at IS NOT NULL, 'clean step2 stays pending') FROM public.directory_registrations WHERE id=(SELECT rid FROM d);
-- helpers
SELECT pg_temp.ok(directory_norm_host('HTTPS://www.Foo.com:443/x?y')='foo.com' AND directory_norm_host('foo.com')='foo.com' AND directory_norm_host('')IS NULL, 'host normalizer');
SELECT pg_temp.ok(directory_norm_phone('+1 (602) 555-0199')='6025550199' AND directory_norm_phone('555-0199') IS NULL, 'phone normalizer');
SELECT pg_temp.ok(directory_norm_name('The A&B Co., LLC')='a and b', 'name normalizer');
-- L-1 / escaping / M-1 email keys
SELECT pg_temp.ok(directory_norm_name('Médical Ñandú Servicios')='médical ñandú servicios', 'L-1: accents kept');
SELECT pg_temp.ok(directory_norm_name('東京レーザー株式会社')='東京レーザー株式会社', 'L-1: CJK name kept');
SELECT pg_temp.ok(directory_norm_name('ＡＣＭＥ　Laser') = directory_norm_name('ACME Laser'), 'L-1: fullwidth folds (NFKC)');
SELECT pg_temp.ok(directory_norm_name('!!! ...') = '', 'L-1: punctuation only is empty');
SELECT pg_temp.ok(directory_clean_text('Evil'||chr(8238)||'gnp.exe'||chr(8294)||'x'||chr(8297)||chr(8206)) = 'Evilgnp.exex', 'bidi overrides/isolates/LRM stripped');
SELECT pg_temp.ok(directory_email_key('P.A.T+1@GMail.com')='pat@gmail.com' AND directory_email_key('pat@googlemail.com')='pat@gmail.com', 'M-1: gmail dots/+tag/googlemail fold');
SELECT pg_temp.ok(directory_email_key('pat+2@acme.com')='pat@acme.com' AND directory_email_key('p.at@acme.com')='p.at@acme.com', 'M-1: +tag stripped; dots kept off gmail');
SELECT pg_temp.ok(directory_email_key('ｐａｔ@acme.com')='pat@acme.com', 'M-1: fullwidth folds (NFKC)');
SELECT pg_temp.ok(directory_email_key('p'||chr(1072)||'t@acme.com') IS NULL, 'M-1: Cyrillic look-alike refused');
SELECT pg_temp.ok(directory_email_clean('<svg/onload=alert(1)>@xss-mail.co') IS NULL AND directory_email_clean('a"b@x.co') IS NULL AND directory_email_clean('a@b@x.co') IS NULL, 'L-5: <>", two @ refused');
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE list_in_directory AND id > 3)=0, 'end: no sign-up org listed');
