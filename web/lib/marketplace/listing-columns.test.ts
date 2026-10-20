import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LISTING_PRIVATE_COLUMNS,
  LISTING_PUBLIC_SELECT,
  LISTING_PUBLIC_SELECT_LEGACY,
  isMissingDetailsPublic,
  loadListingPrivateFields,
  withListingColumns,
} from './listing-columns.ts';
import { sanitizeShareListingDetails } from '../share-listing-public.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = join(web, '..');
const read = (p: string) => readFileSync(p, 'utf8');
const MIG = join(web, 'supabase/migrations/20261019_000935_marketplace_listings_private_columns.sql');
const RB = join(web, 'supabase/migrations/20261019_000935_marketplace_listings_private_columns_rollback.sql');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'out', 'build', 'dist'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|js|html)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test('public select never names a private column, aliases details_public to details', () => {
  const cols = LISTING_PUBLIC_SELECT.split(',').map((c) => c.trim());
  for (const c of LISTING_PRIVATE_COLUMNS) assert.ok(!cols.includes(c), c);
  assert.ok(cols.includes('details:details_public'));
  assert.ok(!cols.includes('*'));
  assert.ok(LISTING_PUBLIC_SELECT_LEGACY.split(', ').includes('details'));
  assert.ok(!LISTING_PUBLIC_SELECT_LEGACY.includes('serial_number'));
  assert.ok(!LISTING_PUBLIC_SELECT_LEGACY.includes('notes'));
});

test('withListingColumns retries with the legacy list only when details_public is missing', async () => {
  const seen: string[] = [];
  const r1 = await withListingColumns(async (c) => {
    seen.push(c);
    return seen.length === 1
      ? { data: null, error: { message: 'column marketplace_listings.details_public does not exist' } }
      : { data: [1], error: null };
  });
  assert.deepEqual(seen, [LISTING_PUBLIC_SELECT, LISTING_PUBLIC_SELECT_LEGACY]);
  assert.equal(r1.error, null);
  seen.length = 0;
  const r2 = await withListingColumns(async (c) => {
    seen.push(c);
    return { data: null, error: { message: 'permission denied for table marketplace_listings', code: '42501' } };
  });
  assert.equal(seen.length, 1, 'a permission error is not retried with the legacy list');
  assert.equal(r2.error?.code, '42501');
  assert.equal(isMissingDetailsPublic(null), false);
});

test('loadListingPrivateFields: RPC data for sellers, null otherwise', async () => {
  const ok = await loadListingPrivateFields(
    { rpc: async () => ({ data: { serial_number: 'SN', notes: 'n', details: { a: 1 } }, error: null }) },
    'x',
  );
  assert.deepEqual(ok, { serial_number: 'SN', notes: 'n', details: { a: 1 } });
  assert.equal(await loadListingPrivateFields({ rpc: async () => ({ data: null, error: null }) }, 'x'), null);
  assert.equal(await loadListingPrivateFields({ rpc: async () => ({ data: null, error: { message: 'no fn' } }) }, 'x'), null);
  assert.equal(await loadListingPrivateFields({ rpc: async () => { throw new Error('net'); } }, 'x'), null);
});

test('no user-scoped select(*) or private-column select on marketplace_listings (web + Android assets)', () => {
  const files = [...walk(join(web, 'app')), ...walk(join(web, 'components')), ...walk(join(web, 'lib')), ...walk(join(repo, 'app/src/main/assets'))];
  const bad: string[] = [];
  for (const f of files) {
    const src = read(f);
    const re = /\.from\(\s*['"]marketplace_listings['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 120), m.index);
      if (/admin|writer/i.test(before)) continue; // service-role clients
      const after = src.slice(m.index, m.index + 400).split(/;\s*\n/)[0];
      const sel = /\.select\(\s*(['"`])([^'"`]*)\1/.exec(after);
      if (!sel) continue;
      const cols = sel[2].split(',').map((c) => c.trim());
      if (cols.includes('*') || cols.some((c) => ['serial_number', 'notes'].includes(c))) {
        bad.push(`${relative(repo, f)}: ${sel[2].slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('000935 migration: standards, private columns, MAINTAIN, policy, RPC', () => {
  const sql = read(MIG);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;\s*$/m);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /000935 drift:/);
  assert.match(sql, /REVOKE MAINTAIN ON public\.marketplace_listings FROM anon, authenticated;/);
  assert.match(sql, /REVOKE SELECT ON public\.marketplace_listings FROM anon, authenticated;/);
  assert.match(sql, /ARRAY\['serial_number', 'notes', 'details'\]/);
  assert.match(sql, /GENERATED ALWAYS AS \(public\.marketplace_public_details\(details\)\) STORED/);
  assert.match(sql, /FUNCTION public\.marketplace_listing_private\(p_id uuid\)[\s\S]*SECURITY DEFINER\nSET search_path = ''/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.marketplace_listing_private\(uuid\) TO authenticated, service_role;/);
  assert.doesNotMatch(sql.slice(sql.indexOf('CREATE POLICY')), /'draft'/);
  const rb = read(RB);
  assert.match(rb, /GRANT SELECT, MAINTAIN ON public\.marketplace_listings TO anon, authenticated;/);
  assert.match(rb, /'sold'::text, 'draft'::text\]/);
  assert.match(rb, /DROP COLUMN IF EXISTS details_public/);
});

test('SQL sanitizer rule matches sanitizeShareListingDetails on the proof fixture', () => {
  const fixture = {
    sku: 'SKU-1', stripe_product_id: 'prod_1', stripe_price_id: 'price_1', stripe_price_cents: 12300,
    Seller_Email: 's@x.test', shipping: { Price_Stripe_Id: 'p', days: 3 },
    compatible_models: [{ contact_phone: '1', m: 'GentleLase' }], warranty: '90 days',
  };
  // Expected value asserted by supabase/tests/20261019_marketplace_listings_private_columns.sql
  assert.deepEqual(sanitizeShareListingDetails(fixture), {
    sku: 'SKU-1', shipping: { days: 3 }, compatible_models: [{ m: 'GentleLase' }], warranty: '90 days',
  });
});
