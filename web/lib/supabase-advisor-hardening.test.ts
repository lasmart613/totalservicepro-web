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
  assert.match(sql, /RLS enabled with no policy/);
});
