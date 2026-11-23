-- Drift proof for 000974. Own session: a wrong mime list must abort the
-- migration before any policy is replaced. Expect a non-zero psql exit.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[]::text[] $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('company-assets', 'company-assets', true, 5242880, ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']),
  ('user-avatars', 'user-avatars', true, NULL, NULL),
  ('equipment-photos', 'equipment-photos', false, NULL, NULL),
  ('part-images', 'part-images', true, NULL, ARRAY['image/gif']),
  ('marketplace-images', 'marketplace-images', false, NULL, ARRAY['image/jpeg','image/jpg']);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
CREATE TABLE public.organization_memberships (user_id uuid, organization_id bigint);
CREATE OR REPLACE FUNCTION public.auth_member_of_org(org_id bigint) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, seller_id uuid, created_by uuid,
  organization_id bigint, images jsonb, photos jsonb, details jsonb
);
\ir ../migrations/20261122_000974_storage_bucket_hardening.sql
DO $$ BEGIN RAISE EXCEPTION 'drift was not refused'; END $$;
ROLLBACK;
