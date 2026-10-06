import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PART_ARCHIVE_ERROR,
  VENDOR_REMOVE_ERROR,
  canArchiveCatalogPart,
  changedRowCount,
} from './part-catalog-manage.ts';
import { PART_IMAGE_BUCKET, partPhotoContentType, partPhotoPath } from './part-photo-upload.ts';
import { catalogWritePatch, vendorInsertPatch } from './part-catalog-write.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('a delete that changes 0 rows is an error and does not count as removed', () => {
  assert.equal(changedRowCount(null), 0);
  assert.equal(changedRowCount([]), 0);
  assert.equal(changedRowCount([{ id: 4 }]), 1);
  const page = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  assert.match(page, /delete\(\)\.eq\('id', id\)\.select\('id'\)/);
  assert.match(page, /changedRowCount\(data\) === 0/);
  assert.match(page, /VENDOR_REMOVE_ERROR/);
  assert.match(page, /toast\.success\('Vendor removed\.'\)/);
  const removeAt = page.indexOf('async function removeVendor');
  const archiveAt = page.indexOf('async function archivePart');
  const removeFn = page.slice(removeAt, archiveAt);
  assert.match(removeFn, /if \(error \|\| changedRowCount\(data\) === 0\)/);
  const successAt = removeFn.indexOf("toast.success('Vendor removed.')");
  const guardAt = removeFn.indexOf('changedRowCount(data) === 0');
  assert.ok(guardAt >= 0 && successAt > guardAt);
  assert.equal(VENDOR_REMOVE_ERROR, "Couldn't remove this vendor.");
});

test('archived parts are hidden from the catalog list and search load', () => {
  const list = readFileSync(join(here, '../app/parts/page.tsx'), 'utf8');
  assert.match(list, /\.or\('is_active\.eq\.true,is_active\.is\.null'\)/);
  const detail = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  const catalogRoute = readFileSync(join(here, '../app/api/parts/catalog/route.ts'), 'utf8');
  assert.match(detail, /action: 'archive'/);
  assert.match(detail, /PART_ARCHIVE_ERROR/);
  assert.match(detail, /canArchive && part\.is_active !== false/);
  assert.match(catalogRoute, /getSupabaseAdmin\(\)/);
  assert.match(catalogRoute, /catalogManagerStatus/);
  assert.doesNotMatch(detail, /from\('parts_catalog'\)\.update/);
  assert.equal(PART_ARCHIVE_ERROR, "Couldn't archive this part.");
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261006_000700_parts_vendor_delete_archive.sql'),
    'utf8'
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_active boolean/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth\.uid\(\)/);
  assert.match(sql, /DROP POLICY IF EXISTS parts_catalog_update ON public\.parts_catalog/);
  assert.match(sql, /CREATE POLICY parts_catalog_update_owner/);
  assert.match(sql, /CREATE POLICY part_vendors_delete_owner/);
  assert.match(sql, /organization_memberships/);
  assert.match(sql, /company_admin/);
  assert.doesNotMatch(sql, /user_profiles/);
  assert.doesNotMatch(sql, /FOR DELETE[\s\S]*ON public\.parts_catalog/);
  assert.doesNotMatch(sql, /CREATE POLICY part_vendors_insert/);
  assert.doesNotMatch(sql, /CREATE POLICY part_vendors_update/);
  assert.doesNotMatch(sql, /GRANT UPDATE ON TABLE public\.parts_catalog/);
  assert.match(sql, /GRANT UPDATE \(is_active\) ON TABLE public\.parts_catalog TO authenticated/);
  const archive = catalogWritePatch('archive', { created_by: 'attacker', is_active: true });
  assert.equal(archive && archive.is_active, false);
  assert.equal(archive && 'created_by' in archive, false);
  const edit = catalogWritePatch('edit', {
    name: 'Lamp',
    created_by: 'attacker',
    sale_price: 12,
    manufacturer: 'Candela',
    image_urls: ['https://example.test/a.jpg'],
  });
  assert.equal(edit && edit.name, 'Lamp');
  assert.equal(edit && edit.sale_price, 12);
  assert.equal(edit && 'created_by' in edit, false);
  assert.equal(edit && 'manufacturer' in edit, false);
  assert.equal(edit && 'image_urls' in edit, false);
  const stock = catalogWritePatch('stock', { in_stock: false, quantity_on_hand: 3 });
  assert.equal(stock && stock.in_stock, true);
  assert.equal(stock && stock.quantity_on_hand, 3);
  const vendor = vendorInsertPatch({ vendor_name: 'Acme', created_by: 'attacker' }, 'user-1');
  assert.equal(vendor && vendor.created_by, 'user-1');
  assert.equal(vendor && vendor.vendor_name, 'Acme');
});

