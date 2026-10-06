import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_SITE_ORIGIN, resolveSiteOrigin } from './site-origin.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PROD = 'https://repairplanet.net';
const PREVIEW = 'https://deploy-preview-215--totalservicepro.netlify.app';

test('production uses NEXT_PUBLIC_SITE_URL, then URL, and ignores the preview URL', () => {
  assert.equal(
    resolveSiteOrigin({
      CONTEXT: 'production',
      NEXT_PUBLIC_SITE_URL: `${PROD}/`,
      URL: 'https://app.example',
      DEPLOY_PRIME_URL: PREVIEW,
    }),
    PROD
  );
  assert.equal(
    resolveSiteOrigin({
      CONTEXT: 'production',
      URL: 'https://app.example/',
      DEPLOY_PRIME_URL: PREVIEW,
    }),
    'https://app.example'
  );
});

test('deploy-preview and branch-deploy use DEPLOY_PRIME_URL', () => {
  const env = {
    NEXT_PUBLIC_SITE_URL: PROD,
    URL: PROD,
    DEPLOY_PRIME_URL: `${PREVIEW}/`,
  };
  assert.equal(resolveSiteOrigin({ ...env, CONTEXT: 'deploy-preview' }), PREVIEW);
  assert.equal(resolveSiteOrigin({ ...env, NETLIFY_CONTEXT: 'branch-deploy' }), PREVIEW);
});

test('a client bundle without CONTEXT uses the origin baked at build time', () => {
  assert.equal(
    resolveSiteOrigin({
      NEXT_PUBLIC_SITE_URL: PROD,
      URL: PROD,
      NEXT_PUBLIC_SITE_ORIGIN: PREVIEW,
    }),
    PREVIEW
  );
});

test('unset env keeps the request host, then the production site', () => {
  const req = {
    headers: {
      get(name: string) {
        if (name === 'x-forwarded-host') return 'localhost:3000';
        if (name === 'x-forwarded-proto') return 'http';
        return null;
      },
    },
  };
  assert.equal(resolveSiteOrigin({}, req), 'http://localhost:3000');
  assert.equal(resolveSiteOrigin({}), PRODUCTION_SITE_ORIGIN);
});

test('invite, claim, signup, reset, and document links use the shared origin', () => {
  const invite = readFileSync(join(here, '../app/api/team/invite/route.ts'), 'utf8');
  const claim = readFileSync(join(here, '../app/api/customers/invite/route.ts'), 'utf8');
  const signup = readFileSync(join(here, '../app/api/auth/signup/route.ts'), 'utf8');
  const forgot = readFileSync(join(here, '../app/forgot-password/page.tsx'), 'utf8');
  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  const estimate = readFileSync(join(here, '../app/api/billing/send-estimate/route.ts'), 'utf8');
  const invoice = readFileSync(join(here, '../app/api/billing/send-invoice/route.ts'), 'utf8');
  const share = readFileSync(join(here, 'share.ts'), 'utf8');
  const config = readFileSync(join(here, '../next.config.mjs'), 'utf8');

  assert.match(invite, /publicSiteOrigin\(req\)/);
  assert.match(claim, /publicSiteOrigin\(req\)/);
  assert.match(signup, /publicSiteOrigin\(req\)/);
  assert.match(forgot, /clientAuthOrigin\(\)/);
  assert.match(login, /clientAuthOrigin\(\)/);
  assert.match(estimate, /publicSiteOrigin\(req\)/);
  assert.match(estimate, /estimateActionUrl\(/);
  assert.match(invoice, /publicSiteOrigin\(req\)/);
  assert.match(share, /publicSiteOrigin\(\)/);
  assert.match(config, /deploy-preview/);
  assert.match(config, /DEPLOY_PRIME_URL/);
  assert.match(config, /NEXT_PUBLIC_SITE_ORIGIN/);
  assert.doesNotMatch(invite, /NEXT_PUBLIC_SITE_URL \|\| process\.env\.URL \|\| process\.env\.DEPLOY_PRIME_URL/);
});
