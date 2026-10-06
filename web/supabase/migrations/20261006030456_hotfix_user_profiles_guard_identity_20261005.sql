-- Filename version 20261006030456 matches supabase_migrations.schema_migrations
-- (name hotfix_user_profiles_guard_identity_20261005). The earlier repo label
-- 20261005_235902 was not the version live recorded.
-- Applied on live 2026-10-05 ~8:05 PM PT as supabase_migrations version 20261006030456,
-- name hotfix_user_profiles_guard_identity_20261005. Exact text below.
-- Hotfix 2026-10-05 ~8:05pm PT: stop signed-in clients from self-granting platform admin
-- or attaching their profile to an org they don't belong to. Server/definer paths are unaffected.
create or replace function public.profile_org_change_allowed(p_uid uuid, p_org bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
set row_security to 'off'
as $$
  select p_org is null
    or exists (select 1 from public.organizations o where o.id = p_org and o.created_by = p_uid)
    or exists (select 1 from public.organization_memberships m where m.user_id = p_uid and m.organization_id = p_org)
    or exists (
      select 1 from public.engineer_invitations i
      where i.organization_id = p_org
        and public.auth_login_email() is not null
        and lower(btrim(i.email)) = public.auth_login_email()
        and coalesce(i.accepted, false) = false
        and (i.expires_at is null or i.expires_at > now())
    );
$$;
revoke all on function public.profile_org_change_allowed(uuid, bigint) from public, anon;
grant execute on function public.profile_org_change_allowed(uuid, bigint) to authenticated, service_role;

create or replace function public.user_profiles_guard_identity()
returns trigger
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Only police direct client writes (PostgREST anon/authenticated). service_role and
  -- SECURITY DEFINER functions (accept_team_invite, switch, etc.) run as other roles.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if lower(coalesce(new.role, '')) = 'admin'
     and (tg_op = 'INSERT' or lower(coalesce(old.role, '')) <> 'admin') then
    raise exception 'Not allowed to set this role' using errcode = '42501';
  end if;

  if (tg_op = 'INSERT' or new.organization_id is distinct from old.organization_id)
     and not public.profile_org_change_allowed(new.id, new.organization_id) then
    raise exception 'Not a member of that organization' using errcode = '42501';
  end if;

  if (tg_op = 'INSERT' or new.active_organization_id is distinct from old.active_organization_id)
     and not public.profile_org_change_allowed(new.id, new.active_organization_id) then
    raise exception 'Not a member of that organization' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists user_profiles_guard_identity on public.user_profiles;
-- Name sorts before user_profiles_sync_membership so it runs first.
create trigger user_profiles_guard_identity
  before insert or update of organization_id, role, active_organization_id
  on public.user_profiles
  for each row execute function public.user_profiles_guard_identity();
