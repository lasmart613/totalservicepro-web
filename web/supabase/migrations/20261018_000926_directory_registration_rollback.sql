-- Rollback for 000926. Drops the directory sign-up, review and listing-invite
-- objects and restores clinic_owner_invites to its 000924 shape.
--
-- Refuses if a directory-review clinic owner invite was already CLAIMED: that
-- row is the owner's proof under guard_clinic_owner_membership and has no
-- service company, so service_organization_id cannot be NOT NULL again.
--
-- Data effects (QA L-14), read before running:
--   * Open, expired or revoked directory-review clinic owner invites are DELETED.
--   * directory_listing_invites (open or not) are DROPPED with their table.
--   * The organizations those invites were for are NOT changed: approved orgs
--     stay listed (is_active = true, list_in_directory = true) with no way to
--     claim them. This rollback does not unlist them; unlist by hand if wanted.
--   * Organizations created by sign-ups (pending, unlisted) are NOT deleted.
--   * clinic_claim_emails rows written at approval REMAIN (recorded_via
--     'first_invite'); they are ordinary 000923 rows and stay valid.
--   * directory_registrations, _attempts, _reviews and directory_form_tickets
--     are dropped, so sign-up and review history is lost.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.clinic_owner_invites') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                 WHERE attrelid = 'public.clinic_owner_invites'::regclass AND attname = 'issued_via' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM public.clinic_owner_invites WHERE issued_via = 'directory_review' AND consumed_at IS NOT NULL) THEN
      RAISE EXCEPTION '000926 rollback refused: a directory-review clinic owner invite was claimed';
    END IF;
    DELETE FROM public.clinic_owner_invites WHERE issued_via = 'directory_review';
  END IF;
END $$;

ALTER TABLE IF EXISTS public.clinic_owner_invites ALTER COLUMN service_organization_id SET NOT NULL;
ALTER TABLE IF EXISTS public.clinic_owner_invites DROP CONSTRAINT IF EXISTS clinic_owner_invites_issued_via_check;
ALTER TABLE IF EXISTS public.clinic_owner_invites DROP COLUMN IF EXISTS issued_via;

DROP FUNCTION IF EXISTS public.claim_directory_listing_invite(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.directory_registration_review(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.directory_registrations_for_review(integer);
DROP FUNCTION IF EXISTS public.directory_registration_take_notice(uuid);
DROP FUNCTION IF EXISTS public.directory_registration_step2(uuid, jsonb);
DROP FUNCTION IF EXISTS public.directory_registration_step1(text, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.directory_find_duplicate(text, text, text, bigint);
DROP FUNCTION IF EXISTS public.directory_is_free_mail(text);
DROP FUNCTION IF EXISTS public.directory_norm_phone(text);
DROP FUNCTION IF EXISTS public.directory_norm_host(text);
DROP FUNCTION IF EXISTS public.directory_email_key(text);
DROP FUNCTION IF EXISTS public.directory_email_clean(text);
DROP FUNCTION IF EXISTS public.directory_norm_name(text);
DROP FUNCTION IF EXISTS public.directory_clean_text(text);
DROP TABLE IF EXISTS public.directory_listing_invites;
DROP TABLE IF EXISTS public.directory_registration_reviews;
DROP TABLE IF EXISTS public.directory_registration_attempts;
DROP TABLE IF EXISTS public.directory_form_tickets;
DROP TABLE IF EXISTS public.directory_registrations;

NOTIFY pgrst, 'reload schema';
