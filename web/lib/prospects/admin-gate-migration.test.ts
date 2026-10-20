import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadErrorKey, parseProspectResponse, FIND_CLINICS_ASK_ADMIN } from './find-clinics.ts';
import { appStrings } from '../i18n/app-copy.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(join(web, p), 'utf8');
const M = 'supabase/migrations/20261019_000934_find_clinics_admin_gate.sql';
const R = 'supabase/migrations/20261019_000934_find_clinics_admin_gate_rollback.sql';

test('000934: transaction, lock_timeout, drift guards, SECURITY DEFINER with empty search_path', () => {
  const sql = read(M);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;\s*$/m);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /000934 drift: find_clinic_prospects was not created by 000933\/000934/);
  assert.match(sql, /VOLATILE\nSECURITY DEFINER\nSET search_path = ''/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.prospect_org_locality FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.prospect_query_log FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.find_clinic_prospects\(text, text, int, int\) TO authenticated;/);
});

test('000934: owner/company_admin/admin only, snapshot locality, rate limit and offset cap', () => {
  const sql = read(M);
  assert.match(sql, /v_role NOT IN \('owner', 'company_admin', 'admin'\) THEN\n\s*RETURN jsonb_build_object\('error', 'not_admin'\)/);
  assert.match(sql, /ON CONFLICT \(organization_id\) DO NOTHING;/);
  assert.match(sql, /FROM public\.prospect_org_locality l WHERE l\.organization_id = v_org/);
  assert.match(sql, /IF v_recent >= 30 THEN/);
  assert.match(sql, /IF v_paid AND v_offset > 5000 THEN/);
  // ranking must not read the client-editable organizations location any more
  assert.doesNotMatch(sql, /public\.prospect_city_key\(o\.city\)/);
});

test('000934 rollback restores the 000933 function and drops the tables', () => {
  const rb = read(R);
  const m933 = read('supabase/migrations/20261018_000933_find_clinics_locality.sql');
  const fn = m933.slice(m933.indexOf('CREATE OR REPLACE FUNCTION public.find_clinic_prospects('), m933.indexOf('REVOKE ALL ON FUNCTION public.prospect_fold'));
  assert.ok(rb.includes(fn), 'rollback must contain the 000933 body verbatim');
  assert.match(rb, /DROP TABLE IF EXISTS public\.prospect_query_log;/);
  assert.match(rb, /DROP TABLE IF EXISTS public\.prospect_org_locality;/);
  assert.match(rb, /^BEGIN;$/m);
});

test('client: not_admin / rate_limited / offset_too_large map to explained messages in 8 locales', () => {
  for (const code of ['not_admin', 'rate_limited', 'offset_too_large'] as const) {
    const res = parseProspectResponse({ error: code }, null);
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.reason, code);
    const key = loadErrorKey(code)!;
    assert.ok(key);
    for (const loc of ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const) {
      const v = appStrings(loc)[key];
      assert.ok(v && v !== key, `${loc} ${key}`);
    }
  }
  assert.match(FIND_CLINICS_ASK_ADMIN, /Ask your admin/);
  assert.equal(loadErrorKey('error'), null);
  const page = read('app/find-clinics/page.tsx');
  assert.match(page, /load\.reason === 'not_admin'/);
});
