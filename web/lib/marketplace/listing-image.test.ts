import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  AVATAR_IMAGE_MAX_BYTES,
  COMPANY_ASSET_MAX_BYTES,
  COMPANY_PROFILE_LOGO_MAX_BYTES,
  EQUIPMENT_PHOTO_MAX_BYTES,
  LISTING_IMAGE_MAX_BYTES,
  LISTING_IMAGE_REJECTED,
  LISTING_IMAGE_TOO_LARGE,
  detectListingImage,
  imageTooLargeMessage,
  inspectListingImage,
  isStorageImageError,
} from './listing-image.ts';

const here = dirname(fileURLToPath(import.meta.url));

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const SVG = Uint8Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
const HTML = Uint8Array.from(new TextEncoder().encode('<!DOCTYPE html><svg></svg>'));
const PDF = Uint8Array.from(new TextEncoder().encode('%PDF-1.7'));

test('detectListingImage accepts PNG, JPEG, and WebP headers only', () => {
  assert.deepEqual(detectListingImage(PNG), { contentType: 'image/png', extension: 'png' });
  assert.deepEqual(detectListingImage(JPEG), { contentType: 'image/jpeg', extension: 'jpg' });
  assert.deepEqual(detectListingImage(WEBP), { contentType: 'image/webp', extension: 'webp' });
  assert.equal(detectListingImage(GIF), null);
  assert.equal(detectListingImage(SVG), null);
  assert.equal(detectListingImage(HTML), null);
  assert.equal(detectListingImage(PDF), null);
  assert.equal(detectListingImage(Uint8Array.from([0xff, 0xd8])), null);
});

test('inspectListingImage ignores a spoofed name and type', async () => {
  const svgNamedPng = new File([SVG], 'logo.png', { type: 'image/png' });
  const rejected = await inspectListingImage(svgNamedPng);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error, LISTING_IMAGE_REJECTED);

  const jpegNamedSvg = new File([JPEG], 'photo.svg', { type: 'image/svg+xml' });
  const accepted = await inspectListingImage(jpegNamedSvg);
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.contentType, 'image/jpeg');
    assert.equal(accepted.extension, 'jpg');
  }
});

test('size caps match the bucket limits', async () => {
  assert.equal(LISTING_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(AVATAR_IMAGE_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(COMPANY_ASSET_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(COMPANY_PROFILE_LOGO_MAX_BYTES, 3 * 1024 * 1024);
  assert.equal(EQUIPMENT_PHOTO_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(LISTING_IMAGE_TOO_LARGE, 'Photo must be 5 MB or smaller.');
  assert.equal(imageTooLargeMessage(EQUIPMENT_PHOTO_MAX_BYTES), 'Photo must be 8 MB or smaller.');
  assert.equal(imageTooLargeMessage(AVATAR_IMAGE_MAX_BYTES), 'Photo must be 2 MB or smaller.');
  assert.equal(isStorageImageError(LISTING_IMAGE_REJECTED), true);
  assert.equal(isStorageImageError(imageTooLargeMessage(COMPANY_PROFILE_LOGO_MAX_BYTES)), true);
  assert.equal(isStorageImageError('Save failed'), false);

  const tooBig = new File([PNG, new Uint8Array(LISTING_IMAGE_MAX_BYTES)], 'big.png', { type: 'image/png' });
  const over = await inspectListingImage(tooBig);
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.error, LISTING_IMAGE_TOO_LARGE);

  const avatarOk = await inspectListingImage(new File([PNG], 'a.png'), AVATAR_IMAGE_MAX_BYTES);
  assert.equal(avatarOk.ok, true);
});

test('upload pages use the shared byte check and the owner folder', () => {
  const list = readFileSync(join(here, '../../app/marketplace/list/page.tsx'), 'utf8');
  const edit = readFileSync(join(here, '../../app/marketplace/parts/[id]/edit/page.tsx'), 'utf8');
  const laser = readFileSync(join(here, '../../app/my-lasers/[id]/page.tsx'), 'utf8');
  const route = readFileSync(join(here, '../../app/api/parts/photos/route.ts'), 'utf8');
  const modal = readFileSync(join(here, '../../components/AddPartModal.tsx'), 'utf8');
  const detail = readFileSync(join(here, '../../app/parts/[id]/page.tsx'), 'utf8');
  for (const src of [list, edit, laser, modal, detail]) {
    assert.match(src, /inspectListingImage/);
    assert.match(src, /toast\.error/);
  }
  assert.match(list, /from\('marketplace-images'\)/);
  assert.doesNotMatch(list, /equipment-photos/);
  assert.match(list, /\$\{userId\}\/listings\//);
  assert.match(edit, /from\('marketplace-images'\)/);
  assert.doesNotMatch(edit, /equipment-photos/);
  assert.match(laser, /from\('equipment-photos'\)/);
  assert.match(laser, /\$\{orgId\}\/\$\{laser\.id\}_/);
  assert.doesNotMatch(laser, /equipment\/\$\{/);
  assert.doesNotMatch(laser, /part-images/);
  assert.doesNotMatch(laser, /company-assets/);
  assert.match(route, /detectListingImage/);
  assert.match(route, /LISTING_IMAGE_REJECTED/);
  assert.doesNotMatch(route, /partPhotoContentType/);
  assert.doesNotMatch(modal, /image\/gif/);
  assert.doesNotMatch(detail, /image\/gif/);

  const root = join(here, '../../../app/src/main/assets');
  const bytes = readFileSync(join(root, 'image-bytes.js'), 'utf8');
  assert.match(bytes, /0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a/);
  assert.match(bytes, /bytes\[8\] === 0x57/);
  assert.match(bytes, /bytes\[11\] === 0x50/);
  assert.match(bytes, /Other file types, including SVG/);
  const avatar = readFileSync(join(root, 'user_profile.html'), 'utf8');
  const company = readFileSync(join(root, 'company_profile.html'), 'utf8');
  const onboard = readFileSync(join(root, 'onboarding.html'), 'utf8');
  const market = readFileSync(join(root, 'marketplace.html'), 'utf8');
  const catalog = readFileSync(join(root, 'parts_catalog.html'), 'utf8');
  for (const src of [avatar, company, onboard, market, catalog]) {
    assert.match(src, /image-bytes\.js/);
    assert.match(src, /tspInspectImage/);
  }
  assert.match(avatar, /currentUser\.id \+ '\/avatar\.'/);
  assert.doesNotMatch(avatar, /avatars\/\$\{currentUser\.id\}/);
  assert.match(company, /organization_id \+ '\/logo\.'/);
  assert.doesNotMatch(company, /logos\/\$\{currentProfile\.organization_id\}/);
  assert.match(onboard, /currentUser\.id \+ '\/logo\.'/);
  assert.doesNotMatch(onboard, /'logos\/' \+ currentUser\.id/);
  assert.match(market, /currentUser\.id \+ '\/'/);
  assert.match(market, /showToast\(inspected\.error, 'error'\)/);
  assert.match(catalog, /\/api\/parts\/photos/);
  assert.doesNotMatch(catalog, /from\('marketplace-images'\)/);
  assert.doesNotMatch(catalog, /from\('equipment-photos'\)/);
});
