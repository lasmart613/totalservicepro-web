import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inferPartKind,
  isConsumableListing,
  isPartListing,
  listingPartCategory,
  type MarketplaceListingLike,
} from './parts.ts';

function row(partial: MarketplaceListingLike): MarketplaceListingLike {
  return {
    listing_type: 'part',
    category: 'parts',
    details: { kind: 'part', part_category: 'Other' },
    ...partial,
    details: { kind: 'part', part_category: 'Other', ...(partial.details || {}) },
  };
}

test('circuit boards, power supplies, and laser heads are parts, not consumables', () => {
  const samples: MarketplaceListingLike[] = [
    row({ title: 'Candela VBeam High Voltage Power Supply 4001-01-0073' }),
    row({ title: '24VDC PowerSupply for Candela VBeam 1 (Classic)' }),
    row({ title: 'Candela Vbeam1 Laser System CPU I/O Green PCB Board 7111-10-2280' }),
    row({ title: 'NEW! CANDELA VBEAM 2 AC DISTRIBUTION BOARD' }),
    row({ title: 'Candela GentleYAG/Mini GentleYAG (VPYAG) Laser Head, 7122-00-3497' }),
    row({ title: 'Refurbished Candela VBeam Handpiece with 3x10mm Slider' }),
  ];
  for (const listing of samples) {
    assert.equal(isPartListing(listing), true, listing.title || '');
    assert.equal(isConsumableListing(listing), false, listing.title || '');
  }
  assert.equal(listingPartCategory(samples[0]), 'Power supply');
  assert.equal(listingPartCategory(samples[2]), 'Control board / PCB');
  assert.equal(listingPartCategory(samples[4]), 'Laser head');
  assert.equal(listingPartCategory(samples[5]), 'Optical / Handpiece');
});

test('filters, cartridges, and o-rings classify as consumables even when stored as parts', () => {
  const samples: MarketplaceListingLike[] = [
    row({ title: 'Grover Technologies 5" QMC Particle Filter 0.2 Micron Pleated' }),
    row({ title: 'Aquamor 2"10" Deionizating Filter Inline 1/4" FPT IN1022' }),
    row({ title: 'Candela Mixed Bed Deionization Cartridge 7122-00-3165' }),
    row({ title: 'O-Ring Kit for Candela GentleLASE / GentleYAG' }),
    row({ title: 'Cryogen canister for DCD', details: { kind: 'part' } }),
    row({ title: 'Disposable tip / spacer pack' }),
  ];
  for (const listing of samples) {
    assert.equal(isConsumableListing(listing), true, listing.title || '');
    assert.equal(isPartListing(listing), false, listing.title || '');
  }
});

test('explicit consumable fields still work, but capital-part keywords win', () => {
  const dye = row({
    title: 'Dye kit for VBeam',
    listing_type: 'consumable',
    category: 'consumables',
    details: { kind: 'consumable', part_category: 'Other consumable' },
  });
  assert.equal(isConsumableListing(dye), true);
  assert.equal(isPartListing(dye), false);

  const mislabeled = row({
    title: 'High Voltage Power Supply',
    listing_type: 'consumable',
    category: 'consumables',
    details: { kind: 'consumable', part_category: 'Consumables' },
  });
  assert.equal(isPartListing(mislabeled), true);
  assert.equal(isConsumableListing(mislabeled), false);
  assert.equal(listingPartCategory(mislabeled), 'Power supply');
});

test('used systems and RFQs stay out of both lanes', () => {
  const used = { title: 'Used GentleMax', listing_type: 'used', category: 'equipment' };
  assert.equal(isPartListing(used), false);
  assert.equal(isConsumableListing(used), false);
});

test('inferPartKind does not treat dye-laser sliders as dye kits', () => {
  const slider = row({ title: 'Candela Vbeam 1 (VBeam Classic) PDL Dye Laser Black Slider, 5mm Spot Size' });
  assert.equal(inferPartKind(slider), null);
  assert.equal(isPartListing(slider), true);
  assert.equal(isConsumableListing(slider), false);
});

test('consumables page filters with isConsumableListing instead of dumping all parts', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../../app/marketplace/consumables/page.tsx'), 'utf8');
  assert.match(source, /isConsumableListing/);
  assert.match(source, /\.filter\(isConsumableListing\)/);
});
