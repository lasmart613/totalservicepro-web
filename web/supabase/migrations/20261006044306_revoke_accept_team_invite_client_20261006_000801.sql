-- Filename version 20261006044306 matches supabase_migrations.schema_migrations
-- (name revoke_accept_team_invite_client_20261006_000801).
-- Applied on live 2026-10-05 ~9:43 PM PT as supabase_migrations version 20261006044306,
-- name revoke_accept_team_invite_client_20261006_000801. Exact statements below.
-- accept_team_invite is not called by any route; claim goes through /api/team/claim (service role, checks email_confirmed_at).
-- Direct RPC let an unconfirmed session join. Revoke client EXECUTE; service_role keeps it.
REVOKE EXECUTE ON FUNCTION public.accept_team_invite(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_team_invite(bigint, bigint) TO service_role;
