import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FA_COPY } from '../fa/copy.ts';
import { ES_COPY } from '../es/copy.ts';
import { FR_COPY } from '../fr/copy.ts';
import { HE_COPY } from '../he/copy.ts';
import { IT_COPY } from '../it/copy.ts';
import { DE_COPY } from '../de/copy.ts';
import { PT_COPY } from '../pt/copy.ts';
import { AR_COPY } from '../ar/copy.ts';
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

const LOCALIZED = [
  ['es', ES_COPY],
  ['fr', FR_COPY],
  ['he', HE_COPY],
  ['it', IT_COPY],
  ['de', DE_COPY],
  ['pt', PT_COPY],
  ['ar', AR_COPY],
] as const;

test('public dictionaries cover the same strings as Farsi', () => {
  const faKeys = Object.keys(FA_COPY);
  for (const [label, copy] of LOCALIZED) {
    assert.deepEqual(Object.keys(copy).sort(), [...faKeys].sort(), label);
  }
  assert.equal(ES_COPY.Language, 'Idioma');
  assert.equal(FR_COPY.Language, 'Langue');
  assert.equal(FA_COPY.Language, 'زبان');
  assert.equal(HE_COPY.Language, 'שפה');
  assert.equal(IT_COPY.Language, 'Lingua');
  assert.equal(DE_COPY.Language, 'Sprache');
  assert.equal(PT_COPY.Language, 'Idioma');
  assert.equal(AR_COPY.Language, 'اللغة');
});

test('translations keep product names, prices, and placeholders', () => {
  for (const [label, copy] of LOCALIZED) {
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
  assert.match(Object.values(HE_COPY).join('\n'), /[\u0590-\u05FF]/);
  assert.match(Object.values(AR_COPY).join('\n'), /[\u0600-\u06FF]/);
  assert.match(Object.values(IT_COPY).join('\n'), /[àèéìòù]/);
  assert.match(Object.values(DE_COPY).join('\n'), /[äöüÄÖÜß]/);
  assert.match(Object.values(PT_COPY).join('\n'), /você/);
  assert.match(Object.values(PT_COPY).join('\n'), /[ãõçáéíóú]/);
  assert.doesNotMatch(
    Object.values(PT_COPY).join('\n'),
    /ecrã|utilizador|palavra-passe|telemóvel|ficheiro|autocarro|equipa\b/i,
  );
  for (const [label, copy] of [
    ['he', HE_COPY],
    ['ar', AR_COPY],
  ] as const) {
    const script = label === 'he' ? /[\u0590-\u05FF]/ : /[\u0600-\u06FF]/;
    for (const key of Object.keys(FA_COPY)) {
      if (key.length > 40) assert.match(copy[key], script, `${label} left a long English string: ${key}`);
    }
  }
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
  assert.equal(prefixLocaleHref('he', '/plans'), '/he/plans');
  assert.equal(prefixLocaleHref('it', '/'), '/it');
  assert.equal(prefixLocaleHref('de', '/signup/company'), '/de/signup/company');
  assert.equal(prefixLocaleHref('pt', '/marketplace/parts'), '/pt/marketplace/parts');
  assert.equal(prefixLocaleHref('ar', '/#find-a-rep'), '/ar#find-a-rep');
  assert.equal(hrefForLocale('/it/directory', 'de'), '/de/directory');
  assert.equal(hrefForLocale('/pt/plans', 'en'), '/plans');
  assert.equal(hrefForLocale('/he/login', 'ar', '?role=owner'), '/ar/login?role=owner');
  assert.equal(PUBLIC_PATHS.has('/calculators'), true);
  assert.equal(PUBLIC_PATHS.has('/business/job-costing'), false);
  assert.equal(PUBLIC_PATHS.has('/business/financial-reporting'), false);
});

test('Hebrew and Arabic read right to left; Italian, German, and Portuguese stay left to right', () => {
  const byId = Object.fromEntries(PUBLIC_LOCALES.map((item) => [item.id, item]));
  assert.equal(byId.es.dir, 'ltr');
  assert.equal(byId.fr.dir, 'ltr');
  assert.equal(byId.fa.dir, 'rtl');
  assert.equal(byId.en.dir, 'ltr');
  assert.equal(byId.he.dir, 'rtl');
  assert.equal(byId.ar.dir, 'rtl');
  assert.equal(byId.it.dir, 'ltr');
  assert.equal(byId.de.dir, 'ltr');
  assert.equal(byId.pt.dir, 'ltr');
  assert.equal(byId.pt.htmlLang, 'pt-BR');
  assert.deepEqual(
    PUBLIC_LOCALES.map((item) => item.label),
    ['English', 'فارسی', 'Español', 'Français', 'עברית', 'Italiano', 'Deutsch', 'Português', 'العربية'],
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
  assert.match(header, /hidden lg:flex flex-wrap items-center gap-x-2\.5 gap-y-1/);
  assert.doesNotMatch(header, /overflow-x-auto \[scrollbar-width:none\]/);
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
  assert.match(layout, /from "next\/font\/local"/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(layout, /Geist sans/);
  assert.match(layout, /Geist Mono/);
  assert.match(layout, /DM Sans/);
  assert.match(layout, /--font-geist-sans/);
  assert.match(layout, /--font-geist-mono/);
  assert.match(layout, /--font-dm-sans/);
  assert.match(layout, /Geist-latin\.woff2/);
  assert.match(layout, /GeistMono-latin\.woff2/);
  assert.match(layout, /DMSans-latin\.woff2/);
  assert.match(read('app/fonts/geist/Geist-latin.woff2'), /^wOF2/);
  assert.match(read('app/fonts/geist-mono/GeistMono-latin.woff2'), /^wOF2/);
  assert.match(read('app/fonts/dm-sans/DMSans-latin.woff2'), /^wOF2/);
  assert.match(read('app/fonts/geist/OFL.txt'), /SIL Open Font License/);
  assert.match(read('app/fonts/geist-mono/OFL.txt'), /SIL Open Font License/);
  assert.match(read('app/fonts/dm-sans/OFL.txt'), /SIL Open Font License/);
  assert.match(layout, /d\.lang="es";d\.dir="ltr"/);
  assert.match(layout, /d\.lang="fr";d\.dir="ltr"/);
  assert.match(layout, /d\.lang="fa";d\.dir="rtl"/);
  assert.match(layout, /d\.lang="he";d\.dir="rtl"/);
  assert.match(layout, /d\.lang="ar";d\.dir="rtl"/);
  assert.match(layout, /d\.lang="it";d\.dir="ltr"/);
  assert.match(layout, /d\.lang="de";d\.dir="ltr"/);
  assert.match(layout, /d\.lang="pt-BR";d\.dir="ltr"/);
  assert.doesNotMatch(layout, /vazirmatn/i);
  assert.doesNotMatch(layout, /noto-sans-hebrew/i);
  assert.doesNotMatch(layout, /noto-sans-arabic/i);
  assert.doesNotMatch(read('app/fa/layout.tsx'), /fa-draft-banner/);
  assert.doesNotMatch(read('app/fa/fa-preview.css'), /fa-draft-banner/);
  assert.match(read('app/fa/fa-preview.css'), /vazirmatn/i);
  assert.match(read('app/he/he-preview.css'), /noto-sans-hebrew/i);
  assert.match(read('app/ar/ar-preview.css'), /noto-sans-arabic/i);
  assert.match(read('public/fonts/noto-sans-hebrew.woff2'), /./);
  assert.match(read('public/fonts/noto-sans-arabic.woff2'), /./);
});
