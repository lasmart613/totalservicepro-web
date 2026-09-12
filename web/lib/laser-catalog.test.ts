import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listManufacturers, listModelsForManufacturer } from './laser-catalog.ts';
import { resolveModelDef } from './models.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('Cynosure is a manufacturer and yields models including Apogee Elite MPX', () => {
  const mfrs = listManufacturers();
  assert.ok(mfrs.includes('Cynosure'));
  assert.ok(mfrs.includes('Candela'));

  const cynosure = listModelsForManufacturer('Cynosure');
  assert.ok(cynosure.length > 0, 'Cynosure model dropdown must not be empty');
  assert.ok(cynosure.includes('Apogee Elite MPX'));
  assert.ok(cynosure.includes('Apogee Elite'));
  assert.ok(cynosure.includes('Apogee Elite+ / Elite Plus'));
  assert.ok(cynosure.includes('Elite+'));
  assert.ok(cynosure.includes('PicoSure'));

  const candela = listModelsForManufacturer('Candela');
  assert.ok(candela.length > 0);
  assert.ok(candela.some((name) => /gentle/i.test(name) || /vbeam|v-beam|perfecta/i.test(name)));
});

test('Cynosure model lookup is case-insensitive', () => {
  const upper = listModelsForManufacturer('CYNOSURE');
  const lower = listModelsForManufacturer('cynosure');
  assert.deepEqual(upper, lower);
  assert.ok(upper.includes('Apogee Elite MPX'));
});

test('resolveModelDef maps Apogee Elite MPX free text', () => {
  const def = resolveModelDef('Apogee Elite MPX', 'Cynosure');
  assert.ok(def);
  assert.equal(def?.mfg, 'Cynosure');
  assert.equal(def?.label, 'Apogee Elite MPX');
});

test('Cynosure laser_models seed is idempotent and does not touch equipment', () => {
  const migration = readFileSync(
    join(here, '../supabase/migrations/20260912_000000_cynosure_laser_models.sql'),
    'utf8'
  );
  assert.match(migration, /Cynosure/);
  assert.match(migration, /Apogee Elite MPX/);
  assert.match(migration, /Apogee Elite\+/);
  assert.match(migration, /ON CONFLICT \(name\) DO NOTHING/);
  assert.match(migration, /NOT EXISTS/);
  assert.match(migration, /laser_models/);
  assert.match(migration, /manufacturers/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.equipment/i);
  assert.doesNotMatch(migration, /TRUNCATE\s+public\.equipment/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.equipment/i);
});
