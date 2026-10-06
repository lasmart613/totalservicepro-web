-- Owner applies this in the Supabase SQL editor. The app does not run it.
-- Nullable. No backfill. Existing rows stay null until a new signup records consent.
-- legal_consent_version stores the app constant LEGAL_VERSION (currently 2026-10-draft).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS legal_consent_at timestamptz;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS legal_consent_version text;

COMMENT ON COLUMN public.user_profiles.legal_consent_at IS
  'When the user agreed to the Terms of Service and Privacy Policy. Null until recorded.';

COMMENT ON COLUMN public.user_profiles.legal_consent_version IS
  'LEGAL_VERSION they agreed to, e.g. 2026-10-draft.';
