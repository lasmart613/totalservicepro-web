-- Rollback for 000926. Drops the directory sign-up RPCs and tables.
-- Organizations rows created by sign-ups are NOT deleted: they stay pending
-- (is_active = false, list_in_directory = false). Review them by hand first.
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.directory_registration_step2(uuid, bigint, jsonb);
DROP FUNCTION IF EXISTS public.directory_registration_step1(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.directory_find_duplicate(text, text, text, bigint);
DROP FUNCTION IF EXISTS public.directory_is_free_mail(text);
DROP FUNCTION IF EXISTS public.directory_norm_phone(text);
DROP FUNCTION IF EXISTS public.directory_norm_host(text);
DROP FUNCTION IF EXISTS public.directory_norm_name(text);
DROP TABLE IF EXISTS public.directory_registration_attempts;
DROP TABLE IF EXISTS public.directory_registrations;
