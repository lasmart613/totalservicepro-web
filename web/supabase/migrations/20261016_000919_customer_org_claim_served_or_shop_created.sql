-- 000919: a customer org a shop user created, or that a shop already served,
-- is never founder-claimable, even after the shop user leaves the shop.
--
-- ORDERING: 000918 (manual search index catch-up) is applied. The two touch
-- different objects. 000910 (document_send_slots) must be applied (it is).
--
-- The hole (after #304 / 000917): org_founder_claim_allowed refused a
-- customer-side org only while its created_by was STILL a member of a service
-- company. Client paths inserted a type='customer' org without (or without
-- reliably) an organization_customers link. A shop user could create such an
-- org, POST /api/org/leave, then within 24h claim it as founder, which also
-- opens its service reports (can_view_service_report_for_history).
--
-- Rev 2 (QA #309 pre-merge review, 2026-10-17):
--   H1  type flip: the creator flipped type to service_company, claimed as
--       company_admin and flipped back. Now organizations.type is fixed for
--       clients after insert (organizations_guard_privilege), AND the stamp and
--       served checks refuse a founder claim whatever the org's type.
--   M1  the 24h creator access (org_creator_access -> org_unclaimed_new) let a
--       creator read reports naming the org after leaving the shop. It no
--       longer applies to stamped or served orgs, and a current shop member
--       can no longer insert a customer-side org directly (only
--       create_shop_customer_org, which links it in the same transaction).
--   L1  service_tickets / service_reports: a client may only name a customer
--       org linked to that shop (organization_customers).
--   L2  create_shop_customer_org: length caps and 30 creates per user per
--       sliding hour (000910's document_send_slots).
--
-- 1) organizations.creator_shop_org_id (new, nullable, no backfill): a
--    service company the creator belonged to when they inserted a
--    customer-side org. Set by trigger trg_stamp_org_creator_shop on INSERT,
--    whatever the client sends. Only customer-side inserts are stamped: a shop
--    member founding their own service company is a real flow (prod: 1 in the
--    last 90 days) and must stay claimable. Since type can't change after
--    insert, the stamp can't be shed or gained by a type change. Clients can't
--    change the stamp (the trigger raises on UPDATE when auth.uid() is set);
--    the service role (auth.uid() null) may correct it.
-- 2) org_founder_claim_allowed(p_org): as 000917 (customer-side org whose
--    creator is a shop member now), and for EVERY type also refused when
--      - creator_shop_org_id IS NOT NULL, or
--      - a service_reports or service_tickets row names the org as its
--        customer ('already served').
--    membership_insert_allowed and /api/org/founder (founderClaimAllowed in
--    web/lib/tenant-lockdown.ts) both go through this rule.
-- 3) organizations_guard_privilege: live body plus one check: a client UPDATE
--    that changes type raises 42501. A same-value update passes.
-- 4) org_creator_access: the "new and unclaimed" branch no longer applies to
--    a stamped or served org. The member and linked-shop branches are as live.
-- 5) Inserts: policy organizations_insert_customers is dropped (the two other
--    permissive INSERT policies already covered it). New RESTRICTIVE policy
--    organizations_insert_customer_side_not_shop_member: a customer-side
--    INSERT is refused when the caller is a member of a service company. That
--    leaves clinic self-signup (app/onboarding: insert, then owner
--    membership) as the only direct path; prod 2026-10-17: 11 self-signups in
--    90 days, none by a shop member, and 0 unlinked customer orgs created by
--    shop members in 90 days.
-- 6) guard_service_customer_org (trigger on service_tickets and
--    service_reports, client writes only): a customer_organization_id must be
--    linked to organization_id in organization_customers. With no shop
--    (organization_id NULL), only a member of that customer org may name it.
--    Checked on INSERT and when either column changes. Prod 2026-10-17: every
--    row with both set is linked (24 reports, 36 tickets), 0 name the shop
--    itself, so nothing existing is affected.
-- 7) create_shop_customer_org: any CURRENT member of the service company may
--    call it (000917 allowed only company_admin/owner/service_manager). Text
--    caps (name 200, address 500, city 100, state 100, phone 50,
--    laser_models 1000, facility_type 100; prod max today: 81/105/28/10/24/
--    36/22) raise 22001. 30 creates per user per sliding hour (prod max ever:
--    10) raise PT429 (PostgREST answers HTTP 429). Slots are rows in
--    public.document_send_slots with document_type 'customer_org' and
--    organization_id 'customer_org:user:<uuid>', so they never count toward a
--    shop's document email cap (that cap counts by organization_id).
--
-- Precheck (prod, read-only, 2026-10-16/17): 1778 customer-side orgs, 18
-- served; 0 would newly become unclaimable. The 12 unlinked customer orgs are
-- not written and none changes state. No client code changes an org's type
-- (onboarding re-save sends the same type; it now omits it).
--
-- APPLY after review, BEFORE the app deploy. One transaction. Safe to re-run.
-- Rollback: 20261016_000919_customer_org_claim_served_or_shop_created_rollback.sql

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS creator_shop_org_id bigint;

