import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const proof = join(here, '../../supabase/tests/20261105_org_parts_price_lock.sql');
const holdProof = join(here, '../../supabase/tests/20261105_manual_nine_hold.sql');
const migration = join(here, '../../supabase/migrations/20261105_000951_org_parts_inventory_bom.sql');
const fixture = join(here, '../../supabase/fixtures/20261105_qa2655_sample_qty.sql');
const db = 'parts_price_lock_proof';
const holdDb = 'manual_nine_hold_proof';
const leakDb = 'parts_price_preflight_proof';

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

function marked(source: string, begin: string, end: string): string {
  const start = source.indexOf(begin);
  const stop = source.indexOf(end);
  assert.ok(start >= 0 && stop > start, `${begin} markers`);
  return source.slice(start + begin.length, stop);
}

test('actual migration hold trigger blocks terminal writes until manual 9 is complete', () => {
  const migrationSql = readFileSync(migration, 'utf8');
  const objects = marked(migrationSql, '-- HOLD_OBJECTS_BEGIN', '-- HOLD_OBJECTS_END');
  assert.match(objects, /CREATE TRIGGER manual_bom_sweep_hold/);
  assert.equal((objects.match(/shared\/candela\/VPYag\/Sect 4\//g) || []).length, 37);
  const drop = psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${holdDb}`]);
  assert.equal(drop.status, 0, drop.stderr || drop.stdout);
  const created = psql('postgres', ['-c', `CREATE DATABASE ${holdDb}`]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  try {
    const setup = psql(holdDb, [], `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE public.manuals (id bigint PRIMARY KEY);
CREATE TABLE public.laser_models (id bigint PRIMARY KEY);
INSERT INTO public.manuals (id) VALUES (9), (42), (43), (44), (45);
${objects}
`);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const run = psql(holdDb, ['-f', holdProof]);
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${holdDb}`]);
  }
});

test('preflight stops on definer functions, matviews, and bypassrls grants', () => {
  const migrationSql = readFileSync(migration, 'utf8');
  const preflight = marked(migrationSql, '-- PREFLIGHT_CHECK_BEGIN', '-- PREFLIGHT_CHECK_END');
  const drop = psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${leakDb}`]);
  assert.equal(drop.status, 0, drop.stderr || drop.stdout);
  const created = psql('postgres', ['-c', `CREATE DATABASE ${leakDb}`]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  try {
    const setup = psql(leakDb, [], `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qa_bypass') THEN CREATE ROLE qa_bypass NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, qa_bypass;
CREATE TABLE public.parts_catalog (id bigint PRIMARY KEY, sale_price numeric);
CREATE TABLE public.part_vendors (id bigint PRIMARY KEY, unit_cost numeric, currency text);
INSERT INTO public.parts_catalog VALUES (1, 123.45);
GRANT SELECT, INSERT ON TABLE public.parts_catalog TO authenticated;
GRANT SELECT, INSERT ON TABLE public.part_vendors TO authenticated;
GRANT SELECT ON TABLE public.parts_catalog TO qa_bypass;
CREATE FUNCTION public.qa_price_read() RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT sale_price FROM public.parts_catalog ORDER BY id LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION public.qa_price_read() TO authenticated;
CREATE VIEW public.qa_price_via_fn AS SELECT public.qa_price_read() AS sale_price;
GRANT SELECT ON public.qa_price_via_fn TO authenticated;
CREATE VIEW public.qa_price_inner AS SELECT sale_price FROM public.parts_catalog;
GRANT SELECT ON public.qa_price_inner TO authenticated;
CREATE VIEW public.qa_price_outer WITH (security_invoker = true) AS SELECT * FROM public.qa_price_inner;
GRANT SELECT ON public.qa_price_outer TO authenticated;
CREATE MATERIALIZED VIEW public.qa_price_mat AS SELECT sale_price FROM public.parts_catalog;
GRANT SELECT ON public.qa_price_mat TO authenticated;
`);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const read = psql(leakDb, ['-c', "SET ROLE authenticated; SELECT sale_price FROM public.qa_price_via_fn; SELECT sale_price FROM public.qa_price_mat; SELECT sale_price FROM public.qa_price_outer;"]);
    assert.equal(read.status, 0, read.stderr || read.stdout);
    assert.equal((read.stdout.match(/123\.45/g) || []).length, 3, read.stdout);

    const bypass = psql(leakDb, [], preflight);
    assert.notEqual(bypass.status, 0);
    assert.match(bypass.stderr, /qa_bypass/);
    const stillThere = psql(leakDb, ['-c', "SELECT rolname FROM pg_roles WHERE rolname = 'qa_bypass'"]);
    assert.match(stillThere.stdout, /qa_bypass/);

    const paths = psql(leakDb, ['-c', 'REVOKE ALL ON TABLE public.parts_catalog FROM qa_bypass']);
    assert.equal(paths.status, 0, paths.stderr || paths.stdout);
    const leaked = psql(leakDb, [], preflight);
    assert.notEqual(leaked.status, 0);
    assert.match(leaked.stderr, /qa_price_read/);
    assert.match(leaked.stderr, /qa_price_mat/);
    assert.match(leaked.stderr, /qa_price_outer/);
    const fnRemains = psql(leakDb, ['-c', "SELECT proname FROM pg_proc WHERE proname = 'qa_price_read'"]);
    assert.match(fnRemains.stdout, /qa_price_read/);

    const cleared = psql(leakDb, [], `
DROP VIEW public.qa_price_outer;
DROP VIEW public.qa_price_inner;
DROP VIEW public.qa_price_via_fn;
DROP FUNCTION public.qa_price_read();
DROP MATERIALIZED VIEW public.qa_price_mat;
${preflight}
`);
    assert.equal(cleared.status, 0, cleared.stderr || cleared.stdout);
    assert.match(cleared.stderr + cleared.stdout, /does not clear production/);
  } finally {
    psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${leakDb}`]);
  }
});
