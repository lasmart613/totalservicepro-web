-- 000926 review / approve / invite cases. Runs after cases.sql in proof.sql.
SELECT pg_temp.cool();
UPDATE public.directory_registrations SET notice_sent_at = now() - interval '2 hours' WHERE notice_sent_at IS NULL AND step = 2;
CREATE FUNCTION pg_temp.reg(nm text, kind text, mail text, ip text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE j jsonb; rid uuid; oid bigint;
BEGIN
  j := public.directory_registration_step1(nm, kind, mail, 'AZ', NULL, ip, gen_random_uuid());
  IF j->>'status' <> 'created' THEN RAISE EXCEPTION 'reg % failed: %', nm, j; END IF;
  rid := (j->>'registration_id')::uuid;
  j := public.directory_registration_step2(rid, jsonb_build_object('contact_name', 'Pat ' || nm, 'city', 'Phoenix'));
  IF j->>'status' <> 'received' THEN RAISE EXCEPTION 'step2 % failed: %', nm, j; END IF;
  RETURN rid;
END $$;
CREATE FUNCTION pg_temp.org_of(rid uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT organization_id FROM public.directory_registrations WHERE id = rid $$;
CREATE FUNCTION pg_temp.review(rid uuid, d text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.directory_registration_review(rid, d, 'aaaaaaaa-0000-0000-0000-00000000a001'::uuid, 'Reviewer@Example.test') $$;

INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-00000000c101', 'kilo@kilolaser.test', now()),
  ('00000000-0000-0000-0000-00000000c102', 'lima@limaderm.test', now()),
  ('00000000-0000-0000-0000-00000000c103', 'someone@else.test', now()),
  ('00000000-0000-0000-0000-00000000c104', 'oscar@oscarparts.test', NULL),
  ('00000000-0000-0000-0000-00000000c105', 'papa@papaparts.test', now());
INSERT INTO ids VALUES
  ('kilo', pg_temp.reg('Kilo Laser Works', 'service', 'kilo@kilolaser.test', 'ip-r1')::text),
  ('lima', pg_temp.reg('Lima Derm', 'clinic', 'lima@limaderm.test', 'ip-r1')::text),
  ('mike', pg_temp.reg('Mike Co', 'supplier', 'm@mikeco.test', 'ip-r1')::text),
  ('nova', pg_temp.reg('Nova Rentals', 'rental', 'n@novarent.test', 'ip-r1')::text),
  ('oscar', pg_temp.reg('Oscar Parts', 'supplier', 'oscar@oscarparts.test', 'ip-r2')::text),
  ('papa', pg_temp.reg('Papa Parts', 'supplier', 'papa@papaparts.test', 'ip-r2')::text),
  ('quin', pg_temp.reg('Quin Clinic', 'clinic', 'q@quinclinic.test', 'ip-r2')::text);
CREATE FUNCTION pg_temp.rid(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM ids WHERE ids.k = $1 $$;

-- notice: once per org
SELECT pg_temp.expect('notice: first take returns the payload',
  (SELECT j->>'company' || '|' || (j->>'org_type') || '|' || (j->>'contact_name') || '|' || (j->>'email') || '|' || (j->>'city') || '|' || (j->>'state')
   FROM (SELECT public.directory_registration_take_notice(pg_temp.rid('kilo')) j) x),
  'Kilo Laser Works|service_company|Pat Kilo Laser Works|kilo@kilolaser.test|Phoenix|AZ');
SELECT pg_temp.expect('notice: second take is refused (sent once)',
  public.directory_registration_take_notice(pg_temp.rid('kilo'))->>'ok', 'false');
SELECT pg_temp.expect('notice: already-noticed registration gets no second notice',
  public.directory_registration_take_notice((SELECT id FROM public.directory_registrations WHERE email_norm = 'new@acmelaser.com'))->>'ok', 'false');
SELECT pg_temp.expect('notice: a registration that never finished step 2 gets no notice',
  public.directory_registration_take_notice((SELECT id FROM public.directory_registrations WHERE step = 1 AND notice_sent_at IS NULL ORDER BY created_at LIMIT 1))->>'ok', 'false');

-- gate
SELECT pg_temp.expect('non-admin (authenticated) cannot approve',
  left(pg_temp.as_user('00000000-0000-0000-0000-0000000005a1', format($q$SELECT public.directory_registration_review(%L::uuid, 'approve', '00000000-0000-0000-0000-0000000005a1'::uuid, 'x@y.z')::text$q$, pg_temp.rid('kilo'))), 9), 'ERR 42501');
SELECT pg_temp.expect('anon cannot approve',
  left(pg_temp.as_anon(format($q$SELECT public.directory_registration_review(%L::uuid, 'approve', gen_random_uuid(), 'x@y.z')::text$q$, pg_temp.rid('kilo'))), 9), 'ERR 42501');
SELECT pg_temp.expect('non-admin cannot list registrations',
  left(pg_temp.as_user('00000000-0000-0000-0000-0000000005a1', 'SELECT public.directory_registrations_for_review(10)::text'), 9), 'ERR 42501');
SELECT pg_temp.expect('non-admin cannot claim a listing invite directly',
  left(pg_temp.as_user('00000000-0000-0000-0000-00000000c101', format($q$SELECT public.claim_directory_listing_invite(gen_random_uuid(), %L::uuid)::text$q$, '00000000-0000-0000-0000-00000000c101')), 9), 'ERR 42501');
SELECT pg_temp.expect('nobody can read the invite/audit tables',
  left(pg_temp.as_service('SELECT count(*)::text FROM public.directory_listing_invites'), 9), 'ERR 42501');
SELECT pg_temp.expect('bad decision rejected', pg_temp.review(pg_temp.rid('kilo'), 'list')->>'code', 'invalid');
SELECT pg_temp.expect('missing reviewer rejected',
  public.directory_registration_review(pg_temp.rid('kilo'), 'approve', NULL, 'x@y.z')->>'code', 'invalid');

-- review list shows dedupe flags
SELECT pg_temp.expect('review list includes pending sign-ups',
  (SELECT count(*)::text FROM jsonb_array_elements(public.directory_registrations_for_review(500)) e WHERE e->>'name' = 'Kilo Laser Works'), '1');
SELECT pg_temp.expect('review list flags duplicates with the matched org',
  (SELECT e->>'possible_duplicate' || '|' || (e->>'matched_name') FROM jsonb_array_elements(public.directory_registrations_for_review(500)) e
   WHERE e->>'email' = 'new@acmelaser.com'), 'true|Acme Laser Service, Inc.');

-- approve: shop
SELECT pg_temp.expect('approve shop -> listing invite',
  (SELECT (j->>'status') || '|' || (j->>'invite_kind') || '|' || (j->>'invite_email') || '|' || ((j->>'invite_id') IS NOT NULL)::text
   FROM (SELECT pg_temp.review(pg_temp.rid('kilo'), 'approve') j) x), 'approved|listing|kilo@kilolaser.test|true');
SELECT pg_temp.expect('approved shop is listed and active, never premium',
  (SELECT is_active || '|' || list_in_directory || '|' || coalesce(is_premium, false) || '|' || coalesce(plan, '-') || '|' || type
   FROM public.organizations WHERE id = pg_temp.org_of(pg_temp.rid('kilo'))), 'true|true|false|-|service_company');
SELECT pg_temp.expect('exactly one listing invite',
  (SELECT count(*)::text FROM public.directory_listing_invites WHERE organization_id = pg_temp.org_of(pg_temp.rid('kilo'))), '1');
SELECT pg_temp.expect('approval creates no membership',
  (SELECT count(*)::text FROM public.organization_memberships WHERE organization_id = pg_temp.org_of(pg_temp.rid('kilo'))), '0');
SELECT pg_temp.expect('approval audited (who, when)',
  (SELECT count(*) || '|' || min(reviewer_email) || '|' || min(reviewer_id::text) || '|' || (max(reviewed_at) IS NOT NULL)::text
   FROM public.directory_registration_reviews WHERE registration_id = pg_temp.rid('kilo')),
  '1|reviewer@example.test|aaaaaaaa-0000-0000-0000-00000000a001|true');
SELECT pg_temp.expect('approve twice is a no-op',
  (SELECT (j->>'already') || '|' || coalesce(j->>'invite_id', 'none') FROM (SELECT pg_temp.review(pg_temp.rid('kilo'), 'approve') j) x), 'true|none');
SELECT pg_temp.expect('still one invite and one audit row',
  (SELECT count(*) FROM public.directory_listing_invites WHERE organization_id = pg_temp.org_of(pg_temp.rid('kilo')))::text || '|' ||
  (SELECT count(*) FROM public.directory_registration_reviews WHERE registration_id = pg_temp.rid('kilo'))::text, '1|1');
SELECT pg_temp.expect('reject after approve is refused', pg_temp.review(pg_temp.rid('kilo'), 'reject')->>'code', 'already_decided');

-- listing claim
CREATE FUNCTION pg_temp.lclaim(k text, u text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(r->>'code', CASE WHEN (r->>'already_linked')::boolean THEN 'already_linked' ELSE 'ok' END)
  FROM (SELECT public.claim_directory_listing_invite(
    (SELECT id FROM public.directory_listing_invites WHERE organization_id = pg_temp.org_of(pg_temp.rid(k)) ORDER BY created_at DESC LIMIT 1),
    u::uuid, 'Kim', 'Lo') r) x $$;
SELECT pg_temp.expect('listing claim: other email refused', pg_temp.lclaim('kilo', '00000000-0000-0000-0000-00000000c103'), 'email_mismatch');
SELECT pg_temp.expect('listing claim: shop staff (has a membership) refused',
  (SELECT pg_temp.lclaim('kilo', '00000000-0000-0000-0000-0000000005a1')), 'email_mismatch');
SELECT pg_temp.expect('listing claim: registered email works', pg_temp.lclaim('kilo', '00000000-0000-0000-0000-00000000c101'), 'ok');
SELECT pg_temp.expect('listing claim seats exactly one owner',
  (SELECT string_agg(role || ':' || right(user_id::text, 4), ',') FROM public.organization_memberships WHERE organization_id = pg_temp.org_of(pg_temp.rid('kilo'))), 'owner:c101');
SELECT pg_temp.expect('listing claim is idempotent for the claimer', pg_temp.lclaim('kilo', '00000000-0000-0000-0000-00000000c101'), 'already_linked');
SELECT pg_temp.expect('listing invite cannot be reused', pg_temp.lclaim('kilo', '00000000-0000-0000-0000-00000000c103'), 'invite_used');

SELECT pg_temp.expect('approve supplier (oscar)', pg_temp.review(pg_temp.rid('oscar'), 'approve')->>'invite_kind', 'listing');
SELECT pg_temp.expect('listing claim: unconfirmed email refused', pg_temp.lclaim('oscar', '00000000-0000-0000-0000-00000000c104'), 'email_unconfirmed');
SELECT pg_temp.expect('approve supplier (papa)', pg_temp.review(pg_temp.rid('papa'), 'approve')->>'invite_kind', 'listing');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES ('00000000-0000-0000-0000-00000000c105', 20, 'fse', true);
SELECT pg_temp.expect('listing claim: user already in another org refused', pg_temp.lclaim('papa', '00000000-0000-0000-0000-00000000c105'), 'other_org');
UPDATE public.directory_listing_invites SET expires_at = now() - interval '1 second' WHERE organization_id = pg_temp.org_of(pg_temp.rid('oscar'));
SELECT pg_temp.expect('listing claim: expired invite refused', pg_temp.lclaim('oscar', '00000000-0000-0000-0000-00000000c104'), 'invite_expired');

-- approve: clinic -> 000923 owner invite, no membership
SELECT pg_temp.expect('approve clinic -> 000923 clinic owner invite',
  (SELECT (j->>'invite_kind') || '|' || (j->>'invite_email') FROM (SELECT pg_temp.review(pg_temp.rid('lima'), 'approve') j) x), 'clinic_owner|lima@limaderm.test');
SELECT pg_temp.expect('clinic invite row: directory_review, no shop, open, 30 days',
  (SELECT count(*) || '|' || min(issued_via) || '|' || bool_and(service_organization_id IS NULL) || '|' || bool_and(consumed_at IS NULL AND revoked_at IS NULL)
     || '|' || bool_and(expires_at BETWEEN now() + interval '29 days' AND now() + interval '31 days')
   FROM public.clinic_owner_invites WHERE customer_organization_id = pg_temp.org_of(pg_temp.rid('lima'))), '1|directory_review|true|true|true');
SELECT pg_temp.expect('clinic email of record = registered email',
  (SELECT email || '|' || recorded_via FROM public.clinic_claim_emails WHERE customer_organization_id = pg_temp.org_of(pg_temp.rid('lima'))), 'lima@limaderm.test|first_invite');
SELECT pg_temp.expect('clinic approval creates no membership and no listing invite',
  (SELECT count(*) FROM public.organization_memberships WHERE organization_id = pg_temp.org_of(pg_temp.rid('lima')))::text || '|' ||
  (SELECT count(*) FROM public.directory_listing_invites WHERE organization_id = pg_temp.org_of(pg_temp.rid('lima')))::text, '0|0');
SELECT pg_temp.expect('clinic listed', (SELECT list_in_directory::text FROM public.organizations WHERE id = pg_temp.org_of(pg_temp.rid('lima'))), 'true');
SELECT pg_temp.expect('clinic approve twice is a no-op',
  pg_temp.review(pg_temp.rid('lima'), 'approve')->>'already' || '|' ||
  (SELECT count(*) FROM public.clinic_owner_invites WHERE customer_organization_id = pg_temp.org_of(pg_temp.rid('lima')))::text, 'true|1');
SELECT pg_temp.expect('clinic claim: wrong person refused (000924 rules)',
  pg_temp.claim((SELECT id::text FROM public.clinic_owner_invites WHERE customer_organization_id = pg_temp.org_of(pg_temp.rid('lima'))), '00000000-0000-0000-0000-00000000c103'), 'OK email_mismatch');
SELECT pg_temp.expect('clinic claim: registered email claims through claim_clinic_owner_invite',
  pg_temp.claim((SELECT id::text FROM public.clinic_owner_invites WHERE customer_organization_id = pg_temp.org_of(pg_temp.rid('lima'))), '00000000-0000-0000-0000-00000000c102'), 'OK ok');
SELECT pg_temp.expect('clinic has exactly one owner', pg_temp.owners(pg_temp.org_of(pg_temp.rid('lima'))), '102');

SELECT pg_temp.expect('approve rental -> 000923 clinic owner invite (customer-side type)',
  pg_temp.review(pg_temp.rid('nova'), 'approve')->>'invite_kind', 'clinic_owner');

-- clinic whose email of record differs: listed, no invite
INSERT INTO public.clinic_claim_emails (customer_organization_id, email, recorded_via) VALUES (pg_temp.org_of(pg_temp.rid('quin')), 'other@quin.test', 'support');
SELECT pg_temp.expect('clinic with a different email of record: listed, invite skipped',
  (SELECT coalesce(j->>'invite_id', 'none') || '|' || (j->>'invite_skipped') FROM (SELECT pg_temp.review(pg_temp.rid('quin'), 'approve') j) x), 'none|email_of_record_differs');

-- shop path unchanged and constrained
INSERT INTO ids VALUES ('shopclinic', pg_temp.clinic('Shop Clinic Z', 'z@clinic-z.test')::text);
SELECT pg_temp.expect('shop-issued 000923 invite still works',
  (SELECT pg_temp.issue((SELECT v::bigint FROM ids WHERE k = 'shopclinic'), 'z@clinic-z.test') ~ '^[0-9a-f-]{36}$')::text, 'true');
SELECT pg_temp.expect('shop invite rows are issued_via shop with a service company',
  (SELECT issued_via || '|' || service_organization_id FROM public.clinic_owner_invites WHERE customer_organization_id = (SELECT v::bigint FROM ids WHERE k = 'shopclinic')), 'shop|10');
DO $$ BEGIN
  INSERT INTO public.clinic_owner_invites (customer_organization_id, service_organization_id, email, invited_by, expires_at)
  VALUES (2, NULL, 'x@y.test', gen_random_uuid(), now() + interval '1 day');
  RAISE EXCEPTION 'FAILED shop invite without a service company was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS shop invite without a service company is refused (23514)';
END $$;

-- reject
SELECT pg_temp.expect('reject', (SELECT (j->>'status') || '|' || (j->>'already') FROM (SELECT pg_temp.review(pg_temp.rid('mike'), 'reject') j) x), 'rejected|false');
SELECT pg_temp.expect('rejected org stays unlisted and inactive',
  (SELECT list_in_directory || '|' || is_active FROM public.organizations WHERE id = pg_temp.org_of(pg_temp.rid('mike'))), 'false|false');
SELECT pg_temp.expect('reject issues no invite',
  (SELECT count(*) FROM public.directory_listing_invites WHERE organization_id = pg_temp.org_of(pg_temp.rid('mike')))::text, '0');
SELECT pg_temp.expect('reject twice is a no-op', pg_temp.review(pg_temp.rid('mike'), 'reject')->>'already', 'true');
SELECT pg_temp.expect('approve after reject is refused', pg_temp.review(pg_temp.rid('mike'), 'approve')->>'code', 'already_decided');
SELECT pg_temp.expect('reject audited once',
  (SELECT count(*)::text FROM public.directory_registration_reviews WHERE registration_id = pg_temp.rid('mike')), '1');
SELECT pg_temp.expect('rejected / approved leave the review list',
  (SELECT count(*)::text FROM jsonb_array_elements(public.directory_registrations_for_review(500)) e WHERE e->>'name' IN ('Mike Co', 'Kilo Laser Works')), '0');

-- step-1 duplicate has no org: approve refused, reject allowed
SELECT pg_temp.expect('approve a step-1 duplicate (no org) is refused',
  pg_temp.review((SELECT id FROM public.directory_registrations WHERE email_norm = 'new@acmelaser.com'), 'approve')->>'code', 'no_org');
SELECT pg_temp.expect('the matched live org was not touched',
  (SELECT name || '|' || list_in_directory FROM public.organizations WHERE id = 1), 'Acme Laser Service, Inc.|true');

-- notice cap: 6 per hour; the rest are held back and counted in the next notice
UPDATE public.directory_registrations SET notice_sent_at = now() - interval '2 hours' WHERE notice_sent_at > now() - interval '1 hour';
SELECT pg_temp.cool();
CREATE TEMP TABLE flood AS SELECT i, pg_temp.reg('Flood '||i, 'service', 'f'||i||'@flood'||i||'.test', 'ip-fl'||i) rid FROM generate_series(1,9) i;
CREATE TEMP TABLE flood_res AS SELECT i, public.directory_registration_take_notice(rid) j FROM flood ORDER BY i;
SELECT pg_temp.expect('notice cap: 6 sent, 3 held back',
  (SELECT count(*) FILTER (WHERE (j->>'ok')::boolean) || '|' || count(*) FILTER (WHERE j->>'reason' = 'capped') FROM flood_res), '6|3');
SELECT pg_temp.expect('held-back registrations are still marked once (no later email of their own)',
  (SELECT count(*)::text FROM public.directory_registrations r JOIN flood f ON f.rid = r.id WHERE r.notice_capped AND r.notice_sent_at IS NOT NULL), '3');
UPDATE public.directory_registrations SET notice_sent_at = now() - interval '61 minutes' WHERE notice_sent_at > now() - interval '1 hour' AND NOT notice_capped;
SELECT pg_temp.expect('next notice after the hour reports the held-back count',
  public.directory_registration_take_notice(pg_temp.reg('After Flood', 'service', 'a@afterflood.test', 'ip-af'))->>'held_back', '3');
SELECT pg_temp.expect('review list: match shows name + details, email marked unverified',
  (SELECT (e->>'name') || '|' || (e->>'contact_name') || '|' || (e->>'email_verified') FROM jsonb_array_elements(public.directory_registrations_for_review(500)) e WHERE e->>'email' = 'new@acmelaser.com'),
  'ACME laser service LLC|Mallory|false');