COMMENT ON COLUMN public.organizations.creator_shop_org_id IS
  'A service company the creator belonged to when they inserted this customer-side org (trigger). Blocks founder claims and creator access. Not client-writable.';

-- No-op today (authenticated has column-level grants on safe columns only);
-- explicit so a later grant does not include it by accident.
REVOKE INSERT (creator_shop_org_id), UPDATE (creator_shop_org_id)
  ON TABLE public.organizations FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stamp_org_creator_shop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Runs after trg_set_org_created_by (triggers fire in name order), so
    -- created_by is already filled from auth.uid() when the client left it null.
    NEW.creator_shop_org_id := CASE
      WHEN lower(btrim(coalesce(NEW.type, ''))) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller') THEN (
        SELECT min(m.organization_id)
        FROM public.organization_memberships m
        JOIN public.organizations s ON s.id = m.organization_id
        WHERE NEW.created_by IS NOT NULL
          AND m.user_id = NEW.created_by
          AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
      )
    END;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL
     AND NEW.creator_shop_org_id IS DISTINCT FROM OLD.creator_shop_org_id THEN
    RAISE EXCEPTION 'creator_shop_org_id cannot be changed by the client' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_org_creator_shop() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_org_creator_shop ON public.organizations;
CREATE TRIGGER trg_stamp_org_creator_shop
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_org_creator_shop();

