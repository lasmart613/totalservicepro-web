import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GA_MEASUREMENT_ID,
  gaAllowedOnHost,
  gaSkipsPath,
  getGaMeasurementId,
  shouldLoadGa,
} from './ga.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');

test('production Measurement ID is RepairPlanet G-GNBJQ2DMQB', () => {
  assert.equal(DEFAULT_GA_MEASUREMENT_ID, 'G-GNBJQ2DMQB');
  assert.equal(getGaMeasurementId({}), 'G-GNBJQ2DMQB');
  assert.equal(getGaMeasurementId({ NEXT_PUBLIC_GA_MEASUREMENT_ID: '' }), 'G-GNBJQ2DMQB');
  assert.equal(
    getGaMeasurementId({ NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-OTHERID99' }),
    'G-OTHERID99',
  );
  assert.equal(
    getGaMeasurementId({ NEXT_PUBLIC_GA_MEASUREMENT_ID: 'not-a-ga-id' }),
    'G-GNBJQ2DMQB',
  );
});

test('GA skips admin/god routes and allows public marketing paths', () => {
  assert.equal(gaSkipsPath('/admin'), true);
  assert.equal(gaSkipsPath('/admin/god'), true);
  assert.equal(gaSkipsPath('/admin/reports'), true);
  assert.equal(gaSkipsPath('/god'), true);
  assert.equal(gaSkipsPath('/god/crm'), true);
  assert.equal(gaSkipsPath('/'), false);
  assert.equal(gaSkipsPath('/plans'), false);
  assert.equal(gaSkipsPath('/marketplace'), false);
  assert.equal(gaSkipsPath('/login'), false);
});

test('GA loads on production hosts and is skipped on Netlify previews and local dev', () => {
  assert.equal(gaAllowedOnHost('repairplanet.net'), true);
  assert.equal(gaAllowedOnHost('www.repairplanet.net'), true);
  assert.equal(gaAllowedOnHost('totalservicepro.netlify.app'), true);
  assert.equal(gaAllowedOnHost('deploy-preview-90--totalservicepro.netlify.app'), false);
  assert.equal(
    shouldLoadGa({ nodeEnv: 'production', pathname: '/', hostname: 'repairplanet.net' }),
    true,
  );
  assert.equal(
    shouldLoadGa({ nodeEnv: 'development', pathname: '/', hostname: 'repairplanet.net' }),
    false,
  );
  assert.equal(
    shouldLoadGa({ nodeEnv: 'production', pathname: '/admin', hostname: 'repairplanet.net' }),
    false,
  );
  assert.equal(
    shouldLoadGa({
      nodeEnv: 'production',
      pathname: '/',
      hostname: 'abc123--totalservicepro.netlify.app',
    }),
    false,
  );
});

test('root layout installs GA4 gtag via next/script after the browser mounts', () => {
  const layout = readFileSync(join(webDir, 'app', 'layout.tsx'), 'utf8');
  const component = readFileSync(join(webDir, 'components', 'GoogleAnalytics.tsx'), 'utf8');
  const ga = readFileSync(join(here, 'ga.ts'), 'utf8');
  assert.match(layout, /GoogleAnalytics/);
  assert.match(layout, /rel="preconnect" href="https:\/\/www\.googletagmanager\.com"/);
  assert.match(component, /next\/script/);
  assert.match(component, /lazyOnload/);
  assert.doesNotMatch(component, /afterInteractive/);
  assert.match(component, /googletagmanager\.com\/gtag\/js/);
  assert.match(component, /gtag\('config'/);
  assert.match(component, /'use client'/);
  assert.match(component, /window\.location\.hostname/);
  assert.doesNotMatch(component, /pagead2\.googlesyndication\.com/);
  assert.doesNotMatch(component, /googleadservices\.com/);
  assert.doesNotMatch(component, /AW-/);
  assert.match(ga, /NEXT_PUBLIC_GA_MEASUREMENT_ID/);
  assert.match(ga, /G-GNBJQ2DMQB/);
});

test('Netlify CSP allows gtag and documents the Measurement ID env var', () => {
  const rootToml = readFileSync(join(webDir, '..', 'netlify.toml'), 'utf8');
  const webToml = readFileSync(join(webDir, 'netlify.toml'), 'utf8');
  for (const toml of [rootToml, webToml]) {
    assert.match(toml, /www\.googletagmanager\.com/);
    assert.match(toml, /google-analytics\.com/);
    assert.doesNotMatch(toml, /googlesyndication\.com\/pagead\/js\/adsbygoogle/);
  }
  const envExample = readFileSync(join(webDir, '..', '.env.example'), 'utf8');
  assert.match(envExample, /NEXT_PUBLIC_GA_MEASUREMENT_ID/);
  assert.match(envExample, /G-GNBJQ2DMQB/);
  const deploy = readFileSync(join(webDir, 'DEPLOY.md'), 'utf8');
  assert.match(deploy, /NEXT_PUBLIC_GA_MEASUREMENT_ID/);
});
