-- privileges
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.directory_registration_step1(text,text,text,text,text,text)','EXECUTE'), 'anon cannot run step1');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.directory_registration_step1(text,text,text,text,text,text)','EXECUTE'), 'authenticated cannot run step1');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.directory_registration_step2(uuid,bigint,jsonb)','EXECUTE'), 'anon cannot run step2');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.directory_find_duplicate(text,text,text,bigint)','EXECUTE'), 'authenticated cannot run find_duplicate');
SELECT pg_temp.ok(has_function_privilege('service_role','public.directory_registration_step2(uuid,bigint,jsonb)','EXECUTE'), 'service_role can run step2');
SELECT pg_temp.ok(NOT has_table_privilege(r,'public.directory_registrations','SELECT') AND NOT has_table_privilege(r,'public.directory_registration_attempts','INSERT'), 'no table privilege for '||r)
  FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT pg_temp.ok(bool_and(prosecdef) AND bool_and(proconfig @> ARRAY['search_path=""']), 'all functions definer + empty search_path')
  FROM pg_proc WHERE proname LIKE 'directory\_%';
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.directory_registrations'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.directory_registration_attempts'::regclass), 'RLS on both tables');
SET ROLE anon;
DO $$ BEGIN PERFORM public.directory_registration_step1('X Co','service','a@b.com',NULL,NULL,'ip'); RAISE WARNING 'FAILED anon call runs';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon call is 42501'; END $$;
RESET ROLE;

SET ROLE service_role;
CREATE TEMP TABLE r1 AS SELECT public.directory_registration_step1(' Delta Laser Repair ','service','Pat@DeltaLaser.com','az','85004','ip-a') AS j;
RESET ROLE;
SELECT pg_temp.ok((SELECT j->>'status' FROM r1)='created', 'step1 creates');
SELECT pg_temp.ok(o.type='service_company' AND o.is_active=false AND o.list_in_directory=false AND o.is_premium=false
  AND o.email='pat@deltalaser.com' AND o.state='AZ' AND o.zip='85004' AND o.name='Delta Laser Repair' AND o.created_by IS NULL,
  'pending org: unlisted, inactive, normalized')
  FROM public.organizations o WHERE o.id=(SELECT (j->>'organization_id')::bigint FROM r1);
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE list_in_directory AND is_active IS DISTINCT FROM false AND id > 3)=0, 'nothing new is listed');

SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step1('Echo Parts','supplier','e@echo-parts.com',NULL,NULL,'ip-b')->>'status')='created', 'supplier ok');
SELECT pg_temp.ok((public.directory_registration_step1('Fox Rentals','rental','f@foxrent.com',NULL,NULL,'ip-b')->>'status')='created', 'rental ok');
SELECT pg_temp.ok((public.directory_registration_step1('Golf Derm Clinic','clinic','g@golfderm.com',NULL,NULL,'ip-b')->>'status')='created', 'clinic ok');
RESET ROLE;
SELECT pg_temp.ok((SELECT string_agg(type, ',' ORDER BY id) FROM public.organizations WHERE name IN ('Echo Parts','Fox Rentals','Golf Derm Clinic'))
  = 'parts_supplier,laser_rental,laser_clinic', 'org type mapping');

SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step1('Bad','vendor','x@y.com',NULL,NULL,'ip-c')->>'reason')='invalid', 'unknown kind rejected');
SELECT pg_temp.ok((public.directory_registration_step1('Okay Co','service','not-an-email',NULL,NULL,'ip-c')->>'reason')='invalid', 'bad email rejected');
SELECT pg_temp.ok((public.directory_registration_step1('Okay Co','service','a@okay.com','Arizona',NULL,'ip-c')->>'reason')='invalid', 'bad state rejected');
SELECT pg_temp.ok((public.directory_registration_step1('Okay Co','service','a@okay.com',NULL,'8500','ip-c')->>'reason')='invalid', 'bad zip rejected');
SELECT pg_temp.ok((public.directory_registration_step1('Okay Co','service','a@okay.com',NULL,NULL,'')->>'reason')='invalid', 'missing ip key rejected');
SELECT pg_temp.ok((public.directory_registration_step1('Inc.','service','a@okay2.com',NULL,NULL,'ip-c')->>'reason')='invalid', 'name of only suffixes rejected');

