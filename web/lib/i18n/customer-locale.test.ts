import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appStrings } from './app-copy.ts';
import { formatOrgMoney } from '../money-format.ts';
import {
  explicitPublicLocale,
  localeFromAcceptLanguage,
  estimateDocumentLocale,
  resolveCustomerPageLocale,
  storedOrgLanguage,
} from './customer-locale.ts';
import { estimateDocumentLocaleScript } from './preference.ts';

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
  for (const key of [
    'Use the button on this page. Opening the email link does not approve or reject the estimate.',
    'This estimate has expired and can no longer be updated online.',
    'Something went wrong. Please try the button again.',
    'Something went wrong. Please contact the company.',
    'Network error. Please try again or call the company.',
  ]) {
    assert.match(client, new RegExp(`t\\('${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
    assert.notEqual(appStrings('de')[key], key, key);
    assert.notEqual(appStrings('ar')[key], key, key);
    assert.match(appStrings('ar')[key], /[\u0600-\u06FF]/, key);
  }
  assert.match(client, /confirms\.approve/);
  assert.doesNotMatch(client, /useT\(|useFormatDate\(|useEffect|toLocaleDateString/);
  assert.match(client, /formatOrgMoney\(n, \{ currencyCode, numberFormat \}, locale\)/);
  assert.match(page, /estimateDocumentLocaleScript/);
  assert.match(page, /LocaleHtml/);
  const layout = readFileSync(join(here, '../../app/layout.tsx'), 'utf8');
  assert.match(layout, /if\(p==="\/e"\|\|p\.indexOf\("\/e\/"\)===0\)return/);
  const provider = readFileSync(join(here, '../fa/locale.tsx'), 'utf8');
  assert.match(provider, /path === '\/e' \|\| path\.startsWith\('\/e\/'\)/);
  const arabic = formatOrgMoney(685.13, { currencyCode: 'USD', numberFormat: 'auto' }, 'ar');
  assert.equal(arabic, '\u200f685.13\u00a0US$');
  assert.match(arabic, /685\.13/);
  assert.match(arabic, /US\$/);
  const script = estimateDocumentLocaleScript('ar');
  assert.match(script, /d\.lang="ar"/);
  assert.match(script, /d\.dir="rtl"/);
  assert.match(script, /ar-preview/);
  assert.match(estimateDocumentLocaleScript('de'), /d\.lang="de"/);
  assert.match(estimateDocumentLocaleScript('de'), /d\.dir="ltr"/);
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
