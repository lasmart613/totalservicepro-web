import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LOGO_ACCEPT, logoContentType, logoExtension, validateLogoFile } from './customer-logo.ts';

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
