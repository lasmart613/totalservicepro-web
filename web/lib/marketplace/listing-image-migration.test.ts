import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const proof = path.join(here, '../../supabase/tests/20261122_marketplace_images_mime.sql');
const mig968 = path.join(here, '../../supabase/migrations/20261122_000968_marketplace_images_mime.sql');

function psql(database: string, sql: string) {
  return spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
  });
}

function psqlFile(database: string, file: string) {
  return spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-f', file],
    { encoding: 'utf8' }
  );
}

test('local postgres: 000968 priors and 000970 folder index', () => {
  const probe = spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'SELECT 1'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) return;

  const name = 'marketplace_images_mime_proof';
  psql('postgres', `DROP DATABASE IF EXISTS ${name}; CREATE DATABASE ${name};`);
  try {
    const happy = psqlFile(name, proof);
    assert.equal(happy.status, 0, `${happy.stdout}\n${happy.stderr}`);
    assert.match(happy.stdout, /20261122 marketplace images proof ok/);

    const drift = psql(
      name,
      `
      UPDATE storage.buckets
      SET allowed_mime_types = ARRAY['image/gif']::text[], file_size_limit = NULL
      WHERE id = 'marketplace-images';
      \\ir ${mig968}
      `
    );
    assert.notEqual(drift.status, 0);
    assert.match(`${drift.stdout}\n${drift.stderr}`, /refusing to replace/);

    const size = psql(
      name,
      `
      UPDATE storage.buckets
      SET allowed_mime_types = ARRAY['image/jpeg','image/jpg']::text[], file_size_limit = 100
      WHERE id = 'marketplace-images';
      \\ir ${mig968}
      `
    );
    assert.notEqual(size.status, 0);
    assert.match(`${size.stdout}\n${size.stderr}`, /file_size_limit/);

    const missingRow = psql(
      'postgres',
      `
      DROP DATABASE IF EXISTS marketplace_images_mime_missing;
      CREATE DATABASE marketplace_images_mime_missing;
      `
    );
    assert.equal(missingRow.status, 0, missingRow.stderr);
    const noRow = psql(
      'marketplace_images_mime_missing',
      `
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
      \\ir ${mig968}
      `
    );
    assert.notEqual(noRow.status, 0);
    assert.match(`${noRow.stdout}\n${noRow.stderr}`, /does not exist/);

    const noSchema = psql(
      'postgres',
      `DROP DATABASE IF EXISTS marketplace_images_mime_noschema; CREATE DATABASE marketplace_images_mime_noschema;`
    );
    assert.equal(noSchema.status, 0, noSchema.stderr);
    const bare = psql('marketplace_images_mime_noschema', `\\ir ${mig968}\n`);
    assert.notEqual(bare.status, 0);
    assert.match(`${bare.stdout}\n${bare.stderr}`, /storage\.buckets is missing/);
  } finally {
    psql(
      'postgres',
      `
      DROP DATABASE IF EXISTS marketplace_images_mime_proof;
      DROP DATABASE IF EXISTS marketplace_images_mime_missing;
      DROP DATABASE IF EXISTS marketplace_images_mime_noschema;
      `
    );
  }
});

test('000968 source still names both priors', () => {
  const sql = readFileSync(mig968, 'utf8');
  assert.match(sql, /allowed_mime_types IS NOT NULL/);
  assert.match(sql, /ARRAY\['image\/jpeg', 'image\/jpg'\]/);
  assert.match(sql, /ARRAY\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
  assert.match(readFileSync(proof, 'utf8'), /NULL prior/);
  assert.match(readFileSync(proof, 'utf8'), /jpeg\/jpg prior/);
});