-- dedupe
SELECT pg_temp.ok(public.directory_registration_step1('ACME laser service LLC','service','new@acmelaser.com',NULL,NULL,'ip-d') = '{"ok": true, "status": "review"}'::jsonb, 'dupe by name+email domain -> neutral review, no details');
SELECT pg_temp.ok(public.directory_registration_step1('the beta medical parts','supplier','x@betaparts.com',NULL,NULL,'ip-d') = '{"ok": true, "status": "review"}'::jsonb, 'dupe by website host');
SELECT pg_temp.ok((public.directory_registration_step1('Acme Laser Service','service','someone@gmail.com',NULL,NULL,'ip-e')->>'status')='created', 'free-mail domain is not a dedupe key');
SELECT pg_temp.ok((public.directory_registration_step1('Acme Imaging','service','new2@acmelaser.com',NULL,NULL,'ip-e')->>'status')='created', 'same domain, different name is not a dupe');
SELECT pg_temp.ok((public.directory_registration_step1('Delta Laser Repair','service','pat@deltalaser.com',NULL,NULL,'ip-f')->>'status')='review', 'repeat sign-up -> review, no second org');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE directory_norm_name(name)='delta laser repair')=1, 'one Delta org');
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE directory_norm_name(name)='acme laser service')=2, 'review created no org');
SELECT pg_temp.ok((SELECT matched_organization_id FROM public.directory_registrations WHERE email_norm='new@acmelaser.com')=1, 'match kept server-side for review');

-- rate limits
SET ROLE service_role;
SELECT public.directory_registration_step1('RL '||i,'service','rl'||i||'@rl'||i||'.com',NULL,NULL,'ip-rl') FROM generate_series(1,5) i;
SELECT pg_temp.ok((public.directory_registration_step1('RL 6','service','rl6@rl6.com',NULL,NULL,'ip-rl')->>'reason')='rate_limited', '6th from one IP in 10 min is limited');
SELECT pg_temp.ok((public.directory_registration_step1('RL 7','service','rl7@rl7.com',NULL,NULL,'ip-rl2')->>'status')='created', 'other IP unaffected');
SELECT public.directory_registration_step1('Em '||i,'service','same@em.com',NULL,NULL,'ip-em'||i) FROM generate_series(1,3) i;
SELECT pg_temp.ok((public.directory_registration_step1('Em 4','service','SAME@em.com',NULL,NULL,'ip-em4')->>'reason')='rate_limited', '4th for one email per day is limited (case-insensitive)');
RESET ROLE;
UPDATE public.directory_registration_attempts SET taken_at = taken_at - interval '11 minutes' WHERE key_value='ip-rl';
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step1('RL 8','service','rl8@rl8.com',NULL,NULL,'ip-rl')->>'status')='created', 'IP window slides after 10 min');
RESET ROLE;
INSERT INTO public.directory_registration_attempts (key_kind,key_value,taken_at) SELECT 'ip','ip-day',now()-interval '1 hour' FROM generate_series(1,20);
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step1('Day','service','d@day.com',NULL,NULL,'ip-day')->>'reason')='rate_limited', '20 per IP per day');
RESET ROLE;
INSERT INTO public.directory_registration_attempts (key_kind,key_value,taken_at) VALUES ('ip','old',now()-interval '2 days');
SET ROLE service_role;
SELECT public.directory_registration_step1('Cleanup','service','c@cleanup.com',NULL,NULL,'ip-clean');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.directory_registration_attempts WHERE key_value='old'), 'expired attempts pruned');
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE name='RL 6')=0, 'limited call created nothing');

