-- 000948: custom brand colors are paid-only. NOT APPLIED — needs Larry's OK.
-- Blocks Free orgs from SETTING or CHANGING brand colors on any path
-- (API, onboarding's direct client update). Clearing to NULL is allowed and
-- existing saved colors are left as they are. No rows are changed.

CREATE OR REPLACE FUNCTION public.enforce_org_branding_paid_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.brand_primary_color IS DISTINCT FROM OLD.brand_primary_color AND NEW.brand_primary_color IS NOT NULL)
     OR (NEW.brand_accent_color IS DISTINCT FROM OLD.brand_accent_color AND NEW.brand_accent_color IS NOT NULL) THEN
    IF NOT public.org_is_paid_entitled(NEW.id::bigint) THEN
      RAISE EXCEPTION 'Custom colors are a paid feature. Upgrade to save them.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_org_branding_paid_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_branding_paid_only ON public.organizations;
CREATE TRIGGER organizations_branding_paid_only
  BEFORE UPDATE OF brand_primary_color, brand_accent_color ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_org_branding_paid_only();
