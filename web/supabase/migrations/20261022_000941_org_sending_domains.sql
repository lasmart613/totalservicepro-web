-- 000941: CRM email "Send from your own domain" (per-org Resend domain).
-- Depends on 000940 (same CRM_EMAIL_ENABLED feature; apply 000940 first).
--
-- New objects (all COMMENTed '000941 ...' so the rollback can prove ownership):
--   * public.org_sending_domains: at most one Resend domain per organization
--     (resend_domain_id, domain_name, status, DNS records from the Resend API,
--     checked_at). A domain name can belong to only one org. repairplanet.net
--     and its subdomains are refused by a CHECK (the app also refuses them,
--     plus our other company domains and free-mail domains).
--     RLS on. authenticated may SELECT rows of an org they are an active member
--     of (to show status and DNS records). Only service_role writes (the web
--     server checks owner / company_admin / admin before any change).
--   * public.org_sending_domain_claim_verify(org): atomic rate limit for the
--     Verify action: at most 1 per 30 seconds and 10 per rolling hour per org.
--     SECURITY DEFINER, SET search_path = '', EXECUTE for service_role only.
--
-- Nothing here touches any DNS. No existing table, policy, grant or row is
-- changed. Re-runnable.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '000941: public.organizations missing';
  END IF;
  IF to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION '000941: public.is_active_org_member(bigint) missing';
  END IF;
  IF to_regclass('public.customer_email_sends') IS NULL THEN
    RAISE EXCEPTION '000941: apply 000940 (customer_email_sends) first';
  END IF;
  IF to_regclass('public.org_sending_domains') IS NOT NULL
     AND coalesce(obj_description(to_regclass('public.org_sending_domains'), 'pg_class'), '') NOT LIKE '000941%' THEN
    RAISE EXCEPTION '000941: public.org_sending_domains exists and was not created by 000941';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'org_sending_domain_claim_verify'
      AND coalesce(obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000941%') THEN
    RAISE EXCEPTION '000941: org_sending_domain_claim_verify exists and was not created by 000941';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.org_sending_domains (
  organization_id bigint PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  resend_domain_id text NOT NULL CHECK (length(resend_domain_id) BETWEEN 1 AND 100),
  domain_name text NOT NULL CHECK (
    length(domain_name) BETWEEN 4 AND 253
    AND domain_name = lower(domain_name)
    AND domain_name ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    AND domain_name <> 'repairplanet.net'
    AND domain_name NOT LIKE '%.repairplanet.net'),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'pending', 'verified', 'partially_verified', 'partially_failed', 'failed', 'temporary_failure')),
  region text,
  records jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(records) = 'array'),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  verify_requested_at timestamptz,
  verify_window_start timestamptz,
  verify_window_count integer NOT NULL DEFAULT 0 CHECK (verify_window_count >= 0),
  CONSTRAINT org_sending_domains_resend_domain_id_key UNIQUE (resend_domain_id),
  CONSTRAINT org_sending_domains_domain_name_key UNIQUE (domain_name)
);
COMMENT ON TABLE public.org_sending_domains IS
  '000941: per-org Resend sending domain for CRM email (Send from your own domain). Org adds the DNS records at its own DNS host. service_role writes only.';

ALTER TABLE public.org_sending_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.org_sending_domains FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.org_sending_domains TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_sending_domains TO service_role;

DROP POLICY IF EXISTS org_sending_domains_member_select ON public.org_sending_domains;
CREATE POLICY org_sending_domains_member_select ON public.org_sending_domains
  FOR SELECT TO authenticated
  USING (public.is_active_org_member(organization_id));
COMMENT ON POLICY org_sending_domains_member_select ON public.org_sending_domains IS
  '000941: members of the org see its sending domain status and DNS records';

CREATE OR REPLACE FUNCTION public.org_sending_domain_claim_verify(p_org bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row public.org_sending_domains%ROWTYPE;
  v_now timestamptz := pg_catalog.now();
  v_count integer;
  v_start timestamptz;
BEGIN
  SELECT * INTO v_row FROM public.org_sending_domains d WHERE d.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_row.verify_requested_at IS NOT NULL AND v_row.verify_requested_at > v_now - interval '30 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited',
      'retry_after', ceil(extract(epoch FROM (v_row.verify_requested_at + interval '30 seconds' - v_now)))::integer);
  END IF;
  IF v_row.verify_window_start IS NULL OR v_row.verify_window_start <= v_now - interval '1 hour' THEN
    v_start := v_now;
    v_count := 0;
  ELSE
    v_start := v_row.verify_window_start;
    v_count := v_row.verify_window_count;
  END IF;
  IF v_count >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited_hour',
      'retry_after', ceil(extract(epoch FROM (v_start + interval '1 hour' - v_now)))::integer);
  END IF;
  UPDATE public.org_sending_domains
     SET verify_requested_at = v_now,
         verify_window_start = v_start,
         verify_window_count = v_count + 1
   WHERE organization_id = p_org;
  RETURN jsonb_build_object('ok', true, 'resend_domain_id', v_row.resend_domain_id, 'count', v_count + 1);
END;
$fn$;
COMMENT ON FUNCTION public.org_sending_domain_claim_verify(bigint) IS
  '000941: rate limit for Verify (1 per 30s, 10 per hour per org). service_role only.';

REVOKE ALL ON FUNCTION public.org_sending_domain_claim_verify(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_sending_domain_claim_verify(bigint) TO service_role;

COMMIT;
