import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appStrings, APP_STRING_KEYS } from './app-copy.ts';
import { PUBLIC_LOCALES, type PublicLocale } from './locales.ts';
import { applyDocumentLocale, documentLocaleMeta, parseSiteLanguage } from './preference.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '../..');

function read(rel: string) {
  return readFileSync(join(webDir, rel), 'utf8');
}

const LOCALES = PUBLIC_LOCALES.map((item) => item.id).filter((id): id is Exclude<PublicLocale, 'en'> => id !== 'en');

const ALLOW_SAME = new Set([
  'God Dashboard',
  'Dispatcher',
  'Laser',
  'CSV',
  'Excel',
  'PDF',
  'URL',
  'ID',
]);

test('saved language accepts only the public locale ids', () => {
  assert.equal(parseSiteLanguage(null), 'en');
  assert.equal(parseSiteLanguage(''), 'en');
  assert.equal(parseSiteLanguage('pt-BR'), 'en');
  assert.equal(parseSiteLanguage('iw'), 'en');
  for (const item of PUBLIC_LOCALES) {
    assert.equal(parseSiteLanguage(item.id), item.id);
  }
});

test('document locale follows direction and keeps script font classes off English', () => {
  assert.deepEqual(documentLocaleMeta('en'), { lang: 'en', dir: 'ltr', htmlClass: undefined });
  assert.deepEqual(documentLocaleMeta('he'), { lang: 'he', dir: 'rtl', htmlClass: 'he-preview' });
  assert.deepEqual(documentLocaleMeta('ar'), { lang: 'ar', dir: 'rtl', htmlClass: 'ar-preview' });
  assert.deepEqual(documentLocaleMeta('pt'), { lang: 'pt-BR', dir: 'ltr', htmlClass: undefined });
  assert.equal(documentLocaleMeta('it').dir, 'ltr');
  assert.equal(documentLocaleMeta('de').dir, 'ltr');
  assert.equal(documentLocaleMeta('fa').htmlClass, 'fa-preview');

  const classes = new Set<string>();
  const root = {
    lang: 'en',
    dir: 'ltr',
    classList: {
      add(token: string) {
        classes.add(token);
      },
      remove(token: string) {
        classes.delete(token);
      },
    },
  };
  applyDocumentLocale('he', root);
  assert.equal(root.lang, 'he');
  assert.equal(root.dir, 'rtl');
  assert.deepEqual([...classes], ['he-preview']);
  applyDocumentLocale('de', root);
  assert.equal(root.lang, 'de');
  assert.equal(root.dir, 'ltr');
  assert.equal(classes.size, 0);
  applyDocumentLocale('en', root);
  assert.equal(root.lang, 'en');
  assert.equal(classes.size, 0);
});

test('signed-in dictionaries cover the same chrome in every language', () => {
  const keys = APP_STRING_KEYS;
  assert.ok(keys.includes('Job Costing'));
  assert.ok(keys.includes('Financial Reporting'));
  assert.ok(keys.includes('Settings'));
  assert.ok(keys.includes('Estimates'));
  const joined: Record<string, string> = {};
  for (const locale of LOCALES) {
    const copy = appStrings(locale);
    assert.deepEqual(Object.keys(copy).sort(), [...keys].sort(), locale);
    joined[locale] = Object.values(copy).join('\n');
    for (const key of keys) {
      const value = copy[key];
      assert.equal(typeof value, 'string');
      if (!ALLOW_SAME.has(key) && value === key) {
        assert.fail(`${locale} left English: ${key}`);
      }
      for (const token of ['RepairPlanet', 'Total Service Pro', 'Premium']) {
        if (key.includes(token)) assert.ok(value.includes(token), `${locale} dropped ${token} from ${key}`);
      }
      if (key.includes('Premium / Team')) {
        assert.ok(value.includes('Premium') && value.includes('Team'), `${locale} dropped a plan name from ${key}`);
      }
    }
  }
  assert.doesNotMatch(joined.fr, /[\u0152\u0153]/);
  assert.match(joined.he, /[\u0590-\u05FF]/);
  assert.match(joined.ar, /[\u0600-\u06FF]/);
  assert.match(joined.it, /[àèéìòù]/);
  assert.match(joined.de, /[äöüÄÖÜß]/);
  assert.match(joined.pt, /você/i);
  assert.match(joined.pt, /[ãõçáéíóú]/);
  assert.doesNotMatch(joined.pt, /ecrã|utilizador|palavra-passe|telemóvel|ficheiro|autocarro/i);
  for (const key of keys) {
    if (key.length <= 40) continue;
    assert.match(appStrings('he')[key], /[\u0590-\u05FF]/, `he left a long English string: ${key}`);
    assert.match(appStrings('ar')[key], /[\u0600-\u06FF]/, `ar left a long English string: ${key}`);
  }
});

test('Settings and the public menu share one device language', () => {
  const settings = read('app/settings/page.tsx');
  const selector = read('components/i18n/LanguageSelector.tsx');
  const locale = read('lib/fa/locale.tsx');
  const header = read('components/Header.tsx');
  assert.match(settings, /PUBLIC_LOCALES\.map/);
  assert.match(settings, /setSiteLanguage\(item\.id/);
  assert.match(settings, /aria-pressed=\{siteLanguage === item\.id\}/);
  assert.match(settings, /\{item\.label\}/);
  assert.doesNotMatch(settings, /Hebrew|Italian|German|Portuguese|Arabic|Spanish|French|Farsi|Persian/);
  assert.match(selector, /setSiteLanguage\(item\.id\)/);
  assert.match(selector, /useSiteLocale\(\)/);
  assert.match(locale, /writeSiteLanguage\(next\)/);
  assert.match(locale, /PUBLIC_PATHS\.has\(bare\)/);
  assert.match(header, /label: 'Estimates'/);
  assert.match(header, /LanguageSelector variant="header"/);
  assert.match(read('app/layout.tsx'), /localStorage\.getItem\("siteLanguage"\)/);
});
