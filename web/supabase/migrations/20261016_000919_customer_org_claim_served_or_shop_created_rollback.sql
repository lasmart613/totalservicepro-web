-- Rollback for 000919: restores the live (000917) definitions of
-- org_founder_claim_allowed and create_shop_customer_org, then drops the
-- stamp trigger, its function and organizations.creator_shop_org_id (the
-- stamps are lost; nothing else reads them).
-- Roll the app back first (or together): with the 000917 RPC a technician's
-- "add customer" from a service report is refused again.

SET LOCAL lock_timeout = '5s';

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
$function$;

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
$function$;

DROP TRIGGER IF EXISTS trg_stamp_org_creator_shop ON public.organizations;
DROP FUNCTION IF EXISTS public.stamp_org_creator_shop();
ALTER TABLE public.organizations DROP COLUMN IF EXISTS creator_shop_org_id;

NOTIFY pgrst, 'reload schema';
