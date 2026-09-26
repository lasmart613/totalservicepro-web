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
  SITEMAP_EXCLUDED_PATHS,
  canonicalUrl,
  collectSitemapPaths,
  privateAppMetadata,
  publicPageMetadata,
  robotsTxt,
  siteJsonLd,
  sitemapEntries,
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
  for (const path of ['/marketplace', '/directory', '/plans', '/signup', '/login', '/find-a-rep', '/unsubscribe']) {
    assert.equal(
      ROBOTS_DISALLOW.some((d) => path === d || (d !== '/' && path.startsWith(`${d}/`))),
      false,
      `must not disallow ${path}`,
    );
  }
  assert.doesNotMatch(body, /^Allow: \/parts$/m);
  assert.match(body, /^Disallow: \/manuals$/m);
  assert.match(body, /^Disallow: \/dev$/m);
});

test('generated sitemap lists indexable URLs with lastmod', () => {
  const now = new Date('2026-09-26T12:00:00.000Z');
  const body = sitemapXml(now);
  assert.equal(existsSync(join(publicDir, 'sitemap.xml')), false);
  assert.match(body, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  const paths = collectSitemapPaths();
  assert.deepEqual(paths, [...PUBLIC_SITEMAP_PATHS]);
  for (const path of paths) {
    assert.match(body, new RegExp(`<loc>${canonicalUrl(path)}</loc>\\s*<lastmod>2026-09-26</lastmod>`));
  }
  for (const banned of [
    ...SITEMAP_EXCLUDED_PATHS,
    '/admin',
    '/god',
    '/hub',
    '/reports',
    '/bids',
    '/service-tickets',
    '/e/',
    '/parts',
    '/manuals',
  ]) {
    assert.doesNotMatch(body, new RegExp(`<loc>${SEO_ORIGIN}${banned}</loc>`));
  }
  const entries = sitemapEntries(now);
  assert.equal(entries.length, PUBLIC_SITEMAP_PATHS.length);
  assert.ok(entries.every((entry) => entry.lastmod === '2026-09-26'));
  const route = readFileSync(join(webDir, 'app', 'sitemap.ts'), 'utf8');
  assert.match(route, /sitemapEntries/);
  const seo = readFileSync(join(here, 'seo.ts'), 'utf8');
  assert.match(seo, /serviceManualSitemapPaths/);
  assert.match(seo, /blogSitemapPaths/);
  assert.match(seo, /\/service-manuals\//);
  assert.match(seo, /\/blog\//);
});

test('key public pages have unique titles and descriptions', () => {
  const keys = ['home', 'plans', 'marketplace', 'directory', 'signup', 'findARep'] as const;
  const titles = keys.map((k) => PUBLIC_PAGE_SEO[k].title);
  const descriptions = keys.map((k) => PUBLIC_PAGE_SEO[k].description);
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(new Set(descriptions).size, descriptions.length);
  assert.equal(PUBLIC_PAGE_SEO.home.title, DEFAULT_TITLE);
  assert.ok(DEFAULT_TITLE.length <= 65, DEFAULT_TITLE);
  assert.match(DEFAULT_TITLE, /Total Service Pro/);
  assert.match(DEFAULT_TITLE, /RepairPlanet/);
  assert.match(DEFAULT_TITLE, /Biomed/);
  assert.match(DEFAULT_TITLE, /Laser/);
  assert.match(PUBLIC_PAGE_SEO.home.description, /lithotriptors/);
  assert.match(PUBLIC_PAGE_SEO.marketplace.description, /lithotriptors/);
  const plans = publicPageMetadata('plans');
  assert.equal(plans.alternates?.canonical, '/plans');
  assert.equal(plans.openGraph?.type, 'website');
  assert.equal(plans.twitter?.card, 'summary_large_image');
  const ogImages = plans.openGraph && 'images' in plans.openGraph ? plans.openGraph.images : undefined;
  const firstImage = Array.isArray(ogImages) ? ogImages[0] : undefined;
  assert.equal(typeof firstImage === 'object' && firstImage && 'width' in firstImage ? firstImage.width : 0, 1200);
  assert.equal(typeof firstImage === 'object' && firstImage && 'height' in firstImage ? firstImage.height : 0, 630);
  const parts = publicPageMetadata('marketplaceParts');
  const used = publicPageMetadata('marketplaceUsedSystems');
  const consumables = publicPageMetadata('marketplaceConsumables');
  assert.deepEqual(parts.title, { absolute: 'Parts for sale · RepairPlanet' });
  assert.deepEqual(used.title, { absolute: 'Used systems · RepairPlanet' });
  assert.deepEqual(consumables.title, { absolute: 'Consumables · RepairPlanet' });
  assert.deepEqual(publicPageMetadata('login').robots, { index: false, follow: true });
  assert.deepEqual(publicPageMetadata('forgotPassword').robots, { index: false, follow: true });
  assert.equal(privateAppMetadata.robots?.index, false);
  assert.equal(privateAppMetadata.alternates?.canonical, null);
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
  assert.doesNotMatch(json, /reviewCount|ratingValue/);
  assert.match(json, /"@type":"ImageObject"/);
  assert.match(json, /https:\/\/repairplanet\.net\/apple-icon\.png/);
  assert.match(json, /"url":"https:\/\/repairplanet\.net"/);
  assert.doesNotMatch(json, /"url":"https:\/\/repairplanet\.net\/"/);
});

test('public shells include a static H1 before client data loads', () => {
  const plans = readFileSync(join(webDir, 'app', 'plans', 'page.tsx'), 'utf8');
  const parts = readFileSync(join(webDir, 'app', 'marketplace', 'parts', 'page.tsx'), 'utf8');
  const used = readFileSync(join(webDir, 'app', 'marketplace', 'used-systems', 'page.tsx'), 'utf8');
  const consumables = readFileSync(join(webDir, 'app', 'marketplace', 'consumables', 'page.tsx'), 'utf8');
  const login = readFileSync(join(webDir, 'app', 'login', 'page.tsx'), 'utf8');
  const landing = readFileSync(join(webDir, 'components', 'landing', 'LandingPage.tsx'), 'utf8');
  const marketplace = readFileSync(join(webDir, 'app', 'marketplace', 'page.tsx'), 'utf8');
  const forgot = readFileSync(join(webDir, 'app', 'forgot-password', 'page.tsx'), 'utf8');
  assert.match(plans, /function PublicPlansStatic/);
  assert.match(plans, /<h1 className="lp-h2">Free Plan, Premium, and Team<\/h1>/);
  assert.match(plans, /planTileLines|TileLines/);
  assert.doesNotMatch(plans, /Loading plans…/);
  assert.match(parts, /<h1 className="text-3xl font-extrabold">Parts for sale<\/h1>/);
  assert.match(used, /<h1 className="text-3xl font-extrabold">Used systems<\/h1>/);
  assert.match(consumables, /<h1 className="text-3xl font-extrabold">Consumables<\/h1>/);
  for (const src of [parts, used, consumables]) {
    assert.doesNotMatch(src, /if \(loading\) \{\s*return/);
  }
  assert.match(login, /function LoginStaticIntro/);
  assert.match(login, /<h1[^>]*>Sign in<\/h1>/);
  assert.match(landing, /<h1 className="lp-hero-tagline">/);
  assert.match(landing, /biomedical and aesthetic-laser repair companies/);
  assert.doesNotMatch(landing, /<h1 className="lp-title">/);
  assert.doesNotMatch(marketplace, /laser service ecosystem/);
  assert.doesNotMatch(marketplace, /Used Laser Systems/);
  assert.doesNotMatch(forgot, /Professional Laser Service Tools/);
  assert.doesNotMatch(login, /Professional Laser Service Tools/);
});

test('root layout ships metadataBase, OG, and JSON-LD', () => {
  const layout = readFileSync(join(webDir, 'app', 'layout.tsx'), 'utf8');
  const seo = readFileSync(join(here, 'seo.ts'), 'utf8');
  assert.match(layout, /rootMetadata/);
  assert.match(layout, /JsonLd/);
  assert.match(seo, /metadataBase/);
  assert.match(seo, /openGraph/);
  assert.match(seo, /canonical/);
  assert.match(seo, /summary_large_image/);
  const og = readFileSync(join(webDir, 'components', 'seo', 'OgImage.tsx'), 'utf8');
  assert.match(og, /width: 1200/);
  assert.match(og, /height: 630/);
  assert.ok(existsSync(join(webDir, 'app', 'opengraph-image.tsx')));
  assert.ok(existsSync(join(webDir, 'app', 'twitter-image.tsx')));
  assert.doesNotMatch(og, /aggregateRating/);
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
  assert.match(seo, /icon\.svg/);
  assert.match(seo, /icon-48\.png/);
  assert.match(seo, /favicon\.ico/);
  assert.match(seo, /apple-icon\.png/);
  assert.ok(existsSync(join(webDir, 'public', 'icon.svg')));

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
