import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appStrings } from './app-copy.ts';
import {
  explicitPublicLocale,
  localeFromAcceptLanguage,
  estimateDocumentLocale,
  resolveCustomerPageLocale,
  storedOrgLanguage,
} from './customer-locale.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('customer confirm locale prefers the org language, then ?lang=, then Accept-Language', () => {
  assert.equal(explicitPublicLocale(''), null);
  assert.equal(explicitPublicLocale('zh-CN'), null);
  assert.equal(explicitPublicLocale('en-GB'), 'en');
  assert.equal(explicitPublicLocale('pt-BR'), 'pt');
  assert.equal(explicitPublicLocale('de-AT'), 'de');

  assert.equal(localeFromAcceptLanguage(null), null);
  assert.equal(localeFromAcceptLanguage('zh-CN,de;q=0.8'), 'de');
  assert.equal(localeFromAcceptLanguage('fr-CA;q=0.2, de;q=0.9'), 'de');
  assert.equal(localeFromAcceptLanguage('en-US,ar;q=0.8'), 'en');

  assert.equal(
    resolveCustomerPageLocale({ orgLanguage: 'de', queryLang: 'ar', acceptLanguage: 'fr' }),
    'de',
  );
  assert.equal(
    resolveCustomerPageLocale({ orgLanguage: 'en', queryLang: 'ar', acceptLanguage: 'fr' }),
    'en',
  );
  assert.equal(
    resolveCustomerPageLocale({ orgLanguage: null, queryLang: 'ar', acceptLanguage: 'de' }),
    'ar',
  );
  assert.equal(
    resolveCustomerPageLocale({ queryLang: 'nope', acceptLanguage: 'he-IL,en;q=0.5' }),
    'he',
  );
  assert.equal(resolveCustomerPageLocale({ acceptLanguage: 'zh' }), 'en');
  assert.equal(resolveCustomerPageLocale({}), 'en');
  assert.equal(resolveCustomerPageLocale({ orgLanguage: 'pt_BR' }), 'pt');
});

test('stored org language is read from the estimate payload only', () => {
  assert.equal(storedOrgLanguage(null), null);
  assert.equal(storedOrgLanguage('{"manufacturer":"Lumenis"}'), null);
  assert.equal(storedOrgLanguage({ siteLanguage: ' ar ' }), 'ar');
  assert.equal(storedOrgLanguage({ locale: 'de' }), 'de');
  assert.equal(storedOrgLanguage('{"site_language":"fa"}'), 'fa');
});

test('document_locale wins, then estimate_data, then nothing', () => {
  assert.equal(
    estimateDocumentLocale({ document_locale: ' ar ', estimate_data: { siteLanguage: 'de' } }),
    'ar',
  );
  assert.equal(
    estimateDocumentLocale({ document_locale: 'en', estimate_data: { siteLanguage: 'de' } }),
    'en',
  );
  assert.equal(estimateDocumentLocale({ document_locale: '  ', estimate_data: { locale: 'de' } }), 'de');
  assert.equal(estimateDocumentLocale({ estimate_data: { manufacturer: 'Lumenis' } }), null);
  assert.equal(estimateDocumentLocale(null), null);
  assert.equal(
    resolveCustomerPageLocale({ orgLanguage: 'ar', queryLang: null, acceptLanguage: 'en-US' }),
    'ar',
  );
  assert.equal(
    resolveCustomerPageLocale({ orgLanguage: null, queryLang: null, acceptLanguage: 'en-US' }),
    'en',
  );
});

test('confirm page translates from the customer locale and keeps confirm fields', () => {
  const page = readFileSync(join(here, '../../app/e/[token]/page.tsx'), 'utf8');
  const client = readFileSync(join(here, '../../app/e/[token]/EstimateActionClient.tsx'), 'utf8');
  const loader = readFileSync(join(here, '../billing/estimate-action.ts'), 'utf8');
  assert.match(page, /resolveCustomerPageLocale/);
  assert.match(page, /accept-language/);
  assert.match(page, /query\.lang/);
  assert.match(page, /orgLanguage/);
  assert.match(loader, /estimateDocumentLocale/);
  assert.doesNotMatch(loader, /signEstimateActionConfirm\([^)]*locale/);
  assert.match(client, /dir=\{meta\.dir\}/);
  assert.match(client, /Approve estimate/);
  assert.match(client, /Reject estimate/);
  assert.match(client, /confirms\.approve/);
  assert.doesNotMatch(client, /useT\(|useFormatDate\(|useEffect|toLocaleDateString/);
});

test('rtl confirm sentences keep a period after a Latin name or number', () => {
  const keys = [
    'We’ve notified {company}.',
    'Expired on {date}',
    'Good for {days} days (through {date})',
    'You requested a modification: “{note}”. You can still approve or reject this estimate.',
  ];
  for (const locale of ['ar', 'he', 'fa'] as const) {
    for (const key of keys) {
      const text = appStrings(locale)[key];
      assert.equal(
        /\{(?:company|date|days|note|shop)\}\.(?!\u200f)/.test(text),
        false,
        `${locale} ${key}`,
      );
      assert.equal(/\{(?:date|days)\}\)?$/.test(text), false, `${locale} ${key} ends on a number`);
      assert.match(text, /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/);
    }
  }
});
