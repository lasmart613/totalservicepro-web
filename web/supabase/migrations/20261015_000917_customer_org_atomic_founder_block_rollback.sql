-- Rollback for 000917: restores the exact live (pre-000917) definition of
-- membership_insert_allowed, then drops the two new functions.
-- The app's /company "Add customer" calls create_shop_customer_org: roll the
-- app back first (or together).

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.membership_insert_allowed(p_user_id uuid, p_organization_id bigint, p_role text, p_is_home boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT DISTINCT FROM auth.uid()
    AND (
      (
        -- Founder of a brand-new org only: a creator can't join a customer
        -- org that a shop already serves or that already has members.
        EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_organization_id
            AND o.created_by = auth.uid()
            AND public.org_unclaimed_new(o.id, o.created_at)
        )
        AND lower(btrim(coalesce(p_role, ''))) IN (
          public.founder_role_for_org(p_organization_id),
          'fse', 'engineer', 'technician'
        )
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
      )
      OR (
        COALESCE(p_is_home, false) = false
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
        AND EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = p_organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
            AND lower(btrim(coalesce(p_role, ''))) = public.profile_role_from_membership(
              coalesce(NULLIF(TRIM(i.role), ''), 'fse')
            )
        )
      )
    );
$function$;

DROP FUNCTION IF EXISTS public.create_shop_customer_org(bigint, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.org_founder_claim_allowed(bigint);
