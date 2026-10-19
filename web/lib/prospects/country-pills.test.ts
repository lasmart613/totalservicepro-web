import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_COUNTRIES,
  cityOptions,
  countryPills,
  filterByCity,
  filterByCountry,
  nextPillIndex,
} from './country-pills.ts';
import { countryLabel, countryOptions, normalizeCountryName } from '../countries.ts';

const rows = [
  { id: 1, country: 'India', city: 'Pune' },
  { id: 2, country: 'India', city: 'pune ' },
  { id: 3, country: 'Egypt', city: 'Cairo' },
  { id: 4, country: null, city: null },
  { id: 5, country: ' ', city: 'X' },
  { id: 6, country: 'United States', city: 'Phoenix' },
  { id: 7, country: 'Egypt', city: 'Giza' },
];

test('pills: All first with the total, then countries by count then name', () => {
  assert.deepEqual(countryPills(rows), [
    { key: ALL_COUNTRIES, country: null, count: 7 },
    { key: 'Egypt', country: 'Egypt', count: 2 },
    { key: 'India', country: 'India', count: 2 },
    { key: 'United States', country: 'United States', count: 1 },
  ]);
});

test('pills only come from the rows given (no rows -> All 0 only)', () => {
  assert.deepEqual(countryPills([]), [{ key: ALL_COUNTRIES, country: null, count: 0 }]);
});

test('aggregate rows count with a weight', () => {
  const aggs = [
    { country: 'India', city: 'Pune', count: 40 },
    { country: 'India', city: 'Delhi', count: 2 },
    { country: null, city: null, count: 3 },
  ];
  assert.deepEqual(countryPills(aggs, (a) => a.count), [
    { key: ALL_COUNTRIES, country: null, count: 45 },
    { key: 'India', country: 'India', count: 42 },
  ]);
});

test('filterByCountry: All returns everything; a country returns its rows', () => {
  assert.equal(filterByCountry(rows, ALL_COUNTRIES).length, 7);
  assert.deepEqual(filterByCountry(rows, 'Egypt').map((r) => r.id), [3, 7]);
  assert.deepEqual(filterByCountry(rows, 'Nowhere'), []);
});

test('city options and filter are case/space-insensitive', () => {
  assert.deepEqual(cityOptions(rows), ['Cairo', 'Giza', 'Phoenix', 'Pune', 'X']);
  assert.deepEqual(filterByCity(rows, 'PUNE').map((r) => r.id), [1, 2]);
  assert.equal(filterByCity(rows, '').length, 7);
});

test('arrow keys wrap and flip in RTL', () => {
  assert.equal(nextPillIndex(0, 'ArrowRight', 3, false), 1);
  assert.equal(nextPillIndex(0, 'ArrowLeft', 3, false), 2);
  assert.equal(nextPillIndex(0, 'ArrowLeft', 3, true), 1);
  assert.equal(nextPillIndex(2, 'Home', 3, true), 0);
  assert.equal(nextPillIndex(0, 'End', 3, false), 2);
  assert.equal(nextPillIndex(1, 'a', 3, false), 1);
});

test('country names: stored English, localized label, sorted options', () => {
  assert.equal(normalizeCountryName(' united arab emirates '), 'United Arab Emirates');
  assert.equal(normalizeCountryName('Atlantis'), null);
  assert.equal(countryLabel('Egypt', 'en'), 'Egypt');
  assert.notEqual(countryLabel('Egypt', 'ar'), 'Egypt');
  const opts = countryOptions('en');
  assert.ok(opts.every((o, i) => i === 0 || opts[i - 1].label.localeCompare(o.label) <= 0));
  assert.ok(countryOptions('ar').some((o) => o.value === 'Saudi Arabia' && o.label !== 'Saudi Arabia'));
  for (const name of ['United States', 'Egypt', 'United Arab Emirates', 'Saudi Arabia', 'India', 'Canada', 'Mexico', 'Brazil']) {
    assert.equal(normalizeCountryName(name), name);
  }
});

import { addErrorKey, isRpcMissing, parseProspectResponse, upgradeCta } from './find-clinics.ts';

