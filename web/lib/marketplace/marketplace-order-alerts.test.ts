import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const proof = path.join(here, '../../supabase/tests/20261122_marketplace_order_alerts.sql');
const ORDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function psql(database: string, sql: string) {
  return spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-t', '-A'], {
    input: sql,
    encoding: 'utf8',
  });
}

function psqlAsync(database: string, sql: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('sudo', ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-t', '-A'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(sql);
  });
}

test('local postgres: alert insert conflicts once, then rollback and reapply', async (t) => {
  const probe = spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'SELECT 1'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) {
    t.skip('no local postgres');
    return;
  }

  const name = 'marketplace_order_alerts_proof';
  const setup = psql('postgres', `DROP DATABASE IF EXISTS ${name}; CREATE DATABASE ${name};`);
  assert.equal(setup.status, 0, setup.stderr);
  try {
    const ran = spawnSync(
      'sudo',
      ['-u', 'postgres', 'psql', '-d', name, '-v', 'ON_ERROR_STOP=1', '-f', proof],
      { encoding: 'utf8' }
    );
    assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
    assert.match(ran.stdout, /000973 proof ok/);

    const seed = psql(name, `INSERT INTO public.marketplace_orders (id) VALUES ('${ORDER}');`);
    assert.equal(seed.status, 0, seed.stderr);
    const insert = `INSERT INTO public.marketplace_order_alerts (order_id, status) VALUES ('${ORDER}', 'stock_pending') ON CONFLICT (order_id, status) DO NOTHING RETURNING order_id;`;
    const held = psqlAsync(name, `BEGIN; ${insert} SELECT pg_catalog.pg_sleep(0.4); COMMIT;`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = await psqlAsync(name, insert);
    const first = await held;
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const inserted = `${first.stdout}\n${second.stdout}`
      .trim()
      .split(/\s+/)
      .filter((line) => line === ORDER);
    assert.deepEqual(inserted, [ORDER]);
    const count = psql(
      name,
      `SELECT count(*) FROM public.marketplace_order_alerts WHERE order_id = '${ORDER}';`
    );
    assert.equal(count.status, 0, count.stderr);
    assert.match(count.stdout, /^1$/m);
  } finally {
    psql('postgres', `DROP DATABASE IF EXISTS ${name};`);
  }
});
