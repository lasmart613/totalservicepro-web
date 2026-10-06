-- Applied on live as schema_migrations version 20261006022513.
-- Drops the two Allow-all policies the hotfix removed.
-- contacts keeps contacts_service_company_linked_manage.
-- notifications keeps notifications_select_own and notifications_update_own.
-- DROP POLICY IF EXISTS is idempotent. This file does not rewrite rows.

drop policy if exists "Allow all - contacts" on public.contacts;
drop policy if exists "Allow all - notifications" on public.notifications;