test('parseProspectResponse maps server answers', () => {
  assert.deepEqual(parseProspectResponse(null, { code: 'PGRST202', message: 'x' }), { ok: false, reason: 'unavailable' });
  assert.deepEqual(parseProspectResponse({ error: 'not_service_org' }, null), { ok: false, reason: 'not_service_org' });
  const ok = parseProspectResponse({ tier: 'free', total: 3, clinics: [{ id: 1, name: 'A' }], area_counts: [{ country: 'India', city: 'Pune', count: 2 }], country_counts: [{ country: 'India', count: 2 }], page: { limit: 20, offset: 0, filtered_total: 1, has_more: false } }, null);
  assert.ok(ok.ok && ok.data.tier === 'free' && ok.data.free_limit === 20 && ok.data.clinics.length === 1);
  assert.ok(ok.ok && ok.data.aggregates.length === 1 && ok.data.country_counts[0].count === 2 && ok.data.page.has_more === false);
  const prem = parseProspectResponse({ tier: 'premium', total: 0 }, null);
  assert.ok(prem.ok && prem.data.tier === 'premium' && prem.data.clinics.length === 0);
  assert.equal(addErrorKey('daily_cap'), 'You reached the limit for adding clinics in the last 24 hours. You can add more clinics once 24 hours have passed since your earlier adds.');
  assert.equal(addErrorKey('whatever'), 'Could not add this clinic.');
});

test('upgrade CTA: only from a free answer with server counts; never for Premium', () => {
  const free = parseProspectResponse({ tier: 'free', total: 170, clinics: [], aggregates: [], locked: { area: 142, total: 2400 } }, null);
  assert.ok(free.ok);
  assert.deepEqual(upgradeCta(free.ok ? free.data : null), { area: 142, total: 2400 });
  // Premium (incl. complimentary) — even if a locked object were present, no CTA
  const prem = parseProspectResponse({ tier: 'premium', total: 9, clinics: [], aggregates: [], locked: { area: 1, total: 2 } }, null);
  assert.ok(prem.ok && prem.data.locked === null);
  assert.equal(upgradeCta(prem.ok ? prem.data : null), null);
  const none = parseProspectResponse({ tier: 'free', total: 5, clinics: [], aggregates: [], locked: { area: 0, total: 0 } }, null);
  assert.equal(upgradeCta(none.ok ? none.data : null), null);
  assert.equal(upgradeCta(null), null);
});

test('only a missing prospect RPC counts as "not available yet"', () => {
  const un = { ok: false, reason: 'unavailable' };
  assert.deepEqual(parseProspectResponse(null, { code: 'PGRST202', message: 'Could not find the function' }), un);
  assert.deepEqual(parseProspectResponse(null, { code: '42883', message: 'function public.find_clinic_prospects(text, text, integer, integer) does not exist' }), un);
  assert.deepEqual(parseProspectResponse(null, { message: 'Could not find the function public.find_clinic_prospects(p_city, p_country) in the schema cache' }), un);
  assert.equal(isRpcMissing({ code: '42883', message: 'function public.add_prospect_customer(bigint) does not exist' }), true);
});

test('real SQL errors inside the RPC are surfaced, not hidden', () => {
  for (const e of [
    { code: '42P01', message: 'relation "public.prospect_customer_links" does not exist' },
    { code: '42703', message: 'column o.prospect_pool does not exist' },
    { code: '42883', message: 'function public.prospect_state_key(text) does not exist' },
    { code: 'PGRST204', message: "Could not find the 'x' column of 'organizations' in the schema cache" },
    { code: '57014', message: 'canceling statement due to statement timeout' },
  ]) {
    assert.equal(isRpcMissing(e), false, e.message);
    assert.deepEqual(parseProspectResponse(null, e), { ok: false, reason: 'error', message: e.message });
  }
  assert.equal(isRpcMissing(null), false);
});

