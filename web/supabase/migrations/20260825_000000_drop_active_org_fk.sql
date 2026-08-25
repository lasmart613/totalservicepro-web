-- active_organization_id FK made PostgREST embeds of user_profiles → organizations
-- ambiguous (PGRST201). Header/Admin Portal then failed to load role.
-- Keep the column; drop only the extra foreign key.
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_active_organization_id_fkey;

NOTIFY pgrst, 'reload schema';
