import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isLogoPermissionError, LOGO_ACCEPT, LOGO_NO_PERMISSION, logoContentType, logoExtension, validateLogoFile } from './customer-logo.ts';
import { GAP_STRINGS } from './i18n/gap-copy.ts';

const f = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

test('logo upload accepts raster types only (no SVG)', () => {
  assert.equal(validateLogoFile(f('a.png', 'image/png')), null);
  assert.equal(validateLogoFile(f('a.jpg', 'image/jpeg')), null);
  assert.equal(validateLogoFile(f('a.jpeg', 'image/jpg')), null);
  assert.equal(validateLogoFile(f('a.webp', 'image/webp')), null);
  assert.equal(validateLogoFile(f('a.png', '')), null);
  assert.match(String(validateLogoFile(f('a.svg', 'image/svg+xml'))), /PNG, JPG, or WebP/);
  assert.ok(validateLogoFile(f('a.svg', '')));
  assert.ok(validateLogoFile(f('a.png', 'image/svg+xml')), 'svg type with png name');
  assert.ok(validateLogoFile(f('a.svg', 'image/png')), 'png type with svg name');
  assert.ok(validateLogoFile(f('a.gif', 'image/gif')));
  assert.ok(validateLogoFile(f('a.png', 'image/png', 2 * 1024 * 1024 + 1)));
});

test('accept list and helpers never offer SVG', () => {
  assert.ok(!/svg/i.test(LOGO_ACCEPT));
  assert.equal(logoExtension(f('logo', 'image/svg+xml')), 'jpg');
  assert.equal(logoContentType(f('a.jpg', 'image/jpg')), 'image/jpeg');
  assert.equal(logoContentType(f('a.webp', '')), 'image/webp');
  assert.equal(logoContentType(f('a.png', '')), 'image/png');
});

test('000927 restricts logos writes to administered org / own uid prefixes and raster mime types', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261018_000927_security_weekly_1018.sql', import.meta.url), 'utf8');
  for (const name of ['logos_admin_insert', 'logos_admin_update', 'logos_admin_delete']) {
    assert.match(sql, new RegExp(`CREATE POLICY ${name} ON storage\\.objects[\\s\\S]*?public\\.logo_object_writable\\(name\\)`));
  }
  assert.match(sql, /DROP POLICY IF EXISTS "Allow authenticated logo uploads"/);
  assert.match(sql, /DROP POLICY IF EXISTS "Allow authenticated logo updates"/);
  assert.match(sql, /allowed_mime_types = ARRAY\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
  assert.match(sql, /IN \('owner', 'company_admin', 'admin'\)/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.doesNotMatch(sql, /pg_catalog\.(extract|coalesce)\s*\(/i);
  const rb = readFileSync(new URL('../supabase/migrations/20261018_000927_security_weekly_1018_rollback.sql', import.meta.url), 'utf8');
  assert.match(rb, /CREATE POLICY "Allow authenticated logo uploads"/);
  assert.match(rb, /CREATE POLICY organization_memberships_delete_own/);
});

test('QA L-1: a refused logo write shows friendly text in every language, never raw RLS', () => {
  assert.ok(isLogoPermissionError({ message: 'new row violates row-level security policy', statusCode: '400' }));
  assert.ok(isLogoPermissionError({ message: 'x', statusCode: '403' }));
  assert.ok(isLogoPermissionError({ message: 'Unauthorized' }));
  assert.ok(!isLogoPermissionError({ message: 'Payload too large', statusCode: '413' }));
  assert.ok(!isLogoPermissionError(null));
  const row = GAP_STRINGS[LOGO_NO_PERMISSION];
  assert.ok(row, 'translated in GAP_STRINGS');
  for (const loc of ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const) {
    assert.ok(row[loc] && row[loc] !== LOGO_NO_PERMISSION, loc);
  }
  const src = readFileSync(new URL('./customer-logo.ts', import.meta.url), 'utf8');
  assert.match(src, /isLogoPermissionError\(upErr[\s\S]{0,80}throw new Error\(LOGO_NO_PERMISSION\)/);
  const modal = readFileSync(new URL('../components/AddCustomerModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /if \(created\.logoWarning\) toast\.error\(t\(created\.logoWarning\)\)/);
  assert.doesNotMatch(modal, /\$\{created\.logoWarning\}/);
  const page = readFileSync(new URL('../app/customers/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /toast\.error\(t\(LOGO_NO_PERMISSION\)\)/);
});

test('QA M-1 / L-3 / I-2: parts_supplier own storefront, unclaimed CRM customers only, 2 MB bucket cap', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261018_000927_security_weekly_1018.sql', import.meta.url), 'utf8');
  assert.match(sql, /= 'parts_supplier'\s*AND lower\(btrim\(coalesce\(o\.type, ''\)\)\) = 'parts_supplier'/);
  assert.match(sql, /AND NOT EXISTS \(SELECT 1 FROM public\.organization_memberships cm\s*WHERE cm\.organization_id = org_id\)/);
  assert.match(sql, /file_size_limit = 2097152/);
  const rb = readFileSync(new URL('../supabase/migrations/20261018_000927_security_weekly_1018_rollback.sql', import.meta.url), 'utf8');
  assert.match(rb, /file_size_limit = NULL/);
});