test('each add refusal has its own message', () => {
  const keys = ['premium_required', 'not_service_org', 'no_org', 'daily_cap', 'not_admin', 'boom'].map(addErrorKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(addErrorKey('premium_required'), 'Adding clinics to your customers requires Premium.');
  assert.equal(addErrorKey('not_service_org'), 'Only service companies can add clinics as customers.');
  assert.equal(addErrorKey('no_org'), 'Join or create a company before adding customers.');
  assert.equal(addErrorKey(undefined), 'Could not add this clinic.');
});

import {
  EMPTY_COUNTRY_NOT_IN_POOL,
  EMPTY_FILTERS,
  EMPTY_NO_COUNTRY,
  EMPTY_NO_LOCATION,
  emptyStateKey,
} from './find-clinics.ts';
import { appStrings } from '../i18n/app-copy.ts';

test('viewer block (000933) is parsed; older answers give null', () => {
  const r = parseProspectResponse({ tier: 'free', total: 0, clinics: [], viewer: { country: 'United States', state: 'US:TX', city: 'dallas', has_location: true, country_pool: 0 } }, null);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.data.viewer, { has_location: true, country_pool: 0 });
  const old = parseProspectResponse({ tier: 'free', total: 0, clinics: [], viewer: { country: null, state: null, city: null } }, null);
  assert.ok(old.ok && old.data.viewer === null);
  const noCountry = parseProspectResponse({ tier: 'free', clinics: [], viewer: { has_location: true, country_pool: null } }, null);
  assert.deepEqual(noCountry.ok && noCountry.data.viewer, { has_location: true, country_pool: null });
  const junk = parseProspectResponse({ tier: 'free', clinics: [], viewer: { has_location: 'yes', country_pool: '3' } }, null);
  assert.ok(junk.ok && junk.data.viewer === null);
});

test('empty state: add-address copy only when the org has no location (L-1)', () => {
  const load = (viewer: unknown, tier = 'free') => {
    const r = parseProspectResponse({ tier, total: 2745, clinics: [], viewer }, null);
    assert.ok(r.ok);
    return r.ok ? r.data : null;
  };
  // US shop with an address: the pool has no US clinics yet
  assert.equal(emptyStateKey(load({ has_location: true, country_pool: 0 })), EMPTY_COUNTRY_NOT_IN_POOL);
  assert.equal(EMPTY_COUNTRY_NOT_IN_POOL, 'We don’t have clinics in your country yet. More regions are coming.');
  // no location at all
  assert.equal(emptyStateKey(load({ has_location: false, country_pool: null })), EMPTY_NO_LOCATION);
  // a city/state but no country
  assert.equal(emptyStateKey(load({ has_location: true, country_pool: null })), EMPTY_NO_COUNTRY);
  // older RPC without the viewer flags keeps the old copy
  assert.equal(emptyStateKey(load(undefined)), EMPTY_NO_LOCATION);
  assert.equal(emptyStateKey(null), EMPTY_NO_LOCATION);
  // Premium: empty only through filters
  assert.equal(emptyStateKey(load({ has_location: true, country_pool: 0 }, 'premium')), EMPTY_FILTERS);
});

test('Find clinics copy has all 8 translations, and the cap copy fits a rolling 24 h', () => {
  const keys = [
    EMPTY_COUNTRY_NOT_IN_POOL,
    EMPTY_NO_COUNTRY,
    EMPTY_NO_LOCATION,
    EMPTY_FILTERS,
    ...['premium_required', 'not_service_org', 'no_org', 'daily_cap', 'not_admin', 'boom'].map(addErrorKey),
  ];
  for (const loc of ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const) {
    const table = appStrings(loc);
    for (const k of keys) {
      assert.ok(table[k] && table[k].trim() && table[k] !== k, `${loc}: ${k}`);
    }
  }
  assert.doesNotMatch(addErrorKey('daily_cap'), /tomorrow|today/i);
  assert.match(addErrorKey('daily_cap'), /24 hours/);
  for (const loc of ['fa', 'he', 'ar'] as const) {
    // RTL locales: real RTL script, not an English fallback
    assert.match(appStrings(loc)[EMPTY_COUNTRY_NOT_IN_POOL], /[\u0590-\u05FF\u0600-\u06FF]/);
  }
});
