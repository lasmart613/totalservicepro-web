import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORG_PRIVATE_COLUMNS,
  ORG_PROFILE_RESPONSE_COLUMNS,
  ORG_READABLE_COLUMNS,
  guardPrivateFieldWipe,
  loadOrgPrivateFields,
  privateFieldsPatch,
  withOrgPrivateFields,
} from './org-columns.ts';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const MIG = join(web, 'supabase/migrations/20261018_000932_organizations_private_columns.sql');
const RB = join(web, 'supabase/migrations/20261018_000932_organizations_private_columns_rollback.sql');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const SOURCES = ['app', 'components', 'lib'].flatMap((d) => walk(join(web, d)));
const usesServiceRole = (src: string) => /getSupabaseAdmin|createNodeServiceClient|FounderClaimAdmin|admin\.from\(/.test(src);

test('F-3: readable column list never contains a private column', () => {
  const cols = ORG_READABLE_COLUMNS.split(',').map((c) => c.trim());
  for (const p of ORG_PRIVATE_COLUMNS) assert.ok(!cols.includes(p), p);
  for (const c of ['id', 'name', 'type', 'city', 'state', 'logo_url', 'storefront_slug', 'list_in_directory', 'premium_grant', 'created_by']) {
    assert.ok(cols.includes(c), c);
  }
  assert.equal(new Set(cols).size, cols.length);
});

test('F-3: migration private set matches ORG_PRIVATE_COLUMNS exactly', () => {
  const sql = readFileSync(MIG, 'utf8');
  const m = sql.match(/a\.attname <> ALL \(ARRAY\[([^\]]+)\]\)/);
  assert.ok(m);
  const inSql = m![1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual([...inSql].sort(), [...ORG_PRIVATE_COLUMNS].sort());
});

test('F-3: no signed-in client selects * or a private column from organizations', () => {
  const offenders: string[] = [];
  for (const file of SOURCES) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(web, file);
    if (/organizations\(\s*\*\s*\)/.test(src)) offenders.push(`${rel}: organizations(*) embed`);
    if (usesServiceRole(src)) continue;
    const re = /from\(\s*['"]organizations['"]\s*\)([\s\S]{0,400})/g;
    for (const m of src.matchAll(re)) {
      const sel = m[1].match(/\.select\(\s*(['"`])([^'"`]*)\1/);
      if (!sel) continue;
      if (sel[2].trim() === '*') offenders.push(`${rel}: select('*')`);
      for (const p of ORG_PRIVATE_COLUMNS) if (new RegExp(`\\b${p}\\b`).test(sel[2])) offenders.push(`${rel}: ${p}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('F-3: own-org pages load tax_id/notes through org_private_fields', () => {
  for (const f of ['app/company/page.tsx', 'app/customers/[id]/page.tsx']) {
    const src = readFileSync(join(web, f), 'utf8');
    assert.match(src, /loadOrgPrivateFields\(supabase/, f);
    assert.match(src, /select\(ORG_READABLE_COLUMNS\)/, f);
    assert.match(src, /privateBaseline/, f);
  }
  for (const f of ['app/admin/settings/page.tsx', 'app/onboarding/page.tsx', 'app/reports/new/NewServiceReportClient.tsx']) {
    assert.match(readFileSync(join(web, f), 'utf8'), /ORG_READABLE_COLUMNS/, f);
  }
});

test('F-3: loadOrgPrivateFields only returns data the RPC allowed', async () => {
  const calls: any[] = [];
  const ok = { rpc: async (fn: string, args: any) => (calls.push({ fn, args }), { data: { tax_id: '1', notes: 'n', stripe_account_id: 'acct' }, error: null }) };
  assert.deepEqual(await loadOrgPrivateFields(ok, '10'), { tax_id: '1', notes: 'n' });
  assert.deepEqual(calls[0], { fn: 'org_private_fields', args: { p_org_id: 10 } });
  assert.equal(await loadOrgPrivateFields(ok, 'abc'), null);
  assert.equal(await loadOrgPrivateFields(ok, -1), null);
  const denied = { rpc: async () => ({ data: null, error: null }) };
  assert.equal(await loadOrgPrivateFields(denied, 20), null);
  const missing = { rpc: async () => ({ data: null, error: { message: 'function org_private_fields does not exist' } }) };
  assert.deepEqual(await withOrgPrivateFields(missing, { id: 10, name: 'A' }), { id: 10, name: 'A' });
  assert.deepEqual(await withOrgPrivateFields(ok, { id: 10, name: 'A' }), { id: 10, name: 'A', tax_id: '1', notes: 'n' });
});

test('F-3: 000932 standards: transaction, definer, grants, drift guards, exact rollback', () => {
  const sql = readFileSync(MIG, 'utf8');
  assert.match(sql, /^BEGIN;\s*\n\s*SET LOCAL lock_timeout = '5s';/m);
  assert.match(sql.trimEnd(), /COMMIT;$/);
  assert.match(sql, /REVOKE SELECT ON public\.organizations FROM anon, authenticated;/);
  assert.match(sql, /GRANT SELECT \(%s\) ON public\.organizations TO anon, authenticated/);
  assert.match(sql, /FUNCTION public\.org_private_fields\(p_org_id bigint\)[\s\S]*SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /auth_member_of_org\(o\.id\) OR public\.org_creator_access\(o\.id, o\.created_by, o\.created_at\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.org_private_fields\(bigint\) FROM anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.org_private_fields\(bigint\) TO authenticated, service_role;/);
  assert.doesNotMatch(sql, /TO anon[^;]*org_private_fields|org_private_fields\(bigint\) TO[^;]*anon/);
  assert.match(sql, /000932 drift/);
  assert.doesNotMatch(sql, /pg_catalog\.(extract|coalesce)\b/i);
  assert.match(sql, /'prospect_pool', ''\) IN \('', 'false', 'f'\)/);
  const rb = readFileSync(RB, 'utf8');
  assert.match(rb, /^BEGIN;/m);
  assert.match(rb.trimEnd(), /COMMIT;$/);
  assert.match(rb, /DROP FUNCTION IF EXISTS public\.org_private_fields\(bigint\);/);
  assert.match(rb, /GRANT SELECT ON public\.organizations TO anon, authenticated;/);
  assert.match(rb, /'prospect_pool', 'false'\) NOT IN \('true', 't'\)/);
  assert.match(rb, /'000931: logged-out directory page\./);
});

test('QA #325: 000932 comment, MAINTAIN revoke and exact rollback', () => {
  const sql = readFileSync(MIG, 'utf8');
  const rb = readFileSync(RB, 'utf8');
  const comment = sql.match(/COMMENT ON FUNCTION public\.public_directory_page[^']*'([^']*)/);
  assert.ok(comment);
  assert.match(comment[1], /^000932:/);
  assert.doesNotMatch(comment[1], /^000931:/);
  assert.match(sql, /REVOKE MAINTAIN ON public\.organizations FROM anon, authenticated;/);
  assert.match(rb, /GRANT MAINTAIN ON public\.organizations TO anon, authenticated;/);
});

test('QA #325 M-1: privateFieldsPatch only sends loaded, changed fields', () => {
  // Load failed: never send notes/tax_id (a save would wipe them).
  assert.deepEqual(privateFieldsPatch(null, { notes: '' }), {});
  assert.deepEqual(privateFieldsPatch(null, { notes: 'x', tax_id: 'y' }), {});
  // Loaded but unchanged: nothing.
  assert.deepEqual(privateFieldsPatch({ notes: 'n', tax_id: null }, { notes: 'n' }), {});
  assert.deepEqual(privateFieldsPatch({ notes: 'n', tax_id: null }, { notes: '  n  ' }), {});
  assert.deepEqual(privateFieldsPatch({ notes: null, tax_id: null }, { notes: '' }), {});
  // Changed: included.
  assert.deepEqual(privateFieldsPatch({ notes: 'n', tax_id: null }, { notes: 'm' }), { notes: 'm' });
  // Cleared on purpose: null plus an explicit clear flag for the server guard.
  assert.deepEqual(privateFieldsPatch({ notes: 'n', tax_id: null }, { notes: '' }), { notes: null, clear_notes: true });
});

test('QA #325 M-1: guardPrivateFieldWipe drops empty notes/tax_id without a clear flag', () => {
  const p1: Record<string, unknown> = { name: 'A', notes: null, tax_id: '' };
  guardPrivateFieldWipe(p1, {});
  assert.deepEqual(p1, { name: 'A' });
  const p2: Record<string, unknown> = { notes: null };
  guardPrivateFieldWipe(p2, { clear_notes: true });
  assert.deepEqual(p2, { notes: null });
  const p3: Record<string, unknown> = { notes: 'keep' };
  guardPrivateFieldWipe(p3, {});
  assert.deepEqual(p3, { notes: 'keep' });
});

test('QA #325: /api/org/profile guards wipes and returns readable columns only', () => {
  const src = readFileSync(join(web, 'app/api/org/profile/route.ts'), 'utf8');
  assert.match(src, /guardPrivateFieldWipe\(payload, body\)/);
  assert.match(src, /select\(ORG_PROFILE_RESPONSE_COLUMNS\)/);
  assert.doesNotMatch(src, /select\(['"]\*['"]\)/);
  const cols = ORG_PROFILE_RESPONSE_COLUMNS.split(',').map((c) => c.trim());
  for (const c of ['stripe_account_id', 'lead_source', 'prospect_pool', 'creator_shop_org_id', 'trial_granted_at']) {
    assert.ok(!cols.includes(c), c);
  }
  assert.ok(cols.includes('notes') && cols.includes('tax_id'));
});

test('QA #325 M-1: notes-unavailable state replaces the editor', () => {
  const form = readFileSync(join(web, 'components/CustomerInfoForm.tsx'), 'utf8');
  assert.match(form, /notesAvailable/);
  assert.match(form, /Notes unavailable right now/);
  const company = readFileSync(join(web, 'app/company/page.tsx'), 'utf8');
  assert.match(company, /Notes unavailable right now/);
  assert.doesNotMatch(company, /notes: currentOrg\.notes \?\? null/);
  assert.match(readFileSync(join(web, 'app/customers/[id]/page.tsx'), 'utf8'), /notesAvailable=\{privateBaseline != null\}/);
});
