import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { organizationInsertFromPending, type PendingSignup } from './pending-signup.ts';
import {
  ORGANIZATION_WEBSITE_ERROR,
  OrganizationWebsiteError,
  normalizeOrganizationWebsite,
} from './organization-website.ts';

const here = dirname(fileURLToPath(import.meta.url));

function supplier(website: string | null): PendingSignup {
  return {
    kind: 'supplier',
    name: 'Parts Co',
    firstName: 'Larry',
    lastName: 'Smart',
    email: 'larry@parts.example',
    role: 'parts_supplier',
    orgType: 'parts_supplier',
    website,
  };
}

test('bare domain and www host are saved as https', () => {
  assert.deepEqual(normalizeOrganizationWebsite('example.com'), {
    ok: true,
    website: 'https://example.com',
  });
  assert.deepEqual(normalizeOrganizationWebsite('www.example.com'), {
    ok: true,
    website: 'https://www.example.com',
  });
  assert.deepEqual(normalizeOrganizationWebsite('WWW.Example.com/parts'), {
    ok: true,
    website: 'https://www.example.com/parts',
  });
});

test('valid http and https URLs are preserved', () => {
  assert.deepEqual(normalizeOrganizationWebsite('https://example.com'), {
    ok: true,
    website: 'https://example.com',
  });
  assert.deepEqual(normalizeOrganizationWebsite('https://example.com/path'), {
    ok: true,
    website: 'https://example.com/path',
  });
  assert.deepEqual(normalizeOrganizationWebsite('http://example.com'), {
    ok: true,
    website: 'http://example.com',
  });
  assert.deepEqual(normalizeOrganizationWebsite('http://www.example.com/a?b=1'), {
    ok: true,
    website: 'http://www.example.com/a?b=1',
  });
  assert.deepEqual(normalizeOrganizationWebsite('HTTPS://Example.com/Path'), {
    ok: true,
    website: 'HTTPS://Example.com/Path',
  });
});

test('empty optional website is blank', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.deepEqual(normalizeOrganizationWebsite(value), { ok: true, website: null });
  }
});

test('surrounding whitespace is trimmed before normalize', () => {
  assert.deepEqual(normalizeOrganizationWebsite('  example.com  '), {
    ok: true,
    website: 'https://example.com',
  });
  assert.deepEqual(normalizeOrganizationWebsite('\twww.example.com\n'), {
    ok: true,
    website: 'https://www.example.com',
  });
  assert.deepEqual(normalizeOrganizationWebsite('  https://example.com/docs  '), {
    ok: true,
    website: 'https://example.com/docs',
  });
  assert.deepEqual(normalizeOrganizationWebsite('  http://example.com  '), {
    ok: true,
    website: 'http://example.com',
  });
});

test('invalid websites are rejected', () => {
  for (const value of ['not a url', 'example', 'http://', 'https://', 'http://localhost', 'http://127.0.0.1', 'example.com.']) {
    const result = normalizeOrganizationWebsite(value);
    assert.equal(result.ok, false, value);
    if (!result.ok) assert.equal(result.error, ORGANIZATION_WEBSITE_ERROR);
  }
});

test('other explicit schemes are rejected and not prefixed with https', () => {
  for (const value of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'ftp://example.com',
    'data:text/html,hi',
    'file:///etc/passwd',
    'mailto:a@b.com',
    'vbscript:msgbox(1)',
    'blob:https://example.com/uuid',
  ]) {
    const result = normalizeOrganizationWebsite(value);
    assert.equal(result.ok, false, value);
    if (!result.ok) assert.equal(result.error, ORGANIZATION_WEBSITE_ERROR);
  }
});

test('org insert stores the normalized website and refuses an unsafe one', () => {
  assert.equal(
    organizationInsertFromPending(supplier('  www.example.com '), 'user-1').website,
    'https://www.example.com'
  );
  assert.equal(
    organizationInsertFromPending(supplier('http://example.com'), 'user-1').website,
    'http://example.com'
  );
  assert.equal(organizationInsertFromPending(supplier('   '), 'user-1').website, null);
  assert.throws(
    () => organizationInsertFromPending(supplier('javascript:alert(1)'), 'user-1'),
    OrganizationWebsiteError
  );
  assert.throws(
    () => organizationInsertFromPending(supplier('ftp://example.com'), 'user-1'),
    OrganizationWebsiteError
  );
});

test('onboarding website inputs do not use native type=url validation', () => {
  const supplierPage = readFileSync(join(here, '../app/signup/supplier/page.tsx'), 'utf8');
  const companyPage = readFileSync(join(here, '../app/signup/company/page.tsx'), 'utf8');
  const onboardingPage = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  const android = readFileSync(join(here, '../../app/src/main/assets/onboarding.html'), 'utf8');
  const profile = readFileSync(join(here, '../app/api/org/profile/route.ts'), 'utf8');
  const founder = readFileSync(join(here, '../app/api/org/founder/route.ts'), 'utf8');

  for (const src of [supplierPage, companyPage, onboardingPage, profile]) {
    assert.match(src, /normalizeOrganizationWebsite/);
    assert.equal(src.includes('type="url"'), false);
  }
  assert.match(founder, /normalizeOrganizationWebsite|OrganizationWebsiteError/);
  const websiteInput = android.split('\n').find((line) => line.includes('id="companyWebsite"'));
  assert.ok(websiteInput);
  assert.match(websiteInput, /type="text"/);
  assert.equal(websiteInput.includes('type="url"'), false);
});
