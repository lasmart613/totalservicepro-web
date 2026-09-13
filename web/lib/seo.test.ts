import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  canonicalUrl,
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
    assert.match(body, new RegExp(`<loc>${canonicalUrl(path)}</loc>`));
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

/** create-next-app / Vercel white-triangle-on-black favicon.ico */
const NEXT_DEFAULT_TRIANGLE_SHA256 =
  '2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932';

function pngSize(buf: Buffer): { width: number; height: number } {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

test('BMET favicon replaces the default Next/Vercel triangle', () => {
  const appIco = readFileSync(join(webDir, 'app', 'favicon.ico'));
  const publicIco = readFileSync(join(webDir, 'public', 'favicon.ico'));
  assert.equal(sha256(appIco), sha256(publicIco));
  assert.notEqual(sha256(appIco), NEXT_DEFAULT_TRIANGLE_SHA256);
  assert.equal(appIco.readUInt16LE(0), 0);
  assert.equal(appIco.readUInt16LE(2), 1);
  assert.ok(appIco.readUInt16LE(4) >= 3, 'ICO should include 16, 32, and 48');

  const icon48 = readFileSync(join(webDir, 'public', 'icon-48.png'));
  assert.deepEqual(pngSize(icon48), { width: 48, height: 48 });

  const iconPng = readFileSync(join(webDir, 'app', 'icon.png'));
  const icon = pngSize(iconPng);
  assert.equal(icon.width, icon.height);
  assert.ok(icon.width >= 48 && icon.width % 48 === 0);

  const apple = pngSize(readFileSync(join(webDir, 'app', 'apple-icon.png')));
  assert.deepEqual(apple, { width: 180, height: 180 });
  assert.deepEqual(pngSize(readFileSync(join(webDir, 'public', 'apple-icon.png'))), apple);

  const svg = readFileSync(join(webDir, 'app', 'icon.svg'), 'utf8');
  assert.match(svg, /#111827/);
  assert.match(svg, /#2DD4BF/);
  assert.match(svg, /#FBBF24/);
  assert.doesNotMatch(svg, /vercel|triangle/i);

  const seo = readFileSync(join(here, 'seo.ts'), 'utf8');
  assert.match(seo, /icon-48\.png/);
  assert.match(seo, /favicon\.ico/);
  assert.match(seo, /apple-icon\.png/);

  const leftoverNames = new Set(['favicon.ico', 'icon.ico', 'icon.png', 'icon.svg', 'apple-icon.png', 'apple-touch-icon.png']);
  for (const dir of [join(webDir, 'app'), join(webDir, 'public')]) {
    for (const name of readdirSync(dir)) {
      if (!leftoverNames.has(name) && !/^(favicon|icon|apple-icon|apple-touch)/i.test(name)) continue;
      if (!existsSync(join(dir, name))) continue;
      if (name.endsWith('.ico') || name.endsWith('.png')) {
        assert.notEqual(sha256(readFileSync(join(dir, name))), NEXT_DEFAULT_TRIANGLE_SHA256, `${dir}/${name}`);
      }
    }
  }
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
  assert.match(middleware, /robots\.txt/);
  assert.match(middleware, /sitemap\.xml/);
});
