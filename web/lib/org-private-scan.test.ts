import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { columnsInLogicString, scanOrgPrivateUse, stringConstants } from './org-private-scan.ts';
import {
  SIGNED_IN_DIRECTORY_COLUMNS,
  isListedDirectoryRow,
  loadSignedInDirectory,
  toSignedInDirectoryRow,
} from './directory/listed.ts';
import { ORG_PRIVATE_COLUMNS } from './org-columns.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(web, p), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (f === 'node_modules' || f.startsWith('.')) return [];
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|mjs|js)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

/**
 * Files that take an injected service-role client (callers pass getSupabaseAdmin()).
 * Each entry is checked below: its only callers are service-role routes.
 */
const INJECTED_ADMIN = new Map<string, string[]>([
  ['lib/signup-trial.ts', ['app/api/org/founder/route.ts']],
  ['lib/org-private-scan.ts', []],
]);

test('hotfix: no user-scoped code selects, filters or orders on an organizations private column', () => {
  const files = ['app', 'components', 'lib', 'hooks']
    .flatMap((d) => {
      try {
        return walk(join(web, d));
      } catch {
        return [];
      }
    });
  const sources = files.map((f) => readFileSync(f, 'utf8'));
  const constants = stringConstants(sources);
  const offenders: string[] = [];
  files.forEach((file, i) => {
    const rel = relative(web, file);
    if (INJECTED_ADMIN.has(rel)) return;
    for (const f of scanOrgPrivateUse(sources[i], constants)) offenders.push(`${rel} ${f}`);
  });
  assert.deepEqual(offenders, []);
  for (const [file, callers] of INJECTED_ADMIN) {
    for (const c of callers) assert.match(read(c), /getSupabaseAdmin\)?\(\)/, `${file} caller ${c}`);
  }
});

test('hotfix: the scanner catches selects, filters, orders, embeds and .or() strings (incl. constants)', () => {
  const k = new Map([['NOT_IMPORTED', 'notes.is.null,notes.not.imatch."x"']]);
  const cases: Array<[string, RegExp]> = [
    [`supabase.from('organizations').select('id, notes')`, /select notes/],
    [`supabase.from('organizations').select('id').eq('lead_source', 'x')`, /\.eq\('lead_source'\)/],
    [`supabase.from('organizations').select('id').ilike('tax_id', '%1%')`, /ilike\('tax_id'\)/],
    [`supabase.from('organizations').select('id').not('prospect_pool', 'is', null)`, /\.not\('prospect_pool'\)/],
    [`supabase.from('organizations').select('id').is('trial_granted_at', null)`, /\.is\('trial_granted_at'\)/],
    [`supabase.from('organizations').select('id').order('notes')`, /\.order\('notes'\)/],
    [`supabase.from('organizations').select('id').or('name.ilike.*a*,stripe_account_id.is.null')`, /\.or\(\) on stripe_account_id/],
    [`supabase.from('organizations').select('id').or(NOT_IMPORTED)`, /\.or\(\) on notes/],
    [`supabase.from('x').select('a, organizations:org_id (id, creator_shop_org_id)')`, /embed organizations\(creator_shop_org_id\)/],
    [`supabase.from('x').select('a, organizations(id)').eq('organizations.notes', 'y')`, /organizations\.notes/],
  ];
  for (const [src, re] of cases) assert.match(scanOrgPrivateUse(src, k).join('\n'), re, src);
  // Clean code and service-role code pass.
  assert.deepEqual(scanOrgPrivateUse(`supabase.from('organizations').select('id, name').eq('list_in_directory', true)`, k), []);
  assert.deepEqual(scanOrgPrivateUse(`const a = getSupabaseAdmin(); a.from('organizations').select('notes')`, k), []);
  // notes on other tables is fine.
  assert.deepEqual(scanOrgPrivateUse(`supabase.from('service_requests').select('id, notes').order('notes')`, k), []);
  assert.deepEqual(columnsInLogicString('notes.is.null,and(name.eq.x,tax_id.ilike.*1*)'), ['notes', 'name', 'tax_id']);
});

