import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOCIAL_COLUMNS,
  SOCIAL_NETWORKS,
  filledSocialLinks,
  normalizeSocialUrl,
  socialFieldsFromOrg,
  socialPayloadFromForm,
  visibleSocialNetworks,
} from './social-links.ts';

test('blank input normalizes to null', () => {
  assert.equal(normalizeSocialUrl('x', ''), null);
  assert.equal(normalizeSocialUrl('instagram', '   '), null);
  assert.equal(normalizeSocialUrl('facebook', null), null);
});

test('@handles become the canonical URL for each network', () => {
  assert.equal(normalizeSocialUrl('x', '@northshore'), 'https://x.com/northshore');
  assert.equal(normalizeSocialUrl('x', 'northshore'), 'https://x.com/northshore');
  assert.equal(normalizeSocialUrl('instagram', '@galactic.spa'), 'https://www.instagram.com/galactic.spa');
  assert.equal(normalizeSocialUrl('facebook', 'NorthshoreClinic'), 'https://www.facebook.com/NorthshoreClinic');
  assert.equal(normalizeSocialUrl('tiktok', '@laserclinic'), 'https://www.tiktok.com/@laserclinic');
  assert.equal(normalizeSocialUrl('youtube', '@NorthshoreLasers'), 'https://www.youtube.com/@NorthshoreLasers');
  assert.equal(normalizeSocialUrl('linkedin', 'northshore-clinic'), 'https://www.linkedin.com/company/northshore-clinic');
  assert.equal(normalizeSocialUrl('linkedin', 'in/jane-doe'), 'https://www.linkedin.com/in/jane-doe');
  assert.equal(normalizeSocialUrl('yelp', 'northshore-laser-clinic-evanston'), 'https://www.yelp.com/biz/northshore-laser-clinic-evanston');
  assert.equal(normalizeSocialUrl('threads', '@northshore'), 'https://www.threads.net/@northshore');
});

test('full URLs are kept and twitter.com is rewritten to x.com', () => {
  assert.equal(
    normalizeSocialUrl('x', 'https://x.com/northshore'),
    'https://x.com/northshore'
  );
  assert.equal(
    normalizeSocialUrl('x', 'https://twitter.com/northshore'),
    'https://x.com/northshore'
  );
  assert.equal(
    normalizeSocialUrl('instagram', 'instagram.com/galactic.spa'),
    'https://instagram.com/galactic.spa'
  );
  assert.equal(
    normalizeSocialUrl('youtube', 'https://www.youtube.com/channel/UC123'),
    'https://www.youtube.com/channel/UC123'
  );
  assert.equal(
    normalizeSocialUrl('yelp', 'https://www.yelp.com/biz/northshore-laser-clinic-evanston'),
    'https://www.yelp.com/biz/northshore-laser-clinic-evanston'
  );
});

test('dangerous schemes and junk handles are rejected', () => {
  assert.equal(normalizeSocialUrl('x', 'javascript:alert(1)'), null);
  assert.equal(normalizeSocialUrl('instagram', 'data:text/html,hi'), null);
  assert.equal(normalizeSocialUrl('facebook', 'not a handle!!'), null);
  assert.equal(normalizeSocialUrl('tiktok', '<script>'), null);
});

test('payload maps every social column and leaves blanks as null', () => {
  const payload = socialPayloadFromForm({
    x_url: '@clinic',
    instagram_url: '',
    facebook_url: '  ',
    tiktok_url: '@clinic',
    youtube_url: '',
    linkedin_url: '',
    yelp_url: '',
    threads_url: '',
  });
  assert.equal(payload.x_url, 'https://x.com/clinic');
  assert.equal(payload.tiktok_url, 'https://www.tiktok.com/@clinic');
  assert.equal(payload.instagram_url, null);
  assert.deepEqual(
    SOCIAL_COLUMNS.slice().sort(),
    Object.keys(payload).sort()
  );
});

test('org hydration only copies known social columns', () => {
  const fields = socialFieldsFromOrg({
    x_url: 'https://x.com/clinic',
    website: 'https://clinic.example',
    name: 'Clinic',
  });
  assert.equal(fields.x_url, 'https://x.com/clinic');
  assert.equal(fields.instagram_url, '');
  assert.equal('website' in fields, false);
});

test('LinkedIn and Yelp show for clinic types and stay hidden for rental unless filled', () => {
  const clinic = visibleSocialNetworks('customer').map((n) => n.key);
  assert.ok(clinic.includes('linkedin'));
  assert.ok(clinic.includes('yelp'));
  assert.ok(clinic.includes('threads'));

  const rental = visibleSocialNetworks('laser_rental').map((n) => n.key);
  assert.equal(rental.includes('linkedin'), false);
  assert.equal(rental.includes('yelp'), false);
  assert.ok(rental.includes('x'));

  const rentalFilled = visibleSocialNetworks('laser_rental', {
    ...socialFieldsFromOrg(null),
    linkedin_url: 'https://www.linkedin.com/company/fleet',
  }).map((n) => n.key);
  assert.ok(rentalFilled.includes('linkedin'));
});

test('filledSocialLinks skips blanks and normalizes leftover handles', () => {
  const links = filledSocialLinks({
    x_url: '@clinic',
    instagram_url: '',
    website: 'https://example.com',
  } as Record<string, string>);
  assert.equal(links.length, 1);
  assert.equal(links[0].label, 'X');
  assert.equal(links[0].href, 'https://x.com/clinic');
});

test('customer form and profile render social fields without a second website row', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const form = readFileSync(join(here, '../components/CustomerInfoForm.tsx'), 'utf8');
  const profile = readFileSync(join(here, '../app/customers/[id]/page.tsx'), 'utf8');
  assert.match(form, /Social Media/);
  assert.match(form, /visibleSocialNetworks/);
  assert.match(form, /network\.label/);
  assert.match(form, /normalizeSocialUrl/);
  assert.equal((form.match(/Website/g) || []).length, 1);
  assert.deepEqual(
    SOCIAL_NETWORKS.map((n) => n.label),
    ['X', 'Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn', 'Yelp', 'Threads']
  );
  assert.match(profile, /filledSocialLinks/);
  assert.match(profile, /socialFieldsFromOrg/);
  assert.ok(SOCIAL_NETWORKS.some((n) => n.column === 'x_url'));
});
