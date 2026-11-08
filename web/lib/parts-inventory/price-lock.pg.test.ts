import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const proof = join(here, '../../supabase/tests/20261105_org_parts_price_lock.sql');
const fixture = join(here, '../../supabase/fixtures/20261105_qa2655_sample_qty.sql');
const db = 'parts_price_lock_proof';

function psql(database: string, args: string[], input?: string) {
  return spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    input,
  });
}

test('isolated postgres 16: inherited grants cannot write shared prices', () => {
  const probe = spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'SHOW server_version_num'], {
    encoding: 'utf8',
  });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const version = Number((probe.stdout.match(/\d{6}/) || [])[0]);
  assert.ok(version >= 160000 && version < 170000, probe.stdout);

  const drop = psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${db}`]);
  assert.equal(drop.status, 0, drop.stderr || drop.stdout);
  const created = psql('postgres', ['-c', `CREATE DATABASE ${db}`]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  try {
    const run = psql(db, ['-f', proof]);
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const closed = psql(db, ['-f', fixture]);
    assert.notEqual(closed.status, 0);
    assert.match(closed.stderr, /refusing QA fixture/);

    const local = psql(db, [
      '-c', "SELECT set_config('tsp.allow_qa_fixture', 'local-2655', false), set_config('tsp.environment', 'local', false)",
      '-f', fixture,
    ]);
    assert.notEqual(local.status, 0);
    assert.match(local.stderr, /QA org 2655 is not in this database/);
    assert.doesNotMatch(local.stderr, /refusing QA fixture/);
  } finally {
    psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${db}`]);
  }
});
