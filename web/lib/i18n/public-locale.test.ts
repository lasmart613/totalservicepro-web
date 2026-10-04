import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FA_COPY } from '../fa/copy.ts';
import { ES_COPY } from '../es/copy.ts';
import { FR_COPY } from '../fr/copy.ts';
import {
  hrefForLocale,
  prefixLocaleHref,
  PUBLIC_LOCALES,
  PUBLIC_PATHS,
} from './locales.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '../..');

function read(rel: string) {
  return readFileSync(join(webDir, rel), 'utf8');
}

const ALLOW_SAME = new Set([
  'Total Service Pro',
  'Premium',
  'Team',
  '$0',
  'you@clinic.com',
  '(555) 555-0100',
  'https://...',
  '$250 – $1,000',
  '$1,000 – $5,000',
  '$5,000+',
  'Hospital',
  'Public',
  'Pause',
  'Laser',
  'Endoscope',
  'Page / URL',
  'Notifications',
  'Fluence',
  'Irradiance',
]);

const PRODUCT_TOKENS = ['RepairPlanet', 'Total Service Pro', 'Premium', 'Team'];

test('Spanish and French dictionaries cover the same public strings as Farsi', () => {
  const faKeys = Object.keys(FA_COPY);
  assert.deepEqual(Object.keys(ES_COPY).sort(), [...faKeys].sort());
  assert.deepEqual(Object.keys(FR_COPY).sort(), [...faKeys].sort());
  assert.equal(ES_COPY.Language, 'Idioma');
  assert.equal(FR_COPY.Language, 'Langue');
  assert.equal(FA_COPY.Language, 'زبان');
});

test('translations keep product names, prices, and placeholders', () => {
  for (const [label, copy] of [
    ['es', ES_COPY],
    ['fr', FR_COPY],
  ] as const) {
    for (const key of Object.keys(FA_COPY)) {
      const value = copy[key];
      assert.equal(typeof value, 'string', `${label} missing ${key}`);
      if (!ALLOW_SAME.has(key)) {
        assert.notEqual(value, key, `${label} left English: ${key}`);
      }
      for (const token of PRODUCT_TOKENS) {
        if (key.includes(token)) {
          assert.ok(value.includes(token), `${label} dropped ${token} from ${key}`);
        }
      }
      for (const amount of key.match(/\$[\d,]+/g) ?? []) {
        assert.ok(value.includes(amount), `${label} dropped ${amount} from ${key}`);
      }
      for (const placeholder of key.match(/\{(shown|total|qty)\}/g) ?? []) {
        assert.ok(value.includes(placeholder), `${label} dropped ${placeholder} from ${key}`);
      }
    }
  }
  assert.equal(ES_COPY['What did you expect, and what did you see instead?'].startsWith('¿'), true);
  assert.doesNotMatch(Object.values(FR_COPY).join('\n'), /[\u0152\u0153]/);
});

test('public locale links stay on the mirrored pages', () => {
  assert.equal(prefixLocaleHref('es', '/plans'), '/es/plans');
  assert.equal(prefixLocaleHref('fr', '/'), '/fr');
  assert.equal(prefixLocaleHref('fa', '/#find-a-rep'), '/fa#find-a-rep');
  assert.equal(prefixLocaleHref('es', '/hub'), '/es/login');
  assert.equal(prefixLocaleHref('es', '/es/plans'), '/es/plans');
  assert.equal(prefixLocaleHref('fr', 'mailto:hi@example.com'), 'mailto:hi@example.com');
  assert.equal(prefixLocaleHref('fr', 'https://example.com'), 'https://example.com');
  assert.equal(prefixLocaleHref('en', '/plans'), '/plans');

  assert.equal(hrefForLocale('/plans', 'es'), '/es/plans');
  assert.equal(hrefForLocale('/', 'fr'), '/fr');
  assert.equal(hrefForLocale('/fa/directory', 'en'), '/directory');
  assert.equal(hrefForLocale('/es/plans', 'fr', '?role=owner'), '/fr/plans?role=owner');
  assert.equal(hrefForLocale('/hub', 'es'), '/es');
  assert.equal(PUBLIC_PATHS.has('/calculators'), true);
  assert.equal(PUBLIC_PATHS.has('/business/job-costing'), false);
});

test('Spanish and French read left to right; Farsi stays right to left', () => {
  const byId = Object.fromEntries(PUBLIC_LOCALES.map((item) => [item.id, item]));
  assert.equal(byId.es.dir, 'ltr');
  assert.equal(byId.fr.dir, 'ltr');
  assert.equal(byId.fa.dir, 'rtl');
  assert.equal(byId.en.dir, 'ltr');
  assert.deepEqual(
    PUBLIC_LOCALES.map((item) => item.label),
    ['English', 'فارسی', 'Español', 'Français'],
  );
});

test('merged job costing and financial reporting stay in the signed-in chrome', () => {
  const header = read('components/Header.tsx');
  const hub = read('app/hub/page.tsx');
  const home = read('components/home/HomeDashboard.tsx');
  const session = read('lib/auth-session.ts');
  const ga = read('lib/ga.ts');
  assert.match(header, /jobCostingNavLink/);
  assert.match(header, /financialReportingNavLink/);
  assert.match(header, /LanguageSelector variant="header"/);
  assert.match(header, /user \? 'overflow-x-auto \[scrollbar-width:none\] \[&::-webkit-scrollbar\]:hidden' : 'overflow-visible'/);
  assert.match(hub, /\/business\/job-costing/);
  assert.match(hub, /\/business\/financial-reporting/);
  assert.match(home, /\/business\/job-costing/);
  assert.match(home, /\/business\/financial-reporting/);
  assert.match(session, /JOB_COSTING_API/);
  assert.match(session, /FINANCIAL_REPORTING_API/);
  assert.match(ga, /\/business\/job-costing/);
  assert.match(ga, /\/business\/financial-reporting/);
});

test('English fonts stay Geist, Geist Mono, and DM Sans', () => {
  const layout = read('app/layout.tsx');
  assert.match(layout, /Geist, Geist_Mono, DM_Sans/);
  assert.match(layout, /d\.lang="es";d\.dir="ltr"/);
  assert.match(layout, /d\.lang="fr";d\.dir="ltr"/);
  assert.match(layout, /d\.lang="fa";d\.dir="rtl"/);
  assert.doesNotMatch(layout, /vazirmatn/i);
  assert.match(read('app/fa/fa-preview.css'), /vazirmatn/i);
});
