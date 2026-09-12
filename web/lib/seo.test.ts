import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TITLE,
  PUBLIC_PAGE_SEO,
  PUBLIC_SITEMAP_PATHS,
  ROBOTS_ALLOW,
  ROBOTS_DISALLOW,
  SEO_ORIGIN,
  publicPageMetadata,
  robotsTxt,
  siteJsonLd,
  sitemapXml,
} from './seo.ts';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const webDir = join(here, '..');

test('public/robots.txt matches generator and allows marketing paths', () => {
  const body = readFileSync(join(publicDir, 'robots.txt'), 'utf8');
  assert.equal(body, robotsTxt());
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, new RegExp(`^Sitemap: ${SEO_ORIGIN}/sitemap\\.xml$`, 'm'));
  for (const path of ROBOTS_ALLOW) {
    assert.match(body, new RegExp(`^Allow: ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  for (const path of ['/marketplace', '/directory', '/plans', '/signup', '/login', '/parts', '/find-a-rep', '/unsubscribe']) {
    assert.equal(
      ROBOTS_DISALLOW.some((d) => path === d || (d !== '/' && path.startsWith(`${d}/`))),
      false,
      `must not disallow ${path}`,
    );
  }
});

test('public/sitemap.xml lists only public URLs', () => {
  const body = readFileSync(join(publicDir, 'sitemap.xml'), 'utf8');
  assert.equal(body, sitemapXml());
  assert.match(body, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  for (const path of PUBLIC_SITEMAP_PATHS) {
    assert.match(body, new RegExp(`<loc>${SEO_ORIGIN}${path === '/' ? '/' : path}</loc>`));
  }
  for (const banned of ['/admin', '/god', '/hub', '/reports', '/bids', '/service-tickets', '/e/']) {
    assert.doesNotMatch(body, new RegExp(`<loc>${SEO_ORIGIN}${banned}`));
  }
});

test('key public pages have unique titles and descriptions', () => {
  const keys = ['home', 'plans', 'marketplace', 'directory', 'signup', 'findARep'] as const;
  const titles = keys.map((k) => PUBLIC_PAGE_SEO[k].title);
  const descriptions = keys.map((k) => PUBLIC_PAGE_SEO[k].description);
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(new Set(descriptions).size, descriptions.length);
  assert.equal(PUBLIC_PAGE_SEO.home.title, DEFAULT_TITLE);
  assert.match(PUBLIC_PAGE_SEO.home.description, /lithotriptors/);
  assert.match(PUBLIC_PAGE_SEO.marketplace.description, /lithotriptors/);
  const plans = publicPageMetadata('plans');
  assert.equal(plans.alternates?.canonical, '/plans');
  assert.equal(plans.openGraph?.type, 'website');
  assert.equal(plans.twitter?.card, 'summary');
});

test('JSON-LD describes Medical Repair Network / RepairPlanet / Total Service Pro', () => {
  const data = siteJsonLd();
  const json = JSON.stringify(data);
  assert.match(json, /"@type":"Organization"/);
  assert.match(json, /"@type":"WebSite"/);
  assert.match(json, /"@type":"SoftwareApplication"/);
  assert.match(json, /Medical Repair Network/);
  assert.match(json, /RepairPlanet/);
  assert.match(json, /Total Service Pro/);
  assert.doesNotMatch(json, /aggregateRating/);
});

test('root layout ships metadataBase, OG, and JSON-LD', () => {
  const layout = readFileSync(join(webDir, 'app', 'layout.tsx'), 'utf8');
  const seo = readFileSync(join(here, 'seo.ts'), 'utf8');
  assert.match(layout, /rootMetadata/);
  assert.match(layout, /JsonLd/);
  assert.match(seo, /metadataBase/);
  assert.match(seo, /openGraph/);
  assert.match(seo, /canonical/);
});

test('Netlify pins crawler MIME types and middleware skips sitemap.xml', () => {
  const rootToml = readFileSync(join(webDir, '..', 'netlify.toml'), 'utf8');
  const webToml = readFileSync(join(webDir, 'netlify.toml'), 'utf8');
  for (const toml of [rootToml, webToml]) {
    assert.match(toml, /for = "\/robots\.txt"/);
    assert.match(toml, /for = "\/sitemap\.xml"/);
    assert.match(toml, /text\/plain; charset=utf-8/);
    assert.match(toml, /application\/xml; charset=utf-8/);
  }
  const middleware = readFileSync(join(webDir, 'middleware.ts'), 'utf8');
  assert.match(middleware, /robots\\.txt/);
  assert.match(middleware, /sitemap\\.xml/);
});
