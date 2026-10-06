import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManualCatalogInsert } from './manual-catalog-admin.ts';
import {
  MANUAL_TITLE_LANGUAGE_LAST_WORDS,
  MANUAL_TITLE_LANGUAGE_SUFFIXES,
  languageSuffixFromTitle,
  manualLanguageBadge,
  manualLanguageFilterOptions,
  manualQueryLanguageMatch,
  resolveManualLanguage,
} from './manual-language.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('title suffixes map to ISO 639-1 and other notes stay English', () => {
  assert.equal(languageSuffixFromTitle('GentleMax Pro (German)'), 'de');
  assert.equal(languageSuffixFromTitle('GentleMax Pro (spanish)'), 'es');
  assert.equal(languageSuffixFromTitle('Elite (Français)'), 'fr');
  assert.equal(languageSuffixFromTitle('VBeam (Italian)'), 'it');
  assert.equal(languageSuffixFromTitle('Alex (Japanese)'), 'ja');
  assert.equal(languageSuffixFromTitle('Ho (Portuguese)'), 'pt');
  assert.equal(languageSuffixFromTitle('Ho (Brazilian Portuguese)'), 'pt');
  assert.equal(languageSuffixFromTitle('AcuPulse (Chinese)'), 'zh');
  assert.equal(languageSuffixFromTitle('Litho IFU (EN)'), 'en');
  assert.equal(languageSuffixFromTitle('GentleMax Pro (Service Manual, German)'), 'de');
  assert.equal(languageSuffixFromTitle('GentleMax Pro (… German)'), 'de');
  assert.equal(languageSuffixFromTitle('UltraPulse (notes in Spanish)'), 'es');
  assert.equal(languageSuffixFromTitle('AcuPulse (Service Manual, Brazilian Portuguese)'), 'pt');
  assert.equal(languageSuffixFromTitle('Elite (Service Manual, Deutsch)'), 'de');
  assert.equal(
    languageSuffixFromTitle('Siemens SONOLINE Antares Gebruiksaanwijzing (Dutch IFU/Operator; not service manual)'),
    null
  );
  assert.equal(languageSuffixFromTitle('VBeam (French Operator Manual)'), null);
  assert.equal(languageSuffixFromTitle('VBeam (Operator Manual)'), null);
  assert.equal(languageSuffixFromTitle('VBeam (not service manual)'), null);
  assert.equal(languageSuffixFromTitle('VBeam (Germanium handpiece)'), null);
  assert.equal(languageSuffixFromTitle('VBeam (Service Manual, DE)'), null);
  assert.equal(languageSuffixFromTitle('VBeam (German translation draft)'), null);
  assert.equal(languageSuffixFromTitle('VBeam Perfecta'), null);
  assert.equal(languageSuffixFromTitle('How to speak Spanish'), null);
  assert.equal(resolveManualLanguage({ title: 'GentleMax Pro (German)', language: 'en' }), 'de');
  assert.equal(resolveManualLanguage({ title: 'GentleMax Pro', language: 'ja' }), 'ja');
  assert.equal(resolveManualLanguage({ title: 'GentleMax Pro' }), 'en');
  assert.equal(manualLanguageBadge('en'), null);
  assert.equal(manualLanguageBadge(null), null);
  assert.deepEqual(manualLanguageBadge('de'), { code: 'DE', label: 'German' });
});

test('language migration backfills codes and does not rewrite titles', () => {
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261005_000001_manuals_language.sql'),
    'utf8'
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS language text/);
  assert.match(sql, /SET DEFAULT 'en'/);
  assert.match(sql, /manuals_language_check/);
  assert.match(sql, /language IS NULL OR language ~ '\^\[a-z\]\{2\}\$'/);
  assert.match(sql, /idx_manuals_language/);
  assert.match(sql, /SET language = 'en'/);
  assert.match(sql, /WHERE language IS NULL/);
  assert.doesNotMatch(sql, /SET\s+title\b/i);
  assert.doesNotMatch(sql, /\btitle\s*=/);
  for (const [suffix, code] of MANUAL_TITLE_LANGUAGE_SUFFIXES) {
    assert.match(sql, new RegExp(`\\('${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}', '${code}'\\)`));
  }
});

