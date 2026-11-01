-- Rollback 000948.
DROP TRIGGER IF EXISTS organizations_branding_paid_only ON public.organizations;
DROP FUNCTION IF EXISTS public.enforce_org_branding_paid_only();
