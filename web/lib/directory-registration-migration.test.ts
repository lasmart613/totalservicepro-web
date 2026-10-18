import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = join(web, 'supabase/migrations/20261018_000926_directory_registration.sql');
const rb = join(web, 'supabase/migrations/20261018_000926_directory_registration_rollback.sql');
const sql = readFileSync(mig, 'utf8');
const code = sql.replace(/--.*$/gm, '');

test('000926 follows migration standards', () => {
  assert.match(code, /^SET LOCAL lock_timeout = '5s';/m);
  assert.doesNotMatch(code, /pg_catalog\.(extract|coalesce)\s*\(/i);
  const fns = code.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assert.equal(fns.length, 7);
  assert.equal((code.match(/SECURITY DEFINER/g) ?? []).length, 7);
  assert.equal((code.match(/SET search_path = ''/g) ?? []).length, 7);
  assert.match(code, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
  assert.match(code, /GRANT EXECUTE ON FUNCTION %s TO service_role/);
  assert.doesNotMatch(code, /GRANT [^;]*TO (anon|authenticated)/);
  assert.match(code, /CREATE TABLE IF NOT EXISTS public\.directory_registrations/);
  assert.match(code, /REVOKE ALL ON TABLE public\.directory_registration_attempts FROM PUBLIC, anon, authenticated, service_role/);
});

test('000926 inserts orgs unlisted and inactive, never touches listing in step 2', () => {
  assert.match(code, /VALUES \(v_name, v_type, v_email, v_state, v_zip, false, false, false,/);
  const step2 = code.slice(code.indexOf('directory_registration_step2('));
  const update = step2.slice(step2.indexOf('UPDATE public.organizations SET'), step2.indexOf('WHERE id = o.id'));
  for (const col of ['list_in_directory', 'is_active', 'type', 'is_premium', 'plan', 'created_by', 'name', 'email', 'stripe']) {
    assert.doesNotMatch(update, new RegExp(`\\n\\s*${col}\\s*=`), col);
  }
});

test('000926 has an exact rollback', () => {
  assert.ok(existsSync(rb));
  const r = readFileSync(rb, 'utf8');
  for (const m of code.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(/g)) assert.match(r, new RegExp(`DROP FUNCTION IF EXISTS ${m[1].replace('.', '\\.')}\\(`));
  for (const m of code.matchAll(/CREATE TABLE IF NOT EXISTS (public\.\w+)/g)) assert.match(r, new RegExp(`DROP TABLE IF EXISTS ${m[1].replace('.', '\\.')};`));
});

test('guest directory still hides inactive orgs and signed-in directory needs list_in_directory', () => {
  const api = readFileSync(join(web, 'app/api/directory/route.ts'), 'utf8');
  assert.match(api, /o\.is_active !== false/);
  const page = readFileSync(join(web, 'app/directory/page.tsx'), 'utf8');
  assert.match(page, /\.eq\('list_in_directory', true\)/);
});

test('edge function CORS default is the medicalrepairnetwork.com apex and www', () => {
  const c = readFileSync(join(web, '../supabase/functions/register-directory-org/contract.ts'), 'utf8');
  assert.match(c, /'https:\/\/medicalrepairnetwork\.com',\s*'https:\/\/www\.medicalrepairnetwork\.com'/);
  assert.doesNotMatch(c, /Access-Control-Allow-Origin': '\*'/);
});
