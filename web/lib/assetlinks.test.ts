import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { config, middleware } from '../middleware.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');
const repoRoot = join(webDir, '..');
const assetLinksPath = join(webDir, 'public', '.well-known', 'assetlinks.json');

const PACKAGE_NAME = 'com.photometrytools';
// Upload key (sideload / internal builds).
const FINGERPRINT =
  '51:F4:F1:B9:A7:7D:7E:CD:AB:6B:34:B0:4D:1A:06:B2:0B:9F:C6:91:4E:83:51:5F:22:40:AB:51:A2:A3:43:E9';
// Google Play app signing key (#342).
const PLAY_FINGERPRINT =
  'EA:7C:F4:9B:49:89:52:44:33:50:CA:07:5B:18:1C:66:10:AF:B1:D0:A5:F9:12:F2:B5:55:8A:E8:CE:90:08:66';
const FINGERPRINTS = [FINGERPRINT, PLAY_FINGERPRINT];

const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: PACKAGE_NAME,
      sha256_cert_fingerprints: FINGERPRINTS,
    },
  },
];

function matcherMatches(pathname: string): boolean {
  const source = config.matcher[0];
  assert.equal(typeof source, 'string');
  return new RegExp(`^${source}$`).test(pathname);
}

test('assetlinks.json is the photometrytools Digital Asset Links statement', () => {
  const body = readFileSync(assetLinksPath, 'utf8');
  const parsed = JSON.parse(body);
  assert.deepEqual(parsed, ASSET_LINKS);
  assert.equal(parsed[0].target.package_name, PACKAGE_NAME);
  assert.deepEqual(parsed[0].target.sha256_cert_fingerprints, FINGERPRINTS);
  assert.equal(parsed[0].target.sha256_cert_fingerprints.length, 2);
  for (const fp of parsed[0].target.sha256_cert_fingerprints) {
    assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  }
});

test('middleware does not touch /.well-known/assetlinks.json', () => {
  const path = '/.well-known/assetlinks.json';
  assert.equal(matcherMatches(path), false);
  assert.equal(matcherMatches('/.well-known/assetlinks.json/'), false);
  assert.equal(matcherMatches('/.well-known'), false);
  assert.equal(matcherMatches('/hub'), true);
  assert.equal(matcherMatches('/ads.txt'), false);

  for (const url of [
    `https://repairplanet.net${path}`,
    `https://www.repairplanet.net${path}`,
  ]) {
    const res = middleware(new NextRequest(url));
    assert.equal(res.headers.get('location'), null, url);
    assert.equal(res.headers.get('x-middleware-rewrite'), null, url);
    assert.equal([301, 302, 307, 308].includes(res.status), false, url);
    assert.equal(res.headers.get('x-middleware-next'), '1', url);
  }

  const nextConfig = readFileSync(join(webDir, 'next.config.mjs'), 'utf8');
  assert.match(nextConfig, /source: '\/\.well-known\/assetlinks\.json'/);
  assert.match(nextConfig, /Content-Type', value: 'application\/json'/);
  assert.doesNotMatch(nextConfig, /trailingSlash:\s*true/);
  assert.doesNotMatch(nextConfig, /www\.repairplanet\.net/);

  const redirectsBlock = nextConfig.slice(
    nextConfig.indexOf('async redirects'),
    nextConfig.indexOf('async headers')
  );
  assert.doesNotMatch(redirectsBlock, /well-known/);
  assert.doesNotMatch(redirectsBlock, /www\.repairplanet\.net/);

  for (const tomlPath of [join(repoRoot, 'netlify.toml'), join(webDir, 'netlify.toml')]) {
    const toml = readFileSync(tomlPath, 'utf8');
    assert.match(toml, /for = "\/\.well-known\/assetlinks\.json"/);
    assert.match(toml, /Content-Type = "application\/json"/);
    assert.match(toml, /SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES = "[^"]*51:F4:F1:B9:/);
    const rules = toml
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.doesNotMatch(rules, /\[\[redirects\]\]/);
    assert.doesNotMatch(rules, /from\s*=\s*"https?:\/\/www\.repairplanet\.net/);
  }

  for (const missing of [
    join(repoRoot, '_redirects'),
    join(repoRoot, '_headers'),
    join(webDir, '_redirects'),
    join(webDir, '_headers'),
    join(webDir, 'public', '_redirects'),
    join(webDir, 'public', '_headers'),
  ]) {
    assert.equal(existsSync(missing), false, missing);
  }
});
