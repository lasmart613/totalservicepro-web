import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FREE_LISTING_PHOTO_LIMIT,
  PAID_LISTING_PHOTO_LIMIT,
  canBulkUploadSupplierInventory,
  canEnableSupplierStorefront,
  isPublicStorefront,
  isValidStorefrontSlug,
  listingPhotoLimit,
  publicStorefrontContact,
  slugifyStorefront,
  sortFeaturedSellersFirst,
  storefrontHref,
  storefrontPath,
  supplierGetsFeaturedPlacement,
  toPublicSellerCard,
  uniqueStorefrontSlug,
} from './storefront.ts';

test('Premium and Team parts suppliers can enable a storefront; Free cannot', () => {
  assert.equal(canEnableSupplierStorefront('parts_supplier', 'parts_supplier', { is_premium: true }), true);
  assert.equal(
    canEnableSupplierStorefront('parts_supplier', 'parts_supplier', { subscription_tier: 'premium' }),
    true
  );
  assert.equal(canEnableSupplierStorefront('supplier', 'vendor', { plan: 'team' }), true);
  assert.equal(
    canEnableSupplierStorefront('parts_supplier', 'parts_supplier', {
      is_premium: true,
      premium_until: '2099-01-01T00:00:00.000Z',
      premium_grant: 'complimentary_god',
    }),
    true
  );
  assert.equal(canEnableSupplierStorefront('parts_supplier', 'parts_supplier', { is_premium: false }), false);
  assert.equal(canEnableSupplierStorefront('parts_supplier', 'parts_supplier', {}), false);
  assert.equal(canEnableSupplierStorefront('fse', 'service_company', { is_premium: true }), false);
  assert.equal(canEnableSupplierStorefront('owner', 'laser_clinic', { plan: 'team' }), false);
});

test('bulk upload uses the same Premium/Team supplier gate', () => {
  assert.equal(canBulkUploadSupplierInventory('parts_supplier', 'parts_supplier', { plan: 'premium' }), true);
  assert.equal(canBulkUploadSupplierInventory('parts_supplier', 'parts_supplier', { is_premium: false }), false);
  assert.equal(canBulkUploadSupplierInventory('company_admin', 'service_company', { plan: 'team' }), false);
});

test('Team gets featured placement; Premium storefront is not featured', () => {
  assert.equal(supplierGetsFeaturedPlacement('parts_supplier', { plan: 'team' }), true);
  assert.equal(supplierGetsFeaturedPlacement('vendor', { subscription_tier: 'enterprise' }), true);
  assert.equal(supplierGetsFeaturedPlacement('parts_supplier', { is_premium: true }), false);
  assert.equal(supplierGetsFeaturedPlacement('parts_supplier', { plan: 'premium' }), false);
  assert.equal(supplierGetsFeaturedPlacement('service_company', { plan: 'team' }), false);
});

test('photo limits stay Free 1 / paid 8', () => {
  assert.equal(FREE_LISTING_PHOTO_LIMIT, 1);
  assert.equal(PAID_LISTING_PHOTO_LIMIT, 8);
  assert.equal(listingPhotoLimit({ is_premium: false }), 1);
  assert.equal(listingPhotoLimit({ plan: 'premium' }), 8);
  assert.equal(listingPhotoLimit({ plan: 'team' }), 8);
});

test('slugify and reserved slugs', () => {
  assert.equal(slugifyStorefront('Luxor Photonix'), 'luxor-photonix');
  assert.equal(isValidStorefrontSlug('luxor-photonix'), true);
  assert.equal(isValidStorefrontSlug('settings'), false);
  assert.equal(isValidStorefrontSlug('A'), false);
  assert.equal(uniqueStorefrontSlug('Luxor Photonix', 44), 'luxor-photonix');
  assert.equal(storefrontPath('luxor-photonix'), '/marketplace/sellers/luxor-photonix');
  assert.equal(storefrontHref('luxor-photonix'), '/marketplace/sellers/luxor-photonix');
});

test('public storefront requires enabled + paid + valid slug', () => {
  const luxor = {
    name: 'Luxor Photonix',
    type: 'parts_supplier',
    is_premium: true,
    storefront_enabled: true,
    storefront_slug: 'luxor-photonix',
    storefront_bio: 'Laser parts.',
    email: 'sales@luxor.test',
    phone: '555-0100',
  };
  assert.equal(isPublicStorefront(luxor), true);
  assert.equal(isPublicStorefront({ ...luxor, storefront_enabled: false }), false);
  assert.equal(isPublicStorefront({ ...luxor, is_premium: false, plan: null }), false);
  const card = toPublicSellerCard({ ...luxor, plan: 'team' });
  assert.equal(card?.featured, true);
  assert.equal(card?.href, '/marketplace/sellers/luxor-photonix');
  assert.deepEqual(publicStorefrontContact(luxor, false), { website: null, email: null, phone: null });
  assert.equal(publicStorefrontContact(luxor, true).email, 'sales@luxor.test');
});

test('featured sellers sort first', () => {
  const sorted = sortFeaturedSellersFirst([
    { name: 'Beta Parts', featured: false },
    { name: 'Alpha Team', featured: true },
    { name: 'Zulu Team', featured: true },
  ]);
  assert.deepEqual(
    sorted.map((s) => s.name),
    ['Alpha Team', 'Zulu Team', 'Beta Parts']
  );
});

test('storefront settings and public seller pages exist and stay gated', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const settings = readFileSync(join(here, '../../app/marketplace/storefront/page.tsx'), 'utf8');
  const publicPage = readFileSync(join(here, '../../app/marketplace/sellers/[slug]/page.tsx'), 'utf8');
  const upload = readFileSync(join(here, '../../app/api/marketplace/uploads/route.ts'), 'utf8');
  assert.match(settings, /Enable my public storefront/);
  assert.match(settings, /accept="\.csv,\.xlsx/);
  assert.match(settings, /Download template/);
  assert.match(publicPage, /GuestAwarePrice/);
  assert.match(publicPage, /listingHref/);
  assert.match(upload, /canBulkUploadSupplierInventory/);
  assert.match(upload, /dryRun|preview/);
});