test('catalog insert keeps the title suffix and stores the language code', () => {
  const row = parseManualCatalogInsert({
    brand: 'Candela',
    model: 'GentleMax',
    title: 'GentleMax Pro (German)',
    storage_path: 'shared/candela/gentlemax/gentlemax-pro-de.pdf',
  });
  assert.equal(row.ok, true);
  if (!row.ok) return;
  assert.equal(row.row.title, 'GentleMax Pro (German)');
  assert.equal(row.row.language, 'de');

  const explicit = parseManualCatalogInsert({
    brand: 'Candela',
    model: 'GentleMax',
    title: 'GentleMax Pro',
    language: 'ja',
    storage_path: 'shared/candela/gentlemax/gentlemax-pro-ja.pdf',
  });
  assert.equal(explicit.ok, true);
  if (explicit.ok) assert.equal(explicit.row.language, 'ja');

  const bad = parseManualCatalogInsert({
    brand: 'Candela',
    model: 'GentleMax',
    title: 'GentleMax Pro',
    language: 'german',
    storage_path: 'shared/candela/gentlemax/gentlemax-pro.pdf',
  });
  assert.equal(bad.ok, false);

  const options = manualLanguageFilterOptions([
    { title: 'GentleMax Pro', language: 'en' },
    { title: 'GentleMax Pro (German)', language: 'de' },
  ]);
  assert.deepEqual(
    options.map((option) => option.value),
    ['all', 'en', 'de']
  );
});

test('last word of a bracket is a language, and empty languages stay out of the filter', () => {
  const tagged = parseManualCatalogInsert({
    brand: 'Candela',
    model: 'GentleMax',
    title: 'GentleMax Pro (Service Manual, German)',
    storage_path: 'shared/candela/gentlemax/gentlemax-pro-de.pdf',
  });
  assert.equal(tagged.ok, true);
  if (tagged.ok) {
    assert.equal(tagged.row.title, 'GentleMax Pro (Service Manual, German)');
    assert.equal(tagged.row.language, 'de');
  }

  assert.deepEqual(manualQueryLanguageMatch('Spanish'), { codes: ['es'], textQuery: '' });
  assert.deepEqual(manualQueryLanguageMatch('español'), { codes: ['es'], textQuery: '' });
  assert.deepEqual(manualQueryLanguageMatch('Candela Deutsch'), { codes: ['de'], textQuery: 'candela' });
  assert.deepEqual(manualQueryLanguageMatch('brazilian portuguese'), { codes: ['pt'], textQuery: '' });

  const onlyGerman = manualLanguageFilterOptions([
    { title: 'GentleMax Pro (German)', language: 'de' },
    { title: 'Another (Service Manual, German)', language: 'en' },
  ]);
  assert.deepEqual(
    onlyGerman.map((option) => option.value),
    ['all', 'de']
  );
  assert.deepEqual(
    manualLanguageFilterOptions([]).map((option) => option.value),
    ['all']
  );
});

test('last-word language migration retags bracket suffixes and does not rewrite titles', () => {
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261006_000000_manuals_language_bracket_last_word.sql'),
    'utf8'
  );
  assert.match(sql, /Service Manual, German/);
  assert.match(sql, /map\.code <> 'en'/);
  assert.doesNotMatch(sql, /SET\s+title\b/i);
  assert.doesNotMatch(sql, /\btitle\s*=/);
  assert.doesNotMatch(sql, /\('en', 'en'\)/);
  assert.doesNotMatch(sql, /\('de', 'de'\)/);
  assert.doesNotMatch(sql, /\('no', 'no'\)/);
  assert.doesNotMatch(sql, /\('id', 'id'\)/);
  for (const [word, code] of MANUAL_TITLE_LANGUAGE_LAST_WORDS) {
    assert.match(sql, new RegExp(`\\('${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}', '${code}'\\)`));
  }
});
