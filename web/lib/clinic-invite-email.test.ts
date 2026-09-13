import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLINIC_INVITE_CTA_BUTTON,
  CLINIC_INVITE_CTA_PLAIN,
  CLINIC_INVITE_CTA_SUBLINE,
  CLINIC_INVITE_FORBIDDEN_PHRASES,
  CLINIC_INVITE_FROM_DEFAULT,
  CLINIC_INVITE_HERO_URL,
  CLINIC_INVITE_POSTAL_ADDRESS,
  CLINIC_INVITE_REPLY_TO_DEFAULT,
  CLINIC_INVITE_SIGNUP_URL,
  CLINIC_INVITE_SUBJECT,
  CLINIC_INVITE_TEMPLATE_KEY,
  CLINIC_INVITE_UNSUBSCRIBE_URL,
  clinicInviteHtml,
  clinicInviteText,
} from './clinic-invite-email.ts';

const here = dirname(fileURLToPath(import.meta.url));
const heroPath = join(here, '../public/email/laser-clinic-hero-locked.jpg');
const readme = readFileSync(join(here, '../public/email/README.md'), 'utf8');

test('subject, CTA, and signup stay locked', () => {
  assert.equal(CLINIC_INVITE_SUBJECT, 'Wish your laser repair tech was closer?');
  assert.equal(CLINIC_INVITE_SIGNUP_URL, 'https://repairplanet.net/signup');
  assert.equal(CLINIC_INVITE_TEMPLATE_KEY, 'clinic_invite');
  assert.equal(CLINIC_INVITE_CTA_BUTTON, 'Create your clinic account');
  assert.equal(CLINIC_INVITE_CTA_SUBLINE, 'Find a tech near you');
  assert.equal(CLINIC_INVITE_CTA_PLAIN, 'Create your clinic account. Find a tech near you.');
  assert.equal(CLINIC_INVITE_FROM_DEFAULT, 'Total Service Pro <noreply@MedicalRepairNetwork.com>');
  assert.equal(CLINIC_INVITE_REPLY_TO_DEFAULT, 'support@MedicalRepairNetwork.com');
  assert.doesNotMatch(CLINIC_INVITE_SIGNUP_URL, /\/register/);
  assert.ok(CLINIC_INVITE_FORBIDDEN_PHRASES.includes('/register'));
  assert.ok(CLINIC_INVITE_FORBIDDEN_PHRASES.includes('Free to start'));
});

test('HTML is table-based dark gold and hosts the locked hero on repairplanet.net', () => {
  const html = clinicInviteHtml();
  assert.match(html, /<table role="presentation"/);
  assert.match(html, /background:#0b0f14/);
  assert.match(html, /background:#121820/);
  assert.match(html, /#e8c547/);
  assert.match(html, /Wish your laser repair tech was closer\?/);
  assert.match(html, /Post the job\. Nearby shops see it\. Someone takes it\./);
  assert.match(html, /chasing paperwork after the tech leaves/);
  assert.match(html, /Create your clinic account/);
  assert.match(html, /Find a tech near you/);
  assert.match(html, /handful of laser clinics/);
  assert.match(html, /First login is admin/);
  assert.match(html, /stay on the free plan, keep Premium, or walk away/);
  assert.match(html, /Total Service Pro \/ Medical Repair Network/);
  assert.match(html, /href="https:\/\/repairplanet\.net\/signup"/);
  assert.doesNotMatch(html, /repairplanet\.net\/register/);
  assert.equal(CLINIC_INVITE_UNSUBSCRIBE_URL, 'https://repairplanet.net/unsubscribe');
  assert.match(html, /href="https:\/\/repairplanet\.net\/unsubscribe"/);
  assert.match(html, />Unsubscribe</);
  assert.equal(CLINIC_INVITE_POSTAL_ADDRESS, '3349 Somis Rd, Somis, CA 93066-9997');
  assert.match(html, /3349 Somis Rd, Somis, CA 93066-9997/);
  assert.equal(CLINIC_INVITE_HERO_URL, 'https://repairplanet.net/email/laser-clinic-hero-locked.jpg');
  assert.match(html, /https:\/\/repairplanet\.net\/email\/laser-clinic-hero-locked\.jpg/);
  assert.doesNotMatch(html, /invite-assets/);
  assert.doesNotMatch(html, /src="\/email\//);
  for (const phrase of CLINIC_INVITE_FORBIDDEN_PHRASES) {
    assert.doesNotMatch(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('plain text carries the same locked body without image markup', () => {
  const text = clinicInviteText();
  assert.match(text, /Wish your laser repair tech was closer\?/);
  assert.match(text, /https:\/\/repairplanet\.net\/signup/);
  assert.match(
    text,
    /Create your clinic account\. Find a tech near you\.\nhttps:\/\/repairplanet\.net\/signup/
  );
  assert.match(text, /Total Service Pro \/ Medical Repair Network \/ repairplanet\.net/);
  assert.match(text, /https:\/\/repairplanet\.net\/unsubscribe/);
  assert.match(text, /3349 Somis Rd, Somis, CA 93066-9997/);
  assert.doesNotMatch(text, /\/register/);
  assert.doesNotMatch(text, /Free to start|No card to start|This is the juicy part|AdSense|Google Ads/);
});

test('hero public path is the locked clinic-blast JPEG, not a landing still', () => {
  assert.match(readme, /https:\/\/repairplanet\.net\/email\/laser-clinic-hero-locked\.jpg/);
  assert.match(readme, /laser-clinic-hero-locked\.jpg/);
  assert.match(readme, /Locked clinic-blast hero/);
  assert.doesNotMatch(readme, /placeholder|hero-bg-clinic/i);
  assert.equal(existsSync(heroPath), true);
  const bytes = statSync(heroPath).size;
  assert.ok(bytes > 100_000, `locked hero should be the production JPEG (~125101), got ${bytes}`);
});

test('blast send route is god-gated and never auto-selects orgs', () => {
  const route = readFileSync(join(here, '../app/api/god/blast/send/route.ts'), 'utf8');
  const blast = readFileSync(join(here, './god-email-blast.ts'), 'utf8');
  assert.match(route, /requireGodCaller/);
  assert.match(route, /RESEND_API_KEY/);
  assert.match(route, /parseBlastSendBody/);
  assert.match(blast, /confirm !== true/);
  assert.match(blast, /selectedOrgIds/);
  assert.match(blast, /Nothing is auto-selected/);
  assert.match(route, /organization_ids|parseBlastSendBody/);
  assert.match(route, /template_key/);
  assert.match(route, /clinic_invite/);
  assert.match(route, /shop_invite/);
  assert.match(route, /shopInviteResendHeaders/);
  assert.match(route, /List-Unsubscribe|headers: shopInviteResendHeaders/);
  assert.match(route, /maxDuration/);
  assert.match(route, /remaining_organization_ids/);
  assert.doesNotMatch(route, /send to every org|on deploy/i);
});
