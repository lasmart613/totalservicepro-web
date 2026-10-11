import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware.ts';
import { CLINIC_INVITE_POSTAL_ADDRESS } from './clinic-invite-email.ts';
import {
  ACCOUNT_DELETION_DAYS,
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_POSTAL_ADDRESS,
  LEGAL_PUBLIC_PATHS,
  isPublicLegalPath,
  legalRedirectDestination,
} from './legal-routes.ts';
import { signInRedirects } from './no-org-route.ts';
import { PRODUCT_ISSUES_INBOX_DEFAULT } from './product-issues.ts';
import { ROBOTS_DISALLOW } from './seo.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');

function read(rel: string) {
  return readFileSync(join(webDir, rel), 'utf8');
}

function robotsBlocks(disallow: string, path: string): boolean {
  if (disallow.endsWith('/')) return path.startsWith(disallow);
  return path === disallow || path.startsWith(`${disallow}/`);
}

const noOrg = {
  organization_id: null,
  active_organization_id: null,
  role: 'fse',
  onboarding_completed: false,
};
const noInvite = { ok: true, claimed: false, pendingInvite: false, status: 200 };

test('legal contact matches the existing product inbox and email postal address', () => {
  assert.equal(LEGAL_CONTACT_EMAIL, PRODUCT_ISSUES_INBOX_DEFAULT);
  assert.equal(LEGAL_CONTACT_EMAIL, 'contact@medicalrepairnetwork.com');
  assert.equal(LEGAL_POSTAL_ADDRESS, CLINIC_INVITE_POSTAL_ADDRESS);
  assert.equal(LEGAL_EFFECTIVE_DATE, 'October 11, 2026');
  assert.equal(ACCOUNT_DELETION_DAYS, 30);
});

test('privacy, delete-account, and terms are public in middleware and no-org routing', () => {
  const middlewareSource = read('middleware.ts');
  assert.match(middlewareSource, /legalRedirectDestination/);
  assert.doesNotMatch(middlewareSource, /getUser\(|RequireAuth|supabase/);

  for (const path of LEGAL_PUBLIC_PATHS) {
    assert.equal(isPublicLegalPath(path), true, path);
    assert.equal(legalRedirectDestination(path), null, path);
    const res = middleware(new NextRequest(`https://repairplanet.net${path}`));
    assert.equal(res.headers.get('location'), null, path);
    assert.equal(res.status, 200, path);
    assert.equal(
      ROBOTS_DISALLOW.some((rule) => robotsBlocks(rule, path)),
      false,
      `robots blocks ${path}`,
    );
    assert.deepEqual(
      signInRedirects({
        start: path,
        profile: noOrg,
        claim: noInvite,
        next: '/',
        origin: 'https://repairplanet.net',
        isFounder: true,
      }),
      [],
      path,
    );
  }

  const policy = middleware(new NextRequest('https://repairplanet.net/privacy-policy'));
  assert.equal(policy.status, 308);
  assert.equal(policy.headers.get('location'), 'https://repairplanet.net/privacy');

  const legacy = middleware(new NextRequest('https://repairplanet.net/legal/privacy?utm=play'));
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get('location'), 'https://repairplanet.net/privacy?utm=play');

  const config = read('next.config.mjs');
  assert.match(config, /source: '\/privacy-policy', destination: '\/privacy', permanent: true/);
  assert.match(config, /source: '\/legal\/privacy', destination: '\/privacy', permanent: true/);
});

test('legal pages are server-rendered, skip RequireAuth, and name the real deletion path', () => {
  const layout = read('app/(public-legal)/layout.tsx');
  assert.match(layout, /PublicContentShell/);
  assert.doesNotMatch(layout, /import\s*\{[^}]*RequireAuth|<\s*RequireAuth/);

  const privacy = read('app/(public-legal)/privacy/page.tsx');
  const deletion = read('app/(public-legal)/delete-account/page.tsx');
  const terms = read('app/(public-legal)/terms/page.tsx');

  for (const source of [privacy, deletion, terms]) {
    assert.doesNotMatch(source, /['"]use client['"]/);
    assert.match(source, /export const dynamic = 'force-static'/);
    assert.match(source, /LEGAL_CONTACT_EMAIL/);
    assert.match(source, /LEGAL_EFFECTIVE_DATE/);
  }

  assert.match(privacy, /Supabase/);
  assert.match(privacy, /xAI/);
  assert.match(privacy, /Stripe/);
  assert.match(privacy, /Google Play Billing/);
  assert.match(privacy, /Resend/);
  assert.match(privacy, /Netlify/);
  assert.match(privacy, /G-GNBJQ2DMQB/);
  assert.match(privacy, /business cards/i);
  assert.match(privacy, /only when you choose to scan/);
  assert.match(privacy, /recognized on the device/);
  assert.match(privacy, /optical character\s+recognition/);
  assert.match(privacy, /fields you confirm are saved/);
  assert.match(privacy, /card\s+image is not uploaded and is not kept/);
  assert.doesNotMatch(privacy, /does not scan business cards/);
  assert.match(privacy, /image you pick is the image we keep/);
  assert.match(privacy, /do not sell personal information/i);
  assert.match(privacy, /under 13/);
  assert.match(privacy, /href="\/delete-account"/);

  assert.match(deletion, /is_active/);
  assert.match(deletion, /does not delete the account/);
  assert.match(deletion, /Delete my account/);
  assert.match(deletion, /tax and accounting/);
  assert.match(deletion, /href="\/privacy"/);

  assert.match(terms, /href="\/privacy"/);
  assert.match(terms, /href="\/delete-account"/);

  const landing = read('components/landing/LandingShell.tsx');
  const content = read('components/content/PublicContentShell.tsx');
  for (const footer of [landing, content]) {
    assert.match(footer, /href="\/privacy"/);
    assert.match(footer, /href="\/terms"/);
    assert.match(footer, /href="\/delete-account"/);
  }
});
