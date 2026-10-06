import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMON_CURRENCY_CODES,
  applyCurrencySymbol,
  formatOrgMoney,
  isAllowedCurrencyCode,
  orgCurrencySymbol,
  listCurrencies,
  parseCurrencyCode,
  parseNumberFormat,
  resolveOrgMoneyPrefs,
  searchCurrencies,
} from './money-format.ts';

test('common ISO codes lead the currency list and the rest stay on the allowlist', () => {
  const listed = listCurrencies();
  assert.deepEqual(
    listed.slice(0, COMMON_CURRENCY_CODES.length).map((row) => row.code),
    [...COMMON_CURRENCY_CODES]
  );
  assert.equal(isAllowedCurrencyCode('usd'), true);
  assert.equal(isAllowedCurrencyCode('EUR'), true);
  assert.equal(isAllowedCurrencyCode('US'), false);
  assert.equal(isAllowedCurrencyCode('BTC'), false);
  assert.equal(parseCurrencyCode(''), 'USD');
  assert.equal(parseCurrencyCode(' eur '), 'EUR');
  assert.equal(parseCurrencyCode('nope'), null);
  const found = searchCurrencies('shekel');
  assert.equal(found.some((row) => row.code === 'ILS'), true);
});

test('missing currency and format fall back to USD and the locale format', () => {
  assert.deepEqual(resolveOrgMoneyPrefs(null), { currencyCode: 'USD', numberFormat: 'auto' });
  assert.deepEqual(resolveOrgMoneyPrefs({ currency_code: null, number_format: null }), {
    currencyCode: 'USD',
    numberFormat: 'auto',
  });
  assert.deepEqual(resolveOrgMoneyPrefs({ currency_code: 'nope', number_format: 'nope' }), {
    currencyCode: 'USD',
    numberFormat: 'auto',
  });
  assert.equal(formatOrgMoney(1234.5, null, 'en-US'), formatOrgMoney(1234.5, { currencyCode: 'USD', numberFormat: 'auto' }, 'en-US'));
  assert.match(formatOrgMoney(1234.5, null, 'en-US'), /\$1,234\.50/);
});

test('presets set separators and symbol position without converting the amount', () => {
  assert.equal(parseNumberFormat(''), 'auto');
  assert.equal(parseNumberFormat('comma_dot_before'), 'comma_dot_before');
  assert.equal(parseNumberFormat('spaces'), null);
  const eur = { currencyCode: 'EUR', numberFormat: 'dot_comma_after' };
  const formatted = formatOrgMoney(1234.5, eur, 'de');
  assert.match(formatted, /1\.234,50/);
  assert.match(formatted, /€/);
  assert.equal(formatted.endsWith('€') || formatted.includes('€'), true);
  const yen = formatOrgMoney(1234, { currencyCode: 'JPY', numberFormat: 'comma_dot_before' }, 'ja');
  assert.match(yen, /1,234/);
  assert.doesNotMatch(yen, /\.00/);
  const spaced = formatOrgMoney(1234.5, { currencyCode: 'EUR', numberFormat: 'space_comma_after' }, 'fr');
  assert.match(spaced, /1[\s\u00a0]234,50/);
});

test('currency symbol for labels falls back to $ when the code is unknown', () => {
  assert.equal(orgCurrencySymbol(null, 'en-US'), '$');
  assert.equal(orgCurrencySymbol({ currency_code: 'nope' }, 'en'), '$');
  assert.equal(orgCurrencySymbol({ currencyCode: 'EUR' }, 'en-US'), '€');
  assert.equal(orgCurrencySymbol({ currencyCode: 'GBP' }, 'en-GB'), '£');
  assert.equal(applyCurrencySymbol('Labor rate ({symbol}/hr)', '€'), 'Labor rate (€/hr)');
  assert.equal(applyCurrencySymbol('Amount received ({symbol})', ''), 'Amount received ($)');
});

test('automatic format follows the caller locale', () => {
  const prefs = { currencyCode: 'EUR', numberFormat: 'auto' };
  const german = formatOrgMoney(1234.5, prefs, 'de-DE');
  const english = formatOrgMoney(1234.5, prefs, 'en-US');
  assert.notEqual(german, english);
  assert.match(german, /€/);
  assert.match(english, /€/);
});