-- 3) Live body (pg_get_functiondef, 2026-10-17) plus the type check.
CREATE OR REPLACE FUNCTION public.organizations_guard_privilege()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  newj jsonb := pg_catalog.to_jsonb(NEW);
  oldj jsonb := CASE WHEN TG_OP = 'UPDATE' THEN pg_catalog.to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by must be the signed-in user';
    END IF;
    IF coalesce((newj->>'is_premium')::boolean, false) IS TRUE THEN
      RAISE EXCEPTION 'is_premium cannot be self-granted';
    END IF;
    IF nullif(newj->>'premium_until', '') IS NOT NULL
       OR nullif(newj->>'premium_grant', '') IS NOT NULL THEN
      RAISE EXCEPTION 'premium fields cannot be self-granted';
    END IF;
    IF nullif(newj->>'trial_granted_at', '') IS NOT NULL THEN
      RAISE EXCEPTION 'trial_granted_at cannot be set by the client';
    END IF;
    IF lower(coalesce(newj->>'subscription_tier', '')) NOT IN ('', 'free')
       OR lower(coalesce(newj->>'plan', '')) NOT IN ('', 'free') THEN
      RAISE EXCEPTION 'plan cannot be self-granted';
    END IF;
    IF nullif(newj->>'stripe_account_id', '') IS NOT NULL
       OR coalesce((newj->>'stripe_charges_enabled')::boolean, false)
       OR coalesce((newj->>'stripe_payouts_enabled')::boolean, false)
       OR coalesce((newj->>'stripe_details_submitted')::boolean, false) THEN
      RAISE EXCEPTION 'stripe connect fields cannot be set by the client';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by cannot be changed';
  END IF;
  -- 000919: type is fixed after insert for clients. A same-value update
  -- (onboarding re-save) is a no-op and passes. Real changes need the
  -- service role (auth.uid() is null there, see the top of this function).
  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'organization type cannot be changed by the client' USING ERRCODE = '42501';
  END IF;
  IF (newj->>'is_premium') IS DISTINCT FROM (oldj->>'is_premium')
     OR (newj->>'premium_until') IS DISTINCT FROM (oldj->>'premium_until')
     OR (newj->>'premium_grant') IS DISTINCT FROM (oldj->>'premium_grant')
     OR (newj->>'subscription_tier') IS DISTINCT FROM (oldj->>'subscription_tier')
     OR (newj->>'plan') IS DISTINCT FROM (oldj->>'plan') THEN
    RAISE EXCEPTION 'plan and premium fields cannot be changed by the client';
  END IF;
  IF (newj->>'trial_granted_at') IS DISTINCT FROM (oldj->>'trial_granted_at') THEN
    RAISE EXCEPTION 'trial_granted_at cannot be changed by the client';
  END IF;
  IF (newj->>'stripe_account_id') IS DISTINCT FROM (oldj->>'stripe_account_id')
     OR (newj->>'stripe_charges_enabled') IS DISTINCT FROM (oldj->>'stripe_charges_enabled')
     OR (newj->>'stripe_payouts_enabled') IS DISTINCT FROM (oldj->>'stripe_payouts_enabled')
     OR (newj->>'stripe_details_submitted') IS DISTINCT FROM (oldj->>'stripe_details_submitted') THEN
    RAISE EXCEPTION 'stripe connect fields cannot be changed by the client';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.org_founder_claim_allowed(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = p_org
      AND public.org_unclaimed_new(o.id, o.created_at)
      -- 000917: customer-side org whose creator is a shop member now.
      AND NOT (
        lower(btrim(coalesce(o.type, ''))) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
        AND o.created_by IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships m
          JOIN public.organizations s ON s.id = m.organization_id
          WHERE m.user_id = o.created_by
            AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
        )
      )
      -- 000919, any type: created as a customer by a shop member ...
      AND o.creator_shop_org_id IS NULL
      -- ... or already served by a shop.
      AND NOT EXISTS (
        SELECT 1 FROM public.service_reports r
        WHERE r.customer_organization_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.service_tickets t
        WHERE t.customer_organization_id = o.id
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.org_founder_claim_allowed(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_founder_claim_allowed(bigint) TO service_role;

-- 4) Live body; the unclaimed-new branch now skips stamped or served orgs.
CREATE OR REPLACE FUNCTION public.org_creator_access(p_org bigint, p_created_by uuid, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_org IS NOT NULL
    AND p_created_by IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_created_by = auth.uid()
    AND (
      public.is_active_org_member(p_org)
      OR EXISTS (
        SELECT 1 FROM public.organization_customers oc
        WHERE oc.customer_organization_id = p_org
          AND public.is_active_org_member(oc.service_organization_id)
      )
      OR (
        public.org_unclaimed_new(p_org, p_created_at)
        AND NOT EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_org
            AND o.creator_shop_org_id IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.service_reports r
          WHERE r.customer_organization_id = p_org
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.service_tickets t
          WHERE t.customer_organization_id = p_org
        )
      )
    );
$function$;

-- 5) Direct customer-side inserts: clinic self-signup only.
CREATE OR REPLACE FUNCTION public.caller_in_service_company()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      JOIN public.organizations s ON s.id = m.organization_id
      WHERE m.user_id = auth.uid()
        AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
    );
$function$;

REVOKE ALL ON FUNCTION public.caller_in_service_company() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_in_service_company() TO authenticated, service_role;

DROP POLICY IF EXISTS organizations_insert_customers ON public.organizations;
DROP POLICY IF EXISTS organizations_insert_customer_side_not_shop_member ON public.organizations;
CREATE POLICY organizations_insert_customer_side_not_shop_member
  ON public.organizations
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    lower(btrim(coalesce(type, ''))) NOT IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
    OR NOT public.caller_in_service_company()
  );

