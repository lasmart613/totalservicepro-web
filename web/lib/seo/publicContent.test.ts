import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentJsonLd } from './contentJsonLd.ts';
import { canonicalUrl, collectSitemapPaths, ROBOTS_DISALLOW, sitemapXml } from '../seo.ts';
import {
  BLOG_POSTS,
  MANUAL_LOGIN_HREF,
  MANUAL_LOGIN_LABEL,
  MANUAL_LOGIN_LEAD,
  MANUAL_SIGNUP_HREF,
  MANUAL_SIGNUP_LABEL,
  PUBLIC_CONTENT_AUTHOR,
  SERVICE_MANUALS,
  TROUBLESHOOTING_GUIDES,
  allIndexableContent,
  blockPlainText,
  blogPath,
  collectContentStrings,
  getManual,
  manualPath,
  publicContentSitemapEntries,
  troubleshootingPath,
  wordCount,
} from './publicContent.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', '..');

const EXACT_TITLES: { make: string; model: string; title: string }[] = [
  { make: 'draeger', model: 'fabius-gs', title: 'Draeger Fabius GS Anesthesia Service Manual' },
  { make: 'draeger', model: 'narkomed-6000', title: 'Draeger Narkomed 6000 Anesthesia Service Manual' },
  { make: 'ge', model: 'dash-3000-4000', title: 'GE Dash 3000/4000 Patient Monitor Service Manual' },
  { make: 'coherent', model: 'versapulse-powersuite', title: 'VersaPulse PowerSuite Rev. C' },
  { make: 'samsung', model: 'rs80a', title: 'Samsung RS80A Ultrasound Service Manual' },
  { make: 'uroview', model: '2800', title: 'UroView 2800 Service Manual' },
];

const FORBIDDEN = [
  /storage_path/i,
  /\.pdf\b/i,
  /supabase\.co/i,
  /\/object\/sign/i,
  /x-amz-/i,
  /signedurl/i,
  /token=/i,
];

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkFiles(path, out);
    else if (/\.(ts|tsx|css|md)$/.test(name)) out.push(path);
  }
  return out;
}

function robotsBlocks(disallow: string, path: string): boolean {
  if (disallow.endsWith('/')) return path.startsWith(disallow);
  return path === disallow || path.startsWith(`${disallow}/`);
}

test('every public content entry has title, description, and slug', () => {
  assert.ok(SERVICE_MANUALS.length >= 6);
  assert.ok(BLOG_POSTS.length >= 3);
  assert.ok(TROUBLESHOOTING_GUIDES.length >= 1);
  for (const manual of SERVICE_MANUALS) {
    assert.ok(manual.title.trim());
    assert.ok(manual.description.trim());
    assert.ok(manual.modelSlug.trim());
    assert.ok(manual.makeSlug.trim());
    assert.equal(manualPath(manual).includes(' '), false);
  }
  for (const post of BLOG_POSTS) {
    assert.ok(post.title.trim());
    assert.ok(post.description.trim());
    assert.ok(post.slug.trim());
    assert.equal(blogPath(post.slug).startsWith('/blog/'), true);
  }
  for (const guide of TROUBLESHOOTING_GUIDES) {
    assert.ok(guide.title.trim());
    assert.ok(guide.description.trim());
    assert.ok(guide.slug.trim());
    assert.equal(troubleshootingPath(guide.slug).startsWith('/troubleshooting/'), true);
  }
  const pages = allIndexableContent();
  const titles = pages.map((page) => page.title);
  const descriptions = pages.map((page) => page.description);
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(new Set(descriptions).size, descriptions.length);
  assert.equal(new Set(pages.map((page) => page.path)).size, pages.length);
});

test('catalog titles match the live library wording', () => {
  for (const expected of EXACT_TITLES) {
    const manual = getManual(expected.make, expected.model);
    assert.ok(manual, expected.title);
    assert.equal(manual?.title, expected.title);
    assert.equal(manual?.documentType === 'Service' || manual?.documentType === 'Operator', true);
    assert.ok(manual?.equipmentType.trim());
  }
});

