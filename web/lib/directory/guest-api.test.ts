import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_DIRECTORY_RPC,
  isPublicDirectoryRow,
  loadGuestDirectoryPage,
  type DirectoryRpc,
  type PublicDirectoryRow,
} from './guest-api.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MIG = join(here, '../../supabase/migrations/20261018_000931_public_directory_page.sql');
const RB = join(here, '../../supabase/migrations/20261018_000931_public_directory_page_rollback.sql');

const ORGS: (PublicDirectoryRow & { name: string; phone?: string })[] = [
  { id: 1, name: 'Listed Repair', type: 'service_company', state: 'CA', list_in_directory: true, is_active: true, phone: '555-0100' },
  { id: 2, name: 'Unlisted Clinic', type: 'laser_clinic', state: 'TX', list_in_directory: false, is_active: true },
  { id: 3, name: 'Intl Import', type: 'laser_clinic', state: 'NY', list_in_directory: true, notes: 'Import: intl-clinics-1018\nCountry: UK' },
  { id: 4, name: 'Amer Import', type: 'customer', state: 'FL', list_in_directory: true, notes: 'Import: amer-clinics-1018' },
  { id: 5, name: 'Egypt Import', type: 'laser_clinic', state: null, list_in_directory: true, notes: 'Import: egypt-clinics-1018' },
  { id: 6, name: 'Prospect', type: 'laser_clinic', state: 'CA', list_in_directory: true, prospect_pool: true },
  { id: 7, name: 'Lead', type: 'laser_clinic', state: 'CA', list_in_directory: true, lead_source: 'find_a_rep' },
  { id: 8, name: 'Inactive', type: 'service_company', state: 'WA', list_in_directory: true, is_active: false },
  { id: 10, name: 'Spaced Import', type: 'laser_clinic', state: 'CA', list_in_directory: true, notes: 'IMPORT : amer-clinics-1018' },
  { id: 11, name: 'Reimport', type: 'laser_clinic', state: 'CA', list_in_directory: true, notes: 'reimport: intl-clinics-1018' },
  { id: 12, name: 'Text Prospect', type: 'service_company', state: 'CA', list_in_directory: true, prospect_pool: 'amer-clinics-1018' },
  { id: 9, name: 'Listed Supplier', type: 'parts_supplier', state: 'OR', list_in_directory: true, notes: 'important: ships fast' },
];
const FORBIDDEN = [2, 3, 4, 5, 6, 7, 8, 10, 11, 12];

/** Mirrors the 000931 SQL filter. */
function fakeRpc(source = ORGS, calls: unknown[] = []): DirectoryRpc {
  return async (fn, args) => {
    calls.push({ fn, args });
    const listed = source
      .filter((o) => o.list_in_directory === true && o.is_active !== false)
      .filter((o) => !args.p_types || args.p_types.includes(String(o.type)))
      .filter((o) => !/(^|[^a-z])(re)?import\s*:/i.test(o.notes || ''))
      .filter((o) => !['', 'false', 'f'].includes(String(o.prospect_pool ?? '').trim().toLowerCase()) ? false : !(o.lead_source || '').trim())
      .sort((a, b) => Number(a.id) - Number(b.id));
    const rows = listed.slice(args.p_offset, args.p_offset + args.p_limit).map((o) => ({ id: o.id, type: o.type, region: o.state === 'CA' ? 'West' : o.state === 'OR' ? 'West' : null }));
    return { data: { rows, total: listed.length }, error: null };
  };
}

