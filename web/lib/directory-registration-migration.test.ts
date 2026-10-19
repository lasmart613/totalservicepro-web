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
  assert.equal(fns.length, 14);
  assert.equal((code.match(/SECURITY DEFINER/g) ?? []).length, 14);
  assert.equal((code.match(/SET search_path = ''/g) ?? []).length, 14);
  assert.match(code, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
  assert.match(code, /GRANT EXECUTE ON FUNCTION %s TO service_role/);
  assert.doesNotMatch(code, /GRANT [^;]*TO (anon|authenticated)/);
  assert.match(code, /CREATE TABLE IF NOT EXISTS public\.directory_registrations/);
  assert.match(code, /REVOKE ALL ON TABLE public\.directory_registration_attempts FROM PUBLIC, anon, authenticated, service_role/);
});

test('000926 inserts orgs unlisted and inactive, never touches listing in step 2', () => {
  assert.match(code, /VALUES \(v_name, v_type, v_email, v_state, v_zip, false, false, false,/);
  assert.doesNotMatch(code, /'status', 'review'/);
  const step2 = code.slice(code.indexOf('directory_registration_step2('));
  const update = step2.slice(step2.indexOf('UPDATE public.organizations SET'), step2.indexOf('WHERE id = o.id;'));
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
  // 000931: the guest path reads public_directory_page (is_active IS DISTINCT FROM false), plus a JS re-check.
  const api = readFileSync(join(web, 'lib/directory/guest-api.ts'), 'utf8');
  assert.match(api, /row\.is_active === false\) return false/);
  const rpc = readFileSync(join(web, 'supabase/migrations/20261018_000931_public_directory_page.sql'), 'utf8');
  assert.match(rpc, /o\.is_active IS DISTINCT FROM false/);
  const page = readFileSync(join(web, 'app/directory/page.tsx'), 'utf8');
  assert.match(page, /\.eq\('list_in_directory', true\)/);
});

test('edge function CORS default is the medicalrepairnetwork.com apex and www', () => {
  const c = readFileSync(join(web, '../supabase/functions/register-directory-org/contract.ts'), 'utf8');
  assert.match(c, /'https:\/\/medicalrepairnetwork\.com',\s*'https:\/\/www\.medicalrepairnetwork\.com'/);
  assert.doesNotMatch(c, /Access-Control-Allow-Origin': '\*'/);
});

test('000926 approval lists the org but never sets premium or plan, and never inserts a membership', () => {
  const rev = code.slice(code.indexOf('FUNCTION public.directory_registration_review('), code.indexOf('FUNCTION public.claim_directory_listing_invite('));
  assert.match(rev, /SET is_active = true, list_in_directory = true, updated_at = pg_catalog\.now\(\)\n\s*WHERE id = o\.id;/);
  assert.doesNotMatch(rev, /is_premium\s*=|plan\s*=|subscription_tier/);
  assert.doesNotMatch(rev, /INSERT INTO public\.organization_memberships|set_home_membership/);
  assert.match(rev, /issued_via\)\n\s*VALUES \(o\.id, NULL, r\.email_norm, p_reviewer_id, false, pg_catalog\.now\(\) \+ interval '30 days', 'directory_review'\)/);
  assert.match(rev, /INSERT INTO public\.directory_registration_reviews/);
});

test('000926 rollback refuses a claimed directory clinic invite and restores NOT NULL', () => {
  const r = readFileSync(rb, 'utf8');
  assert.match(r, /RAISE EXCEPTION '000926 rollback refused/);
  assert.match(r, /ALTER COLUMN service_organization_id SET NOT NULL/);
  assert.match(r, /DROP COLUMN IF EXISTS issued_via/);
});

test('000926 M-1: global cap, email key, no shared no-IP bucket, single-use ticket', () => {
  const s1 = code.slice(code.indexOf('FUNCTION public.directory_registration_step1('), code.indexOf('FUNCTION public.directory_registration_step2('));
  assert.match(s1, /key_kind = 'global' AND taken_at > v_now - interval '1 hour'\) >= 30/);
  assert.match(s1, /key_kind = 'global' AND taken_at > v_now - interval '1 day'\) >= 100/);
  assert.match(s1, /v_key text := public\.directory_email_key\(p_email\)/);
  assert.match(s1, /IF v_ip IS NOT NULL THEN\s+INSERT INTO public\.directory_registration_attempts/);
  assert.doesNotMatch(s1, /'unknown'/);
  assert.match(s1, /INSERT INTO public\.directory_form_tickets \(nonce, used_at\) VALUES \(p_ticket_nonce, v_now\)\s+ON CONFLICT \(nonce\) DO NOTHING/);
});

test('000926 M-2: a match answers created with no org id; step 1 never returns organization_id', () => {
  const s1 = code.slice(code.indexOf('FUNCTION public.directory_registration_step1('), code.indexOf('FUNCTION public.directory_registration_step2('));
  const returns = s1.match(/RETURN pg_catalog\.jsonb_build_object\('ok', true[^;]*;/g) ?? [];
  assert.equal(returns.length, 2);
  for (const r of returns) assert.equal(r, "RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'created', 'registration_id', v_reg);");
});

test('000926 strips bidi controls when storing', () => {
  assert.match(code, /\\u202a-\\u202e\\u2066-\\u2069/);
  assert.match(code, /v_name text := public\.directory_clean_text\(p_name\)/);
});

test('000926 L-12/L-14: decoy replay answers like a real replay; rollback header lists its data effects', () => {
  const s2 = code.slice(code.indexOf('FUNCTION public.directory_registration_step2('), code.indexOf('FUNCTION public.directory_registration_take_notice('));
  assert.match(s2, /INSERT INTO public\.directory_form_tickets \(nonce, used_at\) VALUES \(p_registration_id, pg_catalog\.now\(\)\)\s+ON CONFLICT \(nonce\) DO NOTHING;\s+IF NOT FOUND THEN\s+RETURN pg_catalog\.jsonb_build_object\('ok', false, 'reason', 'expired'\);/);
  const r = readFileSync(rb, 'utf8');
  for (const s of ['clinic_claim_emails rows written at approval REMAIN', 'stay listed', 'does not unlist them', 'are DELETED', 'DROPPED']) assert.ok(r.includes(s), s);
});
