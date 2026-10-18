#!/usr/bin/env bash
# Drift-guard proof for 000927. Local Postgres 17 only (never production).
# Each case builds the base in a fresh transaction, alters one live policy,
# applies 000927 and expects it to RAISE. Usage: PGDB=sec1018_drift ./this.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../migrations/20261018_000927_security_weekly_1018.sql"
db="${PGDB:-sec1018_drift}"
base=$(sed -n '/^CREATE SCHEMA IF NOT EXISTS auth;/,/^INSERT INTO public.organizations/p' "$here/20261018_security_weekly_1018.sql" | sed '$d')
pass=0; fail=0
run_case() {
  local label="$1" tweak="$2"
  out=$( { echo "\\set ON_ERROR_STOP on"; echo "BEGIN;"; echo "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END \$\$;"; echo "$base"; echo "$tweak"; cat "$mig"; echo "ROLLBACK;"; } | psql -X -q "postgresql:///$db" 2>&1)
  if echo "$out" | grep -q "000927: .*differs\|000927: a function named"; then echo "PASS $label"; pass=$((pass+1)); else echo "FAIL $label"; echo "$out" | tail -3; fail=$((fail+1)); fi
}
# Control: the untouched live base applies cleanly.
out=$( { echo "\\set ON_ERROR_STOP on"; echo "BEGIN;"; echo "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END \$\$;"; echo "$base"; cat "$mig"; echo "ROLLBACK;"; } | psql -X -q "postgresql:///$db" 2>&1)
if echo "$out" | grep -q "000927 ok" && ! echo "$out" | grep -q ERROR; then echo "PASS control: live base applies"; pass=$((pass+1)); else echo "FAIL control"; echo "$out" | grep ERROR | head -3; fail=$((fail+1)); fi
run_case "changed uploads policy blocks" 'DROP POLICY "Allow authenticated logo uploads" ON storage.objects; CREATE POLICY "Allow authenticated logo uploads" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = '"'"'logos'"'"'::text AND owner = auth.uid());'
run_case "changed updates policy blocks" 'DROP POLICY "Allow authenticated logo updates" ON storage.objects; CREATE POLICY "Allow authenticated logo updates" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = '"'"'logos'"'"'::text AND owner = auth.uid());'
run_case "changed delete_own blocks" 'DROP POLICY organization_memberships_delete_own ON public.organization_memberships; CREATE POLICY organization_memberships_delete_own ON public.organization_memberships FOR DELETE TO authenticated USING (false);'
run_case "foreign ai_usage_reserve name blocks" 'CREATE FUNCTION public.ai_usage_reserve(uuid, text, integer) RETURNS jsonb LANGUAGE sql AS $f$ SELECT NULL::jsonb $f$;'
run_case "foreign logos_auth_upload form blocks" 'CREATE POLICY logos_auth_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (true);'
run_case "changed logos mime blocks" "UPDATE storage.buckets SET allowed_mime_types = ARRAY['image/png'] WHERE id = 'logos';"
echo "drift pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
