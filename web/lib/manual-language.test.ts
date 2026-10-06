import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManualCatalogInsert } from './manual-catalog-admin.ts';
import {
  MANUAL_TITLE_LANGUAGE_SUFFIXES,
  languageSuffixFromTitle,
  manualLanguageBadge,
  manualLanguageFilterOptions,
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
  assert.equal(
    languageSuffixFromTitle('Siemens SONOLINE Antares Gebruiksaanwijzing (Dutch IFU/Operator; not service manual)'),
    null
  );
  assert.equal(languageSuffixFromTitle('VBeam Perfecta'), null);
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