test('archive follows caller_is_part_creator_admin, including a tech with no home org', () => {
  const fieldTech = [
    { user_id: 'creator', organization_id: 9, role: 'fse', is_home: false },
    { user_id: 'boss', organization_id: 9, role: 'company_admin', is_home: true },
    { user_id: 'stranger', organization_id: 3, role: 'company_admin', is_home: true },
  ];
  assert.equal(canArchiveCatalogPart({ userId: 'creator', createdBy: 'creator', memberships: fieldTech }), true);
  assert.equal(canArchiveCatalogPart({ userId: 'boss', createdBy: 'creator', memberships: fieldTech }), true);
  assert.equal(canArchiveCatalogPart({ userId: 'stranger', createdBy: 'creator', memberships: fieldTech }), false);

  const twoShops = [
    { user_id: 'creator', organization_id: 9, role: 'fse', is_home: false },
    { user_id: 'creator', organization_id: 4, role: 'fse', is_home: false },
    { user_id: 'boss', organization_id: 9, role: 'company_admin', is_home: true },
    { user_id: 'side', organization_id: 4, role: 'admin', is_home: true },
  ];
  assert.equal(canArchiveCatalogPart({ userId: 'boss', createdBy: 'creator', memberships: twoShops }), true);
  assert.equal(canArchiveCatalogPart({ userId: 'side', createdBy: 'creator', memberships: twoShops }), true);

  const homeAndSide = [
    { user_id: 'creator', organization_id: 9, role: 'fse', is_home: true },
    { user_id: 'creator', organization_id: 4, role: 'fse', is_home: false },
    { user_id: 'boss', organization_id: 9, role: 'company_admin', is_home: true },
    { user_id: 'side', organization_id: 4, role: 'admin', is_home: true },
  ];
  assert.equal(canArchiveCatalogPart({ userId: 'boss', createdBy: 'creator', memberships: homeAndSide }), true);
  assert.equal(canArchiveCatalogPart({ userId: 'side', createdBy: 'creator', memberships: homeAndSide }), false);

  const left = [{ user_id: 'boss', organization_id: 9, role: 'company_admin', is_home: true }];
  assert.equal(canArchiveCatalogPart({ userId: 'creator', createdBy: 'creator', memberships: left }), true);
  assert.equal(canArchiveCatalogPart({ userId: 'boss', createdBy: 'creator', memberships: left }), false);
  assert.equal(canArchiveCatalogPart({ userId: 'boss', createdBy: null, memberships: left }), false);

  const detail = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  const catalogRoute = readFileSync(join(here, '../app/api/parts/catalog/route.ts'), 'utf8');
  const vendorsRoute = readFileSync(join(here, '../app/api/parts/vendors/route.ts'), 'utf8');
  const access = readFileSync(join(here, './part-catalog-access.ts'), 'utf8');
  assert.match(detail, /rpc\('caller_is_part_creator_admin'/);
  assert.doesNotMatch(detail, /canArchiveCatalogPart/);
  assert.match(access, /rpc\('caller_is_part_creator_admin'/);
  assert.doesNotMatch(access, /canArchiveCatalogPart/);
  assert.match(catalogRoute, /bearerCaller\(req\)/);
  assert.match(vendorsRoute, /bearerCaller\(req\)/);
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261006_000800_round2_review_nits.sql'),
    'utf8'
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.caller_is_part_creator_admin\(p_creator uuid\)/);
  assert.match(sql, /SET search_path = public, pg_temp SET row_security = off/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.caller_is_part_creator_admin\(uuid\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.caller_is_part_creator_admin\(uuid\) TO authenticated, service_role/);
  assert.match(sql, /REVOKE UPDATE ON TABLE public\.part_vendors FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /^COMMIT\b/m);
  assert.doesNotMatch(sql, /CONCURRENTLY/);
});

test('part photos upload straight to part-images with a content type', () => {
  assert.equal(PART_IMAGE_BUCKET, 'part-images');
  assert.equal(partPhotoContentType('lamp.PNG', ''), 'image/png');
  assert.equal(partPhotoContentType('lamp.jpg', 'image/jpg'), 'image/jpeg');
  assert.equal(partPhotoContentType('notes.pdf', 'application/pdf'), null);
  assert.equal(partPhotoPath('user-1', 0, 'lamp.png', 100), 'parts/user-1/100_0.png');
  const modal = readFileSync(join(here, '../components/AddPartModal.tsx'), 'utf8');
  const detail = readFileSync(join(here, '../app/parts/[id]/page.tsx'), 'utf8');
  const route = readFileSync(join(here, '../app/api/parts/photos/route.ts'), 'utf8');
  for (const src of [modal, detail]) {
    assert.match(src, /\/api\/parts\/photos/);
    assert.doesNotMatch(src, /marketplace-images/);
    assert.doesNotMatch(src, /equipment-photos/);
    assert.doesNotMatch(src, /'logos'/);
    assert.doesNotMatch(src, /'equipment'/);
  }
  assert.match(route, /PART_IMAGE_BUCKET/);
  assert.match(route, /getSupabaseAdmin\(\)/);
  assert.match(route, /contentType/);
  assert.match(route, /partPhotoPath/);
  const vendorsRoute = readFileSync(join(here, '../app/api/parts/vendors/route.ts'), 'utf8');
  assert.match(vendorsRoute, /getSupabaseAdmin\(\)/);
  assert.match(vendorsRoute, /catalogManagerStatus/);
  assert.doesNotMatch(modal, /from\('part_vendors'\)/);
  assert.doesNotMatch(detail, /from\('part_vendors'\)\.update/);
  const android = readFileSync(join(here, '../../app/src/main/assets/parts_catalog.html'), 'utf8');
  assert.match(android, /\/api\/parts\/catalog/);
  assert.match(android, /\/api\/parts\/vendors/);
  assert.doesNotMatch(android, /from\('parts_catalog'\)\.update/);
  assert.doesNotMatch(android, /from\('part_vendors'\)\.insert/);
  assert.match(android, /from\('parts_catalog'\)\.insert/);
});
