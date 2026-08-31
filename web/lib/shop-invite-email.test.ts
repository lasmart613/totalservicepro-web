import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHOP_INVITE_FORBIDDEN_PHRASES,
  SHOP_INVITE_IMAGE_FILES,
  SHOP_INVITE_SIGNUP_URL,
  SHOP_INVITE_SUBJECT,
  shopInviteHtml,
  shopInviteImageUrl,
  shopInviteText,
} from './shop-invite-email.ts';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '../public/email/shop-invite');

test('subject and CTA stay locked', () => {
  assert.equal(SHOP_INVITE_SUBJECT, 'Find Laser Repair Jobs in Your Area');
  assert.equal(SHOP_INVITE_SIGNUP_URL, 'https://repairplanet.net/signup');
});

test('HTML is table-based dark gold and hosts images on repairplanet.net', () => {
  const html = shopInviteHtml();
  assert.match(html, /<table role="presentation"/);
  assert.match(html, /background:#0b0f14/);
  assert.match(html, /background:#121820/);
  assert.match(html, /#e8c547/);
  assert.match(html, /Find Laser Repair Jobs in Your Area/);
  assert.match(html, /They post the job\. You see it\. You take it\./);
  assert.match(html, /rebuilding the paperwork in the truck/);
  assert.match(html, /Claim your shop\. Take the work\./);
  assert.match(html, /Two months of Premium on us\./);
  assert.match(html, /machine and the symptom already on the ticket/);
  assert.match(html, /No more guessing from photos in a group chat!/);
  assert.match(html, /invoice draft with one click/);
  assert.match(html, /shelves by brand/);
  assert.match(html, /handful of laser shops/);
  assert.match(html, /First login is admin/);
  assert.match(html, /stay on the free plan, keep Premium, or walk away/);
  assert.match(html, /Total Service Pro \/ Medical Repair Network/);
  assert.match(html, /href="https:\/\/repairplanet\.net\/signup"/);
  for (const file of SHOP_INVITE_IMAGE_FILES) {
    const url = shopInviteImageUrl(file);
    assert.equal(url, `https://repairplanet.net/email/shop-invite/${file}`);
    assert.match(html, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(existsSync(join(publicDir, file)), true);
  }
  assert.doesNotMatch(html, /invite-assets/);
  assert.doesNotMatch(html, /src="\/email\//);
  for (const phrase of SHOP_INVITE_FORBIDDEN_PHRASES) {
    assert.doesNotMatch(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(html, />01<|>02<|>03</);
});

test('plain text carries the same locked body without image markup', () => {
  const text = shopInviteText();
  assert.match(text, /Find Laser Repair Jobs in Your Area/);
  assert.match(text, /https:\/\/repairplanet\.net\/signup/);
  assert.match(text, /Total Service Pro \/ Medical Repair Network \/ repairplanet\.net/);
  assert.doesNotMatch(text, /Free to start|No card to start|This is the juicy part/);
});

test('send route never blasts and uses Resend', () => {
  const route = readFileSync(join(here, '../app/api/god/invite/send/route.ts'), 'utf8');
  assert.match(route, /RESEND_API_KEY/);
  assert.match(route, /confirm/);
  assert.match(route, /selectedOrgIds/);
  assert.doesNotMatch(route, /send to every org|blast|on deploy/i);
  assert.match(route, /organization_ids/);
});