-- 6) Tickets and reports name only a linked customer.
CREATE OR REPLACE FUNCTION public.guard_service_customer_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NEW.customer_organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.customer_organization_id IS NOT DISTINCT FROM OLD.customer_organization_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.organization_customers oc
      WHERE oc.service_organization_id = NEW.organization_id
        AND oc.customer_organization_id = NEW.customer_organization_id
    ) THEN
      RETURN NEW;
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = NEW.customer_organization_id
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'customer_organization_id must be a customer linked to this service company'
    USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_service_customer_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_service_customer_org ON public.service_tickets;
CREATE TRIGGER trg_guard_service_customer_org
  BEFORE INSERT OR UPDATE OF organization_id, customer_organization_id ON public.service_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_service_customer_org();

DROP TRIGGER IF EXISTS trg_guard_service_customer_org ON public.service_reports;
CREATE TRIGGER trg_guard_service_customer_org
  BEFORE INSERT OR UPDATE OF organization_id, customer_organization_id ON public.service_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_service_customer_org();

-- 7) Rate-limit slots live in 000910's table under their own document_type.
ALTER TABLE public.document_send_slots
  DROP CONSTRAINT IF EXISTS document_send_slots_document_type_check;
ALTER TABLE public.document_send_slots
  ADD CONSTRAINT document_send_slots_document_type_check CHECK (
    document_type IN ('invoice', 'estimate', 'report', 'purchase_order', 'customer_org')
  );

CREATE OR REPLACE FUNCTION public.create_shop_customer_org(
  p_service_org bigint,
  p_name text,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_laser_models text DEFAULT NULL,
  p_facility_type text DEFAULT 'Clinic'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  new_id bigint;
  v_key text;
  v_now timestamptz;
  v_count integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_service_org IS NULL OR nullif(btrim(coalesce(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'service organization and customer name are required' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(p_name)) > 200
     OR char_length(btrim(coalesce(p_address, ''))) > 500
     OR char_length(btrim(coalesce(p_city, ''))) > 100
     OR char_length(btrim(coalesce(p_state, ''))) > 100
     OR char_length(btrim(coalesce(p_phone, ''))) > 50
     OR char_length(btrim(coalesce(p_laser_models, ''))) > 1000
     OR char_length(btrim(coalesce(p_facility_type, ''))) > 100 THEN
    RAISE EXCEPTION 'customer field too long (name 200, address 500, city 100, state 100, phone 50, laser models 1000, facility type 100 characters)'
      USING ERRCODE = '22001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    JOIN public.organizations s ON s.id = m.organization_id
    WHERE m.user_id = uid
      AND m.organization_id = p_service_org
      AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
  ) THEN
    RAISE EXCEPTION 'only a current member of this service company can add customers' USING ERRCODE = '42501';
  END IF;

  -- 30 per user per sliding hour. The lock serializes this user's creates,
  -- so two calls can't both pass the count.
  v_key := 'customer_org:user:' || uid::text;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsp.customer_org:' || uid::text, 0));
  v_now := pg_catalog.clock_timestamp();
  DELETE FROM public.document_send_slots s
  WHERE s.organization_id = v_key
    AND s.document_type = 'customer_org'
    AND s.taken_at <= v_now - interval '1 hour';
  SELECT count(*)::integer INTO v_count
  FROM public.document_send_slots s
  WHERE s.organization_id = v_key
    AND s.document_type = 'customer_org'
    AND s.taken_at > v_now - interval '1 hour';
  IF v_count >= 30 THEN
    RAISE EXCEPTION 'You have added 30 customers in the last hour. Try again later.' USING ERRCODE = 'PT429';
  END IF;

  INSERT INTO public.organizations (name, type, created_by, address, city, state, phone, laser_models, facility_type)
  VALUES (
    btrim(p_name), 'customer', uid,
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_laser_models, '')), ''),
    coalesce(nullif(btrim(coalesce(p_facility_type, '')), ''), 'Clinic')
  )
  RETURNING id INTO new_id;

  -- Same transaction: if this raises, the org above is rolled back too.
  INSERT INTO public.organization_customers (service_organization_id, customer_organization_id, created_by)
  VALUES (p_service_org, new_id, uid);

  INSERT INTO public.document_send_slots (organization_id, document_type, document_id, taken_at)
  VALUES (v_key, 'customer_org', p_service_org::text, v_now);

  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
