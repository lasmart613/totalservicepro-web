import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(here, '../supabase/migrations/20261006_000500_supabase_advisor_hardening.sql'),
  'utf8'
);

test('default privileges drop truncate and anon writes, and issue reports keep anon INSERT', () => {
  assert.match(sql, /REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon/);
  assert.match(sql, /REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated/);
  assert.match(sql, /GRANT INSERT ON TABLE public\.product_issue_reports TO anon/);
  assert.match(sql, /leaked password protection/i);
  assert.doesNotMatch(sql, /auth\.config|UPDATE auth\.|leaked_password_protection\s*=\s*true/i);
});

test('definer functions are revoked from anon and get_my_org_id requires a membership', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM anon/);
  assert.match(sql, /p\.prosecdef/);
  assert.match(sql, /FROM public\.organization_memberships m/);
  assert.match(sql, /p\.active_organization_id/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.doesNotMatch(
    sql,
    /SELECT organization_id FROM public\.user_profiles WHERE id = auth\.uid\(\) LIMIT 1/
  );
  const orgFn = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.get_my_org_id()'),
    sql.indexOf('COMMENT ON FUNCTION public.get_my_org_id()')
  );
  assert.match(orgFn, /LANGUAGE sql/);
  assert.doesNotMatch(orgFn, /information_schema|to_regclass|LANGUAGE plpgsql/);
  const userOrg = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.user_org_id()'),
    sql.indexOf('COMMENT ON FUNCTION public.user_org_id()')
  );
  assert.match(userOrg, /LANGUAGE sql/);
  assert.match(userOrg, /get_my_org_id\(\)/);
});

test('open service request view is security invoker over a redacted definer', () => {
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /list_open_service_requests/);
  assert.match(sql, /FROM public\.list_open_service_requests\(\)/);
  assert.match(sql, /status IN \('open', 'bidding'\)/);
  assert.doesNotMatch(sql, /security_invoker = false/);
  for (const hidden of ['images', 'equipment_id', 'photo_url', 'serial_number', 'facility_contact']) {
    assert.equal(sql.includes(`'${hidden}'`), false, hidden);
  }
});

test('zero-policy tables stay service-role except catalog reads and issue insert', () => {
  for (const table of [
    'product_issue_reports',
    'clinic_service_leads',
    'god_email_sends',
    'manual_search_index',
  ]) {
    assert.match(sql, new RegExp(table));
  }
  assert.match(sql, /CREATE POLICY "read manufacturers"/);
  assert.match(sql, /CREATE POLICY "read laser_models"/);
  assert.match(sql, /manufacturers_insert_name/);
  assert.match(sql, /nullif\(btrim\(name\), ''\) IS NOT NULL/);
  assert.match(
    sql,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.manufacturers FROM PUBLIC, anon, authenticated/
  );
  assert.match(sql, /GRANT INSERT ON TABLE public\.manufacturers TO authenticated/);
  assert.doesNotMatch(sql, /GRANT INSERT, UPDATE ON TABLE public\.manufacturers/);
  assert.match(sql, /DROP POLICY IF EXISTS manufacturers_update_name/);
  assert.doesNotMatch(sql, /CREATE POLICY manufacturers_update_name/);
  assert.doesNotMatch(sql, /FOR INSERT TO authenticated WITH CHECK \(true\)/);
  assert.doesNotMatch(sql, /FOR UPDATE TO authenticated USING \(true\)/);

  const route = readFileSync(join(here, '../app/api/catalog/manufacturers/route.ts'), 'utf8');
  assert.match(route, /getSupabaseAdmin\(\)/);
  assert.match(route, /\.insert\(\{ name \}\)/);
  assert.doesNotMatch(route, /\.update\(/);
  assert.doesNotMatch(route, /\.upsert\(/);
  const helper = readFileSync(join(here, 'remember-manufacturer.ts'), 'utf8');
  assert.match(helper, /\/api\/catalog\/manufacturers/);
  assert.doesNotMatch(helper, /\.upsert\(|\.update\(/);
  for (const page of ['../app/service-requests/page.tsx', '../app/marketplace/list/page.tsx']) {
    const src = readFileSync(join(here, page), 'utf8');
    assert.match(src, /rememberManufacturerName/);
    assert.doesNotMatch(src, /from\('manufacturers'\)\.upsert/);
  }
  assert.match(sql, /RLS enabled with no policy/);
  assert.match(sql, /list_open_service_requests/);
  assert.match(sql, /security_invoker = true/);
});
