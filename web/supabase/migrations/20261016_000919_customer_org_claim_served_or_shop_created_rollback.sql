-- Rollback for 000919: restores the live (pre-000919) definitions of
-- organizations_guard_privilege, org_creator_access, org_founder_claim_allowed,
-- create_shop_customer_org and customer_org_link_allowed (pg_get_functiondef
-- from prod, 2026-10-17),
-- restores policy organizations_insert_customers and 000910's document_type
-- CHECK, then drops everything 000919 added: policy
-- organizations_insert_customer_side_not_shop_member, caller_in_service_company,
-- the guard_service_customer_org triggers and function, the
-- guard_stamped_org_membership trigger and function, the stamp trigger and
-- function, organizations.creator_shop_org_id (the stamps are lost; nothing
-- else reads them) and the customer_org rate-limit slots.
-- Roll the app back first (or together): with the 000917 RPC a technician's
-- "add customer" from a service report is refused again.

SET LOCAL lock_timeout = '5s';

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
$function$
;

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
      OR public.org_unclaimed_new(p_org, p_created_at)
    );
$function$
;

CREATE OR REPLACE FUNCTION public.org_founder_claim_allowed(p_org bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = p_org
      AND public.org_unclaimed_new(o.id, o.created_at)
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
  );
$function$
;

CREATE OR REPLACE FUNCTION public.create_shop_customer_org(p_service_org bigint, p_name text, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_laser_models text DEFAULT NULL::text, p_facility_type text DEFAULT 'Clinic'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  new_id bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_service_org IS NULL OR nullif(btrim(coalesce(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'service organization and customer name are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    JOIN public.organizations s ON s.id = m.organization_id
    WHERE m.user_id = uid
      AND m.organization_id = p_service_org
      AND lower(btrim(coalesce(m.role, ''))) IN ('company_admin', 'owner', 'service_manager')
      AND lower(btrim(coalesce(s.type, ''))) IN ('service_company', 'service')
  ) THEN
    RAISE EXCEPTION 'only a current manager of this service company can add customers' USING ERRCODE = '42501';
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

  RETURN new_id;
END;
$function$
;

DROP POLICY IF EXISTS organizations_insert_customer_side_not_shop_member ON public.organizations;
DROP POLICY IF EXISTS organizations_insert_customers ON public.organizations;
CREATE POLICY organizations_insert_customers
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (((type = 'customer'::text) AND (created_by = auth.uid())));
DROP FUNCTION IF EXISTS public.caller_in_service_company();

DROP TRIGGER IF EXISTS trg_guard_service_customer_org ON public.service_tickets;
DROP TRIGGER IF EXISTS trg_guard_service_customer_org ON public.service_reports;
DROP FUNCTION IF EXISTS public.guard_service_customer_org();

DELETE FROM public.document_send_slots WHERE document_type = 'customer_org';
ALTER TABLE public.document_send_slots
  DROP CONSTRAINT IF EXISTS document_send_slots_document_type_check;
ALTER TABLE public.document_send_slots
  ADD CONSTRAINT document_send_slots_document_type_check CHECK (
    document_type IN ('invoice', 'estimate', 'report', 'purchase_order')
  );

CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(p_service bigint, p_customer bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_service IS NOT NULL
    AND p_customer IS NOT NULL
    AND p_service = public.get_my_org_id()
    AND public.is_active_org_member(p_service)
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_customer
        AND o.type IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customers existing
      WHERE existing.customer_organization_id = p_customer
        AND existing.service_organization_id IS DISTINCT FROM p_service
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = p_customer
          AND o.type = 'customer'
          AND o.created_by IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_memberships m
            WHERE m.user_id = o.created_by
              AND m.organization_id = p_service
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.engineer_invitations i
        JOIN public.organization_memberships m
          ON m.user_id = i.invited_by
         AND m.organization_id = p_service
         AND lower(m.role) IN ('company_admin', 'owner', 'service_manager', 'crm')
        WHERE i.organization_id = p_customer
          AND i.accepted IS TRUE
          AND lower(coalesce(i.role, '')) = 'owner'
      )
    );
$function$;

DROP TRIGGER IF EXISTS trg_guard_stamped_org_membership ON public.organization_memberships;
DROP FUNCTION IF EXISTS public.guard_stamped_org_membership();

DROP TRIGGER IF EXISTS trg_stamp_org_creator_shop ON public.organizations;
DROP FUNCTION IF EXISTS public.stamp_org_creator_shop();
ALTER TABLE public.organizations DROP COLUMN IF EXISTS creator_shop_org_id;

NOTIFY pgrst, 'reload schema';
