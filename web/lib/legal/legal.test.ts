import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privacyMarkdown } from '../../content/legal/privacy.ts';
import { termsMarkdown } from '../../content/legal/terms.ts';
import { AR_COPY } from '../ar/copy.ts';
import { DE_COPY } from '../de/copy.ts';
import { ES_COPY } from '../es/copy.ts';
import { FA_COPY } from '../fa/copy.ts';
import { FR_COPY } from '../fr/copy.ts';
import { HE_COPY } from '../he/copy.ts';
import { IT_COPY } from '../it/copy.ts';
import { PT_COPY } from '../pt/copy.ts';
import { PUBLIC_PATHS } from '../i18n/locales.ts';
import { PUBLIC_SITEMAP_PATHS, collectSitemapPaths, publicPageMetadata } from '../seo.ts';
import { CONSENT_REQUIRED, CONSENT_TEMPLATE, LEGAL_PLACEHOLDERS, consentPieces } from './consent.ts';
import { parseInline, parseLegalMarkdown, safeLegalHref } from './markdown.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '../..');

function read(rel: string) {
  return readFileSync(join(webDir, rel), 'utf8');
}

const LOCALES = [
  ['fa', FA_COPY],
  ['es', ES_COPY],
  ['fr', FR_COPY],
  ['he', HE_COPY],
  ['it', IT_COPY],
  ['de', DE_COPY],
  ['pt', PT_COPY],
  ['ar', AR_COPY],
] as const;

test('legal pages are public, indexable, and linked from the footer', () => {
  assert.equal(PUBLIC_PATHS.has('/terms'), true);
  assert.equal(PUBLIC_PATHS.has('/privacy'), true);
  assert.equal(PUBLIC_SITEMAP_PATHS.includes('/terms'), true);
  assert.equal(PUBLIC_SITEMAP_PATHS.includes('/privacy'), true);
  assert.equal(collectSitemapPaths().includes('/terms'), true);
  assert.equal(collectSitemapPaths().includes('/privacy'), true);
  assert.equal(publicPageMetadata('terms').alternates?.canonical, '/terms');
  assert.equal(publicPageMetadata('privacy').alternates?.canonical, '/privacy');

  const footer = read('components/landing/LandingShell.tsx');
  assert.match(footer, /href="\/terms"/);
  assert.match(footer, /href="\/privacy"/);
  const contentFooter = read('components/content/PublicContentShell.tsx');
  assert.match(contentFooter, /href="\/terms"/);
  assert.match(contentFooter, /href="\/privacy"/);

  for (const locale of ['de', 'es', 'fr', 'he', 'it', 'pt', 'ar', 'fa']) {
    assert.match(read(`app/${locale}/terms/page.tsx`), /terms\/page/);
    assert.match(read(`app/${locale}/privacy/page.tsx`), /privacy\/page/);
  }
});

test('legal body stays in one file per page and keeps owner placeholders', () => {
  for (const body of [termsMarkdown, privacyMarkdown]) {
    for (const token of LEGAL_PLACEHOLDERS) {
      if (token === '[Governing law state]') continue;
      assert.match(body, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(body, /@/);
    assert.doesNotMatch(body, /\b20\d{2}-\d{2}-\d{2}\b/);
  }
  assert.match(termsMarkdown, /\[Governing law state\]/);
  assert.match(termsMarkdown, /Stripe/);
  assert.match(termsMarkdown, /informational only/);
  assert.match(privacyMarkdown, /Supabase/);
  assert.match(privacyMarkdown, /Netlify/);
  assert.match(privacyMarkdown, /Google Analytics/);
  assert.match(privacyMarkdown, /Resend/);
  assert.match(privacyMarkdown, /does not currently include a button that deletes an account/);

  const termsBlocks = parseLegalMarkdown(termsMarkdown);
  const privacyBlocks = parseLegalMarkdown(privacyMarkdown);
  assert.ok(termsBlocks.some((block) => block.type === 'h2' && block.text === 'The service'));
  assert.ok(privacyBlocks.some((block) => block.type === 'h2' && block.text === 'Who we are'));
  const policyLink = parseInline('See the [Privacy Policy](/privacy).').find((piece) => piece.type === 'link');
  assert.deepEqual(policyLink, { type: 'link', text: 'Privacy Policy', href: '/privacy' });
  assert.equal(safeLegalHref('javascript:alert(1)'), null);
  assert.equal(safeLegalHref('//evil.example'), null);

  const page = read('components/legal/LegalDocument.tsx');
  assert.match(page, /Draft, pending owner review/);
  assert.match(page, /dir="ltr"/);
  assert.match(page, /lang="en"/);
});

test('signup consent is required and translated with both links', () => {
  for (const [label, copy] of LOCALES) {
    const line = copy[CONSENT_TEMPLATE];
    const pieces = consentPieces(line);
    assert.equal(pieces.filter((piece) => piece.kind === 'terms').length, 1, label);
    assert.equal(pieces.filter((piece) => piece.kind === 'privacy').length, 1, label);
    assert.notEqual(copy['Terms of Service'], 'Terms of Service', label);
    assert.notEqual(copy['Privacy Policy'], 'Privacy Policy', label);
    assert.match(copy[CONSENT_REQUIRED], /\S/, label);
  }
  const english = consentPieces(CONSENT_TEMPLATE);
  assert.deepEqual(
    english.map((piece) => piece.kind),
    ['text', 'terms', 'text', 'privacy', 'text'],
  );

  for (const rel of ['app/signup/company/page.tsx', 'app/signup/owner/page.tsx', 'app/signup/supplier/page.tsx']) {
    const source = read(rel);
    assert.match(source, /SignupConsent/);
    assert.match(source, /CONSENT_REQUIRED/);
    assert.match(source, /if \(!agreed\)/);
  }
  const checkbox = read('components/legal/SignupConsent.tsx');
  assert.match(checkbox, /type="checkbox"/);
  assert.match(checkbox, /required/);
  assert.match(checkbox, /href="\/terms"/);
  assert.match(checkbox, /href="\/privacy"/);

  assert.match(read('app/signup/page.tsx'), /LegalLinks/);
  assert.match(read('app/signup/fse/page.tsx'), /LegalLinks/);
  assert.match(read('app/plans/page.tsx'), /LegalLinks/);
  assert.match(read('app/marketplace/parts/[id]/page.tsx'), /LegalLinks/);
});
