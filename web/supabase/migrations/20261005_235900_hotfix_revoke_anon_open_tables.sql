-- Applied on live on 2026-10-05 at 7:27 PM PT.
-- schema_migrations version 20261006022329
-- name hotfix_revoke_anon_open_tables_20261005
--
-- REVOKE is idempotent. This file mirrors the live hotfix so a fresh
-- database matches production. It does not rewrite rows.

revoke all on table public.contacts, public.engineer_invitations, public.sites, public.notifications, public.labor_log, public.parts, public.parts_used, public.forum_bookmarks from anon;

revoke insert, update, delete, truncate, references, trigger on table public.forum_attachments, public.forum_categories, public.forum_posts, public.forum_reactions, public.forum_threads from anon;
