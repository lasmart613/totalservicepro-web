SET LOCAL lock_timeout = '5s';

-- Rollback for 000923. 000923 only ADDED objects (it redefines no existing
-- function, policy or grant), so dropping them restores the exact prior
-- state. Issued invites, the email of record, the reach-email change log and
-- the departure log are discarded. Owner memberships created by claims stay.
-- Roll the app back first (the routes call the RPCs below).

DROP TRIGGER IF EXISTS trg_guard_clinic_owner_membership ON public.organization_memberships;
DROP TRIGGER IF EXISTS trg_log_membership_departure ON public.organization_memberships;
DROP TRIGGER IF EXISTS trg_log_clinic_reach_email_change ON public.organizations;
DROP TRIGGER IF EXISTS trg_log_clinic_reach_email_change ON public.contacts;

DROP FUNCTION IF EXISTS public.claim_clinic_owner_invite(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.issue_clinic_owner_invite(bigint, bigint, text, boolean);
DROP FUNCTION IF EXISTS public.guard_clinic_owner_membership();
DROP FUNCTION IF EXISTS public.log_membership_departure();
DROP FUNCTION IF EXISTS public.log_clinic_reach_email_change();
DROP FUNCTION IF EXISTS public.clinic_has_email(bigint, text);
DROP FUNCTION IF EXISTS public.clinic_shop_staff_now_or_recent(bigint, uuid);
DROP FUNCTION IF EXISTS public.clinic_linked_shop_admin(bigint, uuid);
DROP FUNCTION IF EXISTS public.clinic_owner_slot_taken(bigint, uuid);
DROP FUNCTION IF EXISTS public.clinic_is_customer_side(bigint);

DROP TABLE IF EXISTS public.organization_membership_departures;
DROP TABLE IF EXISTS public.clinic_reach_email_changes;
DROP TABLE IF EXISTS public.clinic_claim_emails;
DROP TABLE IF EXISTS public.clinic_owner_invites;

NOTIFY pgrst, 'reload schema';
