-- 000954: one complimentary signup Premium grant per user.
--
-- organizations.trial_granted_at stops a shop from being granted twice.
-- It does not stop the same person founding another shop and receiving
-- another 60-day complimentary_signup trial. This table is one row per
-- user, written by the service role from POST /api/org/founder.
-- Deleting the organization does not delete the row.
--
-- No backfill and no updates to existing organizations. Shops that already
-- have complimentary_signup or trial_granted_at are seen by the route
-- without this table. The unique user_id stops two founder requests in
-- flight from each receiving a grant.
--
-- Repo only. Do not apply this file to production from the pull request.
-- Apply it before merge so the concurrent cap is live. The route still
-- refuses a second shop from organization history if this table is absent.
--
-- Rollback: 20261105_000954_complimentary_signup_grant_rollback.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '000954 drift: public.organizations is missing';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.complimentary_signup_grants (
  user_id uuid PRIMARY KEY,
  organization_id bigint,
  granted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.complimentary_signup_grants IS
  '000954: one complimentary signup Premium grant per user, lifetime. Service role only. Not an advertisement and not a paid plan.';

ALTER TABLE public.complimentary_signup_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.complimentary_signup_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.complimentary_signup_grants TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