-- step 2
CREATE TEMP TABLE d AS SELECT (j->>'registration_id')::uuid rid, (j->>'organization_id')::bigint oid FROM r1;
GRANT SELECT ON d TO service_role;
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM d), 1, '{}')->>'reason')='expired', 'step2 refuses another org id (live listed org 1)');
SELECT pg_temp.ok((public.directory_registration_step2(gen_random_uuid(), (SELECT oid FROM d), '{}')->>'reason')='expired', 'step2 refuses unknown registration');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM d), (SELECT oid FROM d),
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
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM d), (SELECT oid FROM d), '{"phone":"1"}')->>'reason')='expired', 'step2 is single use');
RESET ROLE;
-- expiry + approved org
CREATE TEMP TABLE e AS SELECT r.id rid, r.organization_id oid FROM public.directory_registrations r JOIN public.organizations o ON o.id=r.organization_id WHERE o.name='Echo Parts';
CREATE TEMP TABLE f AS SELECT r.id rid, r.organization_id oid FROM public.directory_registrations r JOIN public.organizations o ON o.id=r.organization_id WHERE o.name='Fox Rentals';
CREATE TEMP TABLE g AS SELECT r.id rid, r.organization_id oid FROM public.directory_registrations r JOIN public.organizations o ON o.id=r.organization_id WHERE o.name='Golf Derm Clinic';
GRANT SELECT ON e, f, g TO service_role;
UPDATE public.directory_registrations SET created_at = now() - interval '2 hours 1 minute' WHERE id=(SELECT rid FROM e);
UPDATE public.organizations SET is_active = true WHERE id=(SELECT oid FROM f);
SET ROLE service_role;
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM e),(SELECT oid FROM e),'{}')->>'reason')='expired', 'step2 refuses after 2 hours');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM f),(SELECT oid FROM f),'{}')->>'reason')='expired', 'step2 refuses an org already approved/active');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM g),(SELECT oid FROM d),'{}')->>'reason')='expired', 'step2 refuses a registration bound to a different org');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM g),(SELECT oid FROM g),'"str"')->>'reason')='invalid', 'step2 refuses non-object fields');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT rid FROM g),(SELECT oid FROM g),'{"phone":"602.555.0199"}')->>'status')='received', 'different name + known phone is not a dupe');
RESET ROLE;
SELECT pg_temp.ok(status='pending', 'name must match for phone dedupe') FROM public.directory_registrations WHERE id=(SELECT rid FROM g);
-- phone dedupe at step 2 (free-mail step 1 passes, phone catches it)
SET ROLE service_role;
CREATE TEMP TABLE h AS SELECT public.directory_registration_step1('Gamma Rentals LLC','rental','gamma.owner@gmail.com',NULL,NULL,'ip-h') j;
SELECT pg_temp.ok((SELECT j->>'status' FROM h)='created', 'free-mail step1 of a known company is created (pending)');
SELECT pg_temp.ok((public.directory_registration_step2((SELECT (j->>'registration_id')::uuid FROM h),(SELECT (j->>'organization_id')::bigint FROM h),'{"phone":"602.555.0199"}')->>'status')='received', 'step2 with a known phone still answers neutrally');
RESET ROLE;
SELECT pg_temp.ok(status='possible_duplicate' AND matched_organization_id=3, 'step2 phone match flagged for review') FROM public.directory_registrations WHERE id=(SELECT (j->>'registration_id')::uuid FROM h);
SELECT pg_temp.ok(status='pending' AND step=2 AND completed_at IS NOT NULL, 'clean step2 stays pending') FROM public.directory_registrations WHERE id=(SELECT rid FROM d);
-- helpers
SELECT pg_temp.ok(directory_norm_host('HTTPS://www.Foo.com:443/x?y')='foo.com' AND directory_norm_host('foo.com')='foo.com' AND directory_norm_host('')IS NULL, 'host normalizer');
SELECT pg_temp.ok(directory_norm_phone('+1 (602) 555-0199')='6025550199' AND directory_norm_phone('555-0199') IS NULL, 'phone normalizer');
SELECT pg_temp.ok(directory_norm_name('The A&B Co., LLC')='a and b', 'name normalizer');
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE list_in_directory AND id > 3)=0, 'end: no sign-up org listed');