test('logged-out page returns listed orgs only, with a listed-only total', async () => {
  const calls: any[] = [];
  const r = await loadGuestDirectoryPage(fakeRpc(ORGS, calls), { page: '1', limit: '36', filter: 'all' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.listings.map((c) => c.id), [1, 9]);
  assert.equal(r.total, 2);
  assert.equal(r.hasMore, false);
  assert.equal(calls[0].fn, PUBLIC_DIRECTORY_RPC);
  const blob = JSON.stringify(r);
  for (const o of ORGS) assert.doesNotMatch(blob, new RegExp(o.name));
  assert.doesNotMatch(blob, /555-0100|"CA"|"OR"/);
  assert.deepEqual(r.listings.map((c) => c.region), ['West', 'West']);
});

test('imported, unlisted, prospect and lead orgs never appear on any filter or page', async () => {
  for (const filter of ['all', 'service', 'clinics', 'reseller', 'rental', 'supplier']) {
    for (const page of ['1', '2', '3']) {
      const r = await loadGuestDirectoryPage(fakeRpc(), { page, limit: '1', filter });
      assert.equal(r.ok, true);
      if (!r.ok) continue;
      for (const c of r.listings) assert.ok(!FORBIDDEN.includes(Number(c.id)), `${filter}/${page} leaked ${c.id}`);
    }
  }
  const clinics = await loadGuestDirectoryPage(fakeRpc(), { filter: 'clinics' });
  assert.ok(clinics.ok && clinics.total === 0 && clinics.listings.length === 0);
});

test('defense in depth: a bad RPC row is dropped even if the database returned it', async () => {
  const leaky: DirectoryRpc = async () => ({
    data: { rows: ORGS.map(({ id, type, state, notes, list_in_directory, is_active, prospect_pool, lead_source }) => ({ id, type, state, notes, list_in_directory, is_active, prospect_pool, lead_source })), total: 9 },
    error: null,
  });
  const r = await loadGuestDirectoryPage(leaky, { limit: '48' });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.listings.map((c) => c.id), [1, 9]);
  for (const id of FORBIDDEN) assert.equal(isPublicDirectoryRow(ORGS.find((o) => o.id === id)), false);
});

test('RPC errors return a generic 503 with no database message', async () => {
  const r = await loadGuestDirectoryPage(async () => ({ data: null, error: { message: 'permission denied for table organizations' } }), {});
  assert.deepEqual(r, { ok: false, status: 503 });
});

test('paging is clamped and hasMore uses the listed total', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Org ${i}`, type: 'service_company', state: 'CA', list_in_directory: true }));
  const calls: any[] = [];
  const r = await loadGuestDirectoryPage(fakeRpc(many, calls), { page: '2', limit: '36' });
  assert.ok(r.ok && r.listings.length === 36 && r.hasMore && r.total === 100);
  await loadGuestDirectoryPage(fakeRpc(many, calls), { page: '999999', limit: '5000' });
  assert.equal(calls[1].args.p_limit, 48);
  assert.ok(calls[1].args.p_offset <= 199 * 48);
});

test('a non-region value from the RPC never reaches the card', async () => {
  const rpc: DirectoryRpc = async () => ({ data: { rows: [{ id: 1, type: 'service_company', region: 'TX' }, { id: 2, type: 'service_company', region: 'South' }], total: 2 }, error: null });
  const r = await loadGuestDirectoryPage(rpc, {});
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.listings.map((c) => c.region), [null, 'South']);
});

test('000931 migration: listed-only definer RPC, narrow grants, standards', () => {
  const sql = readFileSync(MIG, 'utf8');
  assert.match(sql, /^BEGIN;\s*\n\s*SET LOCAL lock_timeout = '5s';/m);
  assert.match(sql.trimEnd(), /COMMIT;$/);
  assert.match(sql, /region_map\(k, region\)/);
  assert.match(sql, /\('TX', 'South'\)/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /o\.list_in_directory IS TRUE/);
  assert.match(sql, /o\.is_active IS DISTINCT FROM false/);
  assert.match(sql, /import:/i);
  assert.match(sql, /'prospect_pool'/);
  assert.match(sql, /'lead_source'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.public_directory_page\(text\[\], integer, integer\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.public_directory_page\(text\[\], integer, integer\) TO anon, authenticated, service_role/);
  assert.match(sql, /000931 drift/);
  assert.doesNotMatch(sql, /pg_catalog\.(extract|coalesce)\b/i);
  // Only id/type/state are emitted.
  assert.match(sql, /jsonb_build_object\('id', p\.id, 'type', p\.type, 'region', p\.region\)/);
  const rb = readFileSync(RB, 'utf8');
  assert.match(rb, /DROP FUNCTION IF EXISTS public\.public_directory_page\(text\[\], integer, integer\)/);
  assert.match(rb, /rollback refused/);
  assert.match(rb, /^BEGIN;/m);
  assert.match(rb.trimEnd(), /COMMIT;$/);
});