test('public content does not carry storage paths or PDF URLs', () => {
  const blobs = [
    ...collectContentStrings(SERVICE_MANUALS),
    ...collectContentStrings(BLOG_POSTS),
    ...collectContentStrings(TROUBLESHOOTING_GUIDES),
    ...collectContentStrings(allIndexableContent()),
  ];
  for (const value of blobs) {
    for (const pattern of FORBIDDEN) {
      assert.equal(pattern.test(value), false, `${pattern} matched: ${value.slice(0, 180)}`);
    }
  }
  const sourceDirs = [
    join(webDir, 'app', 'service-manuals'),
    join(webDir, 'app', 'blog'),
    join(webDir, 'app', 'troubleshooting'),
    join(webDir, 'components', 'content'),
  ];
  for (const file of sourceDirs.flatMap((dir) => walkFiles(dir))) {
    if (file.endsWith('publicContent.test.ts')) continue;
    const body = readFileSync(file, 'utf8');
    assert.equal(/storage_path/i.test(body), false, file);
    assert.equal(/\.pdf\b/i.test(body), false, file);
    assert.equal(/supabase\.co/i.test(body), false, file);
  }
});

test('public pages are not under /manuals, which robots prefix-blocks', () => {
  for (const entry of publicContentSitemapEntries()) {
    assert.equal(entry.path === '/manuals' || entry.path.startsWith('/manuals/'), false, entry.path);
    assert.equal(
      ROBOTS_DISALLOW.some((rule) => robotsBlocks(rule, entry.path)),
      false,
      `robots blocks ${entry.path}`,
    );
    assert.match(entry.lastmod, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(MANUAL_SIGNUP_HREF, '/signup');
  assert.equal(MANUAL_SIGNUP_LABEL, 'Sign up free to view this manual');
  assert.equal(MANUAL_LOGIN_HREF, '/manuals');
  assert.equal(MANUAL_LOGIN_LEAD, 'Already have an account?');
  assert.equal(MANUAL_LOGIN_LABEL, 'Log in');
});

test('generated sitemap lists public content URLs with lastmod', () => {
  const now = new Date('2026-09-26T12:00:00.000Z');
  const xml = sitemapXml(now);
  assert.equal(existsSync(join(webDir, 'public', 'sitemap.xml')), false);
  const paths = collectSitemapPaths();
  for (const entry of publicContentSitemapEntries()) {
    assert.equal(paths.includes(entry.path), true, entry.path);
    assert.match(xml, new RegExp(`<loc>${canonicalUrl(entry.path)}</loc>\\s*<lastmod>2026-09-26</lastmod>`));
  }
  assert.doesNotMatch(xml, /aggregateRating/);
  assert.doesNotMatch(xml, /<loc>https:\/\/repairplanet\.net\/manuals</);
  assert.match(readFileSync(join(webDir, 'app', 'sitemap.ts'), 'utf8'), /sitemapEntries/);
});

test('JSON-LD is Article or TechArticle plus breadcrumbs, with no ratings', () => {
  for (const page of allIndexableContent()) {
    const data = contentJsonLd(page);
    const json = JSON.stringify(data);
    assert.match(json, new RegExp(`"@type":"${page.kind}"`));
    assert.match(json, /"@type":"BreadcrumbList"/);
    assert.match(json, new RegExp(PUBLIC_CONTENT_AUTHOR));
    assert.doesNotMatch(json, /aggregateRating|reviewCount|ratingValue/i);
    assert.equal(json.includes('storage_path'), false);
  }
});

test('manual notes and articles are in the requested length', () => {
  for (const manual of SERVICE_MANUALS) {
    const words = wordCount(blockPlainText(manual.notes));
    assert.ok(words >= 250 && words <= 400, `${manual.modelSlug} notes are ${words} words`);
  }
  for (const post of BLOG_POSTS) {
    const words = wordCount(blockPlainText(post.blocks));
    assert.ok(words >= 700 && words <= 1000, `${post.slug} is ${words} words`);
  }
  for (const guide of TROUBLESHOOTING_GUIDES) {
    const words = wordCount(blockPlainText(guide.blocks));
    assert.ok(words >= 500 && words <= 1000, `${guide.slug} is ${words} words`);
  }
});

test('adding a manual is one array entry and the route is derived', () => {
  const source = readFileSync(join(here, 'publicContent.ts'), 'utf8');
  assert.match(source, /export const SERVICE_MANUALS/);
  assert.match(source, /TODO: Add a verified VersaPulse error-code table/);
  assert.equal(publicContentSitemapEntries().some((entry) => entry.path === manualPath(SERVICE_MANUALS[0])), true);
  const readme = readFileSync(join(here, 'README.md'), 'utf8');
  assert.match(readme, /SERVICE_MANUALS/);
  assert.match(readme, /\/manuals/);
});
