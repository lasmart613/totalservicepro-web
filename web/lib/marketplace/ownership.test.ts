import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actorBelongsToListingOrg,
  canManageMarketplaceListing,
  canManageOrgListings,
  isListingOwner,
  isPublicListingStatus,
} from './ownership.ts';

const listing = {
  seller_id: 'seller-1',
  created_by: 'creator-1',
  organization_id: 42,
};

test('listing owner is seller_id or created_by', () => {
  assert.equal(isListingOwner(listing, 'seller-1'), true);
  assert.equal(isListingOwner(listing, 'creator-1'), true);
  assert.equal(isListingOwner(listing, 'stranger'), false);
  assert.equal(isListingOwner(listing, null), false);
});

test('removed listings are hidden from the public marketplace; sold can still show', () => {
  assert.equal(isPublicListingStatus('active'), true);
  assert.equal(isPublicListingStatus(null), true);
  assert.equal(isPublicListingStatus('sold'), true);
  assert.equal(isPublicListingStatus('removed'), false);
  assert.equal(isPublicListingStatus('draft'), false);
  assert.equal(isPublicListingStatus('inactive'), false);
});

test('org admins and parts suppliers may manage org listings', () => {
  assert.equal(canManageOrgListings('company_admin', 'parts_supplier'), true);
  assert.equal(canManageOrgListings('admin', 'parts_supplier'), true);
  assert.equal(canManageOrgListings('parts_supplier', 'parts_supplier'), true);
  assert.equal(canManageOrgListings('fse', 'service_company'), false);
  assert.equal(canManageOrgListings('customer', 'laser_clinic'), false);
});

test('strangers cannot manage another seller listing', () => {
  assert.equal(
    canManageMarketplaceListing(listing, {
      userId: 'stranger',
      orgId: 99,
      role: 'parts_supplier',
      orgType: 'parts_supplier',
    }),
    false
  );
});

test('seller can manage even without org admin role', () => {
  assert.equal(
    canManageMarketplaceListing(listing, {
      userId: 'seller-1',
      orgId: 99,
      role: 'fse',
      orgType: 'service_company',
    }),
    true
  );
});

test('supplier org admin can manage a teammate listing for the same org', () => {
  assert.equal(actorBelongsToListingOrg(listing, { orgId: 42 }), true);
  assert.equal(
    canManageMarketplaceListing(listing, {
      userId: 'larry',
      orgId: 42,
      role: 'parts_supplier',
      orgType: 'parts_supplier',
    }),
    true
  );
  assert.equal(
    canManageMarketplaceListing(listing, {
      userId: 'larry',
      orgId: 7,
      role: 'company_admin',
      orgType: 'parts_supplier',
      membershipOrgIds: [42],
    }),
    true
  );
});

test('service-company staff cannot manage a supplier listing even if ids collide', () => {
  assert.equal(
    canManageMarketplaceListing(listing, {
      userId: 'fse-other-shop',
      orgId: 42,
      role: 'fse',
      orgType: 'service_company',
    }),
    false
  );
});

test('any staff at the supplier org can manage that org’s listings', () => {
  assert.equal(
    canManageMarketplaceListing(listing, {
      userId: 'luxor-teammate',
      orgId: 42,
      role: 'crm',
      orgType: 'parts_supplier',
    }),
    true
  );
});