test('hotfix: signed-in directory goes through the service-role route, not a notes filter', () => {
  const page = read('app/directory/page.tsx');
  assert.match(page, /fetch\('\/api\/directory\/listed'/);
  assert.match(page, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.doesNotMatch(page, /DIRECTORY_NOT_IMPORTED_OR|notes\./);
  const route = read('app/api/directory/listed/route.ts');
  assert.match(route, /status: 401/);
  assert.match(route, /auth\.getUser\(token\)/);
  assert.ok(route.indexOf('auth.getUser(token)') < route.indexOf('getSupabaseAdmin()'), 'session check before service role');
  assert.match(route, /loadSignedInDirectory\(getSupabaseAdmin\(\)\)/);
  assert.match(route, /private, no-store/);
  for (const c of ORG_PRIVATE_COLUMNS) assert.ok(!(SIGNED_IN_DIRECTORY_COLUMNS as readonly string[]).includes(c), c);
});

test('hotfix: listed rows use the public_directory_page exclusions', () => {
  const base = { id: 1, name: 'A', list_in_directory: true, is_active: true };
  assert.equal(isListedDirectoryRow(base), true);
  assert.equal(isListedDirectoryRow({ ...base, is_active: null }), true);
  assert.equal(isListedDirectoryRow({ ...base, list_in_directory: null }), false);
  assert.equal(isListedDirectoryRow({ ...base, is_active: false }), false);
  assert.equal(isListedDirectoryRow({ ...base, notes: 'Import: intl-clinics-1018' }), false);
  assert.equal(isListedDirectoryRow({ ...base, notes: 'reimport : x' }), false);
  assert.equal(isListedDirectoryRow({ ...base, notes: 'Important customer' }), true);
  assert.equal(isListedDirectoryRow({ ...base, prospect_pool: 'amer-clinics-1018' }), false);
  assert.equal(isListedDirectoryRow({ ...base, prospect_pool: 'true' }), false);
  assert.equal(isListedDirectoryRow({ ...base, prospect_pool: true }), false);
  for (const pp of [null, '', 'false', 'f', false]) assert.equal(isListedDirectoryRow({ ...base, prospect_pool: pp }), true, String(pp));
  assert.equal(isListedDirectoryRow({ ...base, lead_source: 'clinic_service_lead' }), false);
  assert.equal(isListedDirectoryRow({ ...base, lead_source: '' }), true);
});

test('hotfix: loadSignedInDirectory strips the exclusion columns and keeps name order', async () => {
  const rows = [
    { id: 1, name: 'Alpha', type: 'service_company', list_in_directory: true, is_active: true, notes: 'secret', tax_id: 'x', prospect_pool: null, lead_source: null },
    { id: 2, name: 'Beta', list_in_directory: true, notes: 'Import: amer-clinics-1018' },
    { id: 3, name: 'Gamma', list_in_directory: true, prospect_pool: 'intl-clinics-1018' },
    { id: 4, name: 'Delta', list_in_directory: true, lead_source: 'lead' },
    { id: 5, name: 'Eps', list_in_directory: true, is_active: null },
  ];
  const calls: string[] = [];
  const chain: any = {
    select(s: string) { calls.push(`select ${s}`); return chain; },
    eq(c: string, v: unknown) { calls.push(`eq ${c}=${v}`); return chain; },
    order(c: string) { calls.push(`order ${c}`); return chain; },
    range(from: number) { return Promise.resolve({ data: from === 0 ? rows : [], error: null }); },
  };
  const r = await loadSignedInDirectory({ from: (t: string) => { calls.push(`from ${t}`); return chain; } });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.listings.map((x) => x.id), [1, 5]);
  assert.equal(r.total, 2);
  for (const row of r.listings) {
    assert.deepEqual(Object.keys(row).sort(), [...SIGNED_IN_DIRECTORY_COLUMNS].sort());
    for (const c of ORG_PRIVATE_COLUMNS) assert.ok(!(c in row), c);
  }
  assert.ok(calls.includes('eq list_in_directory=true'));
  assert.ok(calls.includes('order name'));
  assert.deepEqual(toSignedInDirectoryRow({ id: 9 }).name, null);
  const bad: any = { select: () => bad, eq: () => bad, order: () => bad, range: () => Promise.resolve({ data: null, error: { message: 'x' } }) };
  const failed = await loadSignedInDirectory({ from: () => bad });
  assert.equal(failed.ok, false);
});

test('#326 nit: Find clinics shows "Already in your customers" for already_linked', () => {
  const page = read('app/find-clinics/page.tsx');
  assert.match(page, /j\.status === 'already_linked' \? t\('Already in your customers'\) : t\('Added to your customers\.'\)/);
  const copy = read('lib/i18n/app-copy.ts');
  const line = copy.split('\n').find((l) => l.includes('"Already in your customers": row('));
  assert.ok(line);
  assert.equal((line!.match(/"[^"]+"/g) || []).length, 9, 'key + 8 locales');
});
