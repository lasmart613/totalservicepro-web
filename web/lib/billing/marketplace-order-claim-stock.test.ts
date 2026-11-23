import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mig = path.join(here, '../../supabase/migrations/20261122_000972_marketplace_order_claim_stock.sql');
const rollback = path.join(here, '../../supabase/migrations/20261122_000972_marketplace_order_claim_stock_rollback.sql');

const LISTING = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';

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

function claimSql(orderId: string, listingId: string, quantity: number): string {
  return `SELECT public.marketplace_order_claim_stock('${orderId}'::uuid, '${listingId}'::uuid, ${quantity});`;
}

test('local postgres: one order claimed concurrently ends at 4, then rollback and reapply', async (t) => {
  const probe = spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'SELECT 1'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) {
    t.skip('no local postgres');
    return;
  }

  const name = 'marketplace_order_claim_proof';
  const setup = psql(
    'postgres',
    `DROP DATABASE IF EXISTS ${name}; CREATE DATABASE ${name};`
  );
  assert.equal(setup.status, 0, setup.stderr);
  try {
    const boot = psql(
      name,
      `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      END $$;
      CREATE TABLE public.marketplace_listings (
        id uuid PRIMARY KEY,
        quantity integer,
        status text,
        updated_at timestamptz
      );
      CREATE TABLE public.marketplace_orders (
        id uuid PRIMARY KEY,
        listing_id uuid,
        status text,
        quantity integer,
        updated_at timestamptz
      );
      INSERT INTO public.marketplace_listings (id, quantity, status)
      VALUES ('${LISTING}'::uuid, 5, 'active');
      INSERT INTO public.marketplace_orders (id, listing_id, status, quantity)
      VALUES ('${ORDER}'::uuid, '${LISTING}'::uuid, 'stock_pending', 1);
      \\ir ${mig}
      `
    );
    assert.equal(boot.status, 0, `${boot.stdout}\n${boot.stderr}`);

    const held = psqlAsync(
      name,
      `BEGIN; ${claimSql(ORDER, LISTING, 1)} SELECT pg_catalog.pg_sleep(0.4); COMMIT;`
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = await psqlAsync(name, claimSql(ORDER, LISTING, 1));
    const first = await held;
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const results = `${first.stdout}\n${second.stdout}`
      .trim()
      .split(/\s+/)
      .filter((line) => line === 'claimed' || line === 'already_settled')
      .sort();
    assert.deepEqual(results, ['already_settled', 'claimed']);

    const after = psql(
      name,
      `SELECT quantity::text || ' ' || status FROM public.marketplace_listings WHERE id = '${LISTING}'::uuid;
       SELECT status FROM public.marketplace_orders WHERE id = '${ORDER}'::uuid;`
    );
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /4 active/);
    assert.match(after.stdout, /paid/);

    const repeat = psql(name, claimSql(ORDER, LISTING, 1));
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.match(repeat.stdout, /already_settled/);
    const still = psql(name, `SELECT quantity FROM public.marketplace_listings WHERE id = '${LISTING}'::uuid;`);
    assert.match(still.stdout, /4/);

    const missId = '33333333-3333-4333-8333-333333333333';
    const missOrder = '44444444-4444-4444-8444-444444444444';
    const miss = psql(
      name,
      `
      INSERT INTO public.marketplace_listings (id, quantity, status) VALUES ('${missId}'::uuid, 0, 'active');
      INSERT INTO public.marketplace_orders (id, listing_id, status, quantity)
      VALUES ('${missOrder}'::uuid, '${missId}'::uuid, 'stock_pending', 1);
      ${claimSql(missOrder, missId, 1)}
      SELECT quantity::text || ' ' || status FROM public.marketplace_listings WHERE id = '${missId}'::uuid;
      SELECT status FROM public.marketplace_orders WHERE id = '${missOrder}'::uuid;
      `
    );
    assert.equal(miss.status, 0, `${miss.stdout}\n${miss.stderr}`);
    assert.match(miss.stdout, /refund_review/);
    assert.match(miss.stdout, /0 active/);

    const grants = psql(
      name,
      `
      SELECT p.prosecdef::text
        || ' ' || COALESCE((SELECT string_agg(cfg, ',') FROM unnest(p.proconfig) cfg), '')
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'marketplace_order_claim_stock';
      SELECT has_function_privilege('service_role', 'public.marketplace_order_claim_stock(uuid,uuid,integer)', 'EXECUTE')::text
        || ' ' || has_function_privilege('authenticated', 'public.marketplace_order_claim_stock(uuid,uuid,integer)', 'EXECUTE')::text
        || ' ' || has_function_privilege('anon', 'public.marketplace_order_claim_stock(uuid,uuid,integer)', 'EXECUTE')::text;
      `
    );
    assert.equal(grants.status, 0, grants.stderr);
    assert.match(grants.stdout, /true/);
    assert.match(grants.stdout, /search_path=/);
    assert.match(grants.stdout, /true false false/);

    const down = psql(name, readFileSync(rollback, 'utf8'));
    assert.equal(down.status, 0, down.stderr);
    const gone = psql(
      name,
      `SELECT to_regprocedure('public.marketplace_order_claim_stock(uuid,uuid,integer)') IS NULL;`
    );
    assert.match(gone.stdout, /t/);

    const up = psql(name, readFileSync(mig, 'utf8'));
    assert.equal(up.status, 0, up.stderr);
    const againId = '55555555-5555-4555-8555-555555555555';
    const againOrder = '66666666-6666-4666-8666-666666666666';
    const reapply = psql(
      name,
      `
      INSERT INTO public.marketplace_listings (id, quantity, status) VALUES ('${againId}'::uuid, 2, 'active');
      INSERT INTO public.marketplace_orders (id, listing_id, status, quantity)
      VALUES ('${againOrder}'::uuid, '${againId}'::uuid, 'stock_pending', 1);
      ${claimSql(againOrder, againId, 1)}
      SELECT quantity FROM public.marketplace_listings WHERE id = '${againId}'::uuid;
      `
    );
    assert.equal(reapply.status, 0, `${reapply.stdout}\n${reapply.stderr}`);
    assert.match(reapply.stdout, /claimed/);
    assert.match(reapply.stdout, /^1$/m);
  } finally {
    psql('postgres', `DROP DATABASE IF EXISTS ${name};`);
  }
});
