import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MANUAL_LIBRARY_SELECT_WITH_KIND, MANUAL_LIBRARY_SELECT_WITH_LANGUAGE } from './manual-library-filter.ts';
import { findManualIdsByBodyText } from './manual-search-index.ts';
import {
  filterPublishedManuals,
  isPublishedColumnMissing,
  parseManualPublishedToggle,
  wherePublished,
} from './manual-published.ts';
import {
  isUnpublishedManual,
  unpublishedManualDenial,
} from '../../supabase/functions/get-manual-url/published.ts';

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

test('unpublished rows are not found and a missing flag stays visible', () => {
  assert.equal(isUnpublishedManual({ published: false }), true);
  assert.equal(isUnpublishedManual({ published: true }), false);
  assert.equal(isUnpublishedManual({}), false);
  assert.equal(isUnpublishedManual(null), false);
  assert.deepEqual(unpublishedManualDenial({ published: false }), { status: 404, error: 'not_found' });
  assert.equal(unpublishedManualDenial({ published: true }), null);
  assert.deepEqual(
    filterPublishedManuals([
      { id: 1, published: true },
      { id: 2, published: false },
      { id: 3 },
    ]).map((row) => row.id),
    [1, 3],
  );
  assert.equal(
    isPublishedColumnMissing("Could not find the 'published' column of 'manuals' in the schema cache"),
    true,
  );
  assert.equal(isPublishedColumnMissing('JWT expired'), false);
  const query = {
    eq(column: string, value: boolean) {
      return { column, value };
    },
  };
  assert.deepEqual(wherePublished(query), { column: 'published', value: true });
});

test('published toggle body is a positive id and a boolean', () => {
  assert.deepEqual(parseManualPublishedToggle({ id: 764, published: false }), {
    ok: true,
    id: 764,
    published: false,
  });
  assert.deepEqual(parseManualPublishedToggle({ manualId: '47', published: true }), {
    ok: true,
    id: 47,
    published: true,
  });
  assert.equal(parseManualPublishedToggle({ id: 0, published: true }).ok, false);
  assert.equal(parseManualPublishedToggle({ id: 12, published: 'false' }).ok, false);
  assert.equal(parseManualPublishedToggle(null).ok, false);
});

test('body search drops unpublished catalog ids and keeps them if the column is missing', async () => {
  function client(manuals: { data: unknown; error: { message?: string } | null }) {
    return {
      from() {
        const builder = {
          select() {
            return builder;
          },
          textSearch: async () => ({ data: [{ manual_id: 1 }, { manual_id: 2 }], error: null }),
          in: async () => manuals,
          filter() {
            return builder;
          },
        };
        return builder;
      },
    };
  }
  const hidden = await findManualIdsByBodyText(
    client({
      data: [
        { id: 1, published: true },
        { id: 2, published: false },
      ],
      error: null,
    }),
    ['laser'],
  );
  assert.deepEqual(hidden.ids, ['1']);

  const missing = await findManualIdsByBodyText(
    client({
      data: null,
      error: { message: "Could not find the 'published' column of 'manuals' in the schema cache" },
    }),
    ['laser'],
  );
  assert.deepEqual(missing.ids, ['1', '2']);
});

test('migration 000911 adds published without a rewrite lock and blocks client writes', () => {
  const sql = read('../supabase/migrations/20261011_000911_manuals_published.sql');
  const rollback = read('../supabase/migrations/20261011_000911_manuals_published_rollback.sql');
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/);
  assert.doesNotMatch(sql, /^\s*COMMIT\s*;/m);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true/i);
  assert.match(sql, /USING \(published = true\)/);
  assert.match(sql, /REVOKE UPDATE \(published\)/);
  assert.match(sql, /manuals_guard_published/);
  assert.match(sql, /current_user NOT IN \('authenticated', 'anon'\)/);
  assert.match(sql, /published cannot be changed/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /JOIN public\.manuals m ON m\.id = i\.manual_id/);
  assert.match(sql, /m\.published = true/);
  assert.match(rollback, /SET LOCAL lock_timeout = '5s'/);
  assert.match(rollback, /DROP COLUMN IF EXISTS published/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.manuals_guard_published/);
  assert.doesNotMatch(rollback, /m\.published/);
  assert.match(MANUAL_LIBRARY_SELECT_WITH_LANGUAGE, /\bpublished\b/);
  assert.doesNotMatch(MANUAL_LIBRARY_SELECT_WITH_KIND, /\bpublished\b/);
});

test('readers skip unpublished manuals and get-manual-url returns not_found', () => {
  const page = read('../app/manuals/page.tsx');
  const search = read('../app/api/manuals/search/route.ts');
  const library = read('../app/api/manuals/library/route.ts');
  const file = read('../app/api/manuals/file/route.ts');
  const assistant = read('../app/ai-assistant/AIAssistantClient.tsx');
  const viewer = read('../components/ManualPdfViewer.tsx');
  const grok = read('../../supabase/functions/grok-assistant/index.ts');
  const edge = read('../../supabase/functions/get-manual-url/index.ts');
  const index = read('./manual-search-index.ts');
  for (const src of [page, search, library, assistant]) {
    assert.match(src, /wherePublished/);
  }
  assert.match(page, /filterPublishedManuals/);
  assert.match(page, /isUnpublishedManual/);
  assert.match(page, /isPublishedColumnMissing/);
  assert.match(library, /error: 'not_found'/);
  assert.match(file, /isUnpublishedManual/);
  assert.match(file, /error: 'not_found'/);
  assert.match(viewer, /isUnpublishedManual/);
  assert.match(index, /keepPublishedManualIds/);
  assert.match(grok, /dropUnpublishedManualRows/);
  assert.match(grok, /catalogManualIsPublished/);
  assert.match(grok, /hideUnpublished/);
  assert.match(grok, /manual_search_index/);
  assert.match(edge, /unpublishedManualResponse/);
  assert.match(edge, /queryManual/);
  assert.match(edge, /error: denied\.error/);
  const android = [
    read('../../app/src/main/assets/manual_library.html'),
    read('../../app/src/main/assets/service_manuals.html'),
    read('../../app/src/main/assets/ai_assistant.html'),
    read('../../app/src/main/assets/pdf_viewer.html'),
  ];
  for (const src of android) assert.match(src, /published/);
});

test('Published toggle is a God-only service-role route', () => {
  const route = read('../app/api/god/manuals/published/route.ts');
  const page = read('../app/admin/god/manuals/page.tsx');
  const browser = read('../components/god/GodTableBrowser.tsx');
  assert.match(route, /requireGodCaller/);
  assert.match(route, /getSupabaseAdmin/);
  assert.match(route, /parseManualPublishedToggle/);
  const getFn = route.slice(route.indexOf('export async function GET'));
  const patchFn = route.slice(route.indexOf('export async function PATCH'));
  assert.ok(getFn.indexOf('requireGodCaller') < getFn.indexOf('getSupabaseAdmin'));
  assert.ok(patchFn.indexOf('requireGodCaller') < patchFn.indexOf('getSupabaseAdmin'));
  assert.ok(patchFn.indexOf('parseManualPublishedToggle') < patchFn.indexOf('.update('));
  assert.match(page, /\/api\/god\/manuals\/published/);
  assert.match(page, /Published/);
  assert.match(page, /Unpublished/);
  assert.match(page, /godAuthHeader/);
  assert.match(browser, /Unpublished/);
});

test('local postgres: clients cannot flip published and search skips unpublished rows', () => {
  const probe = spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'SELECT 1'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) {
    return;
  }
  const sql = `
DROP DATABASE IF EXISTS manuals_published_proof;
CREATE DATABASE manuals_published_proof;
`;
  const setup = spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
  });
  assert.equal(setup.status, 0, setup.stderr || setup.stdout);

  const proof = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;
CREATE TABLE public.manuals (
  id bigint PRIMARY KEY,
  title text NOT NULL,
  storage_path text NOT NULL,
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT ''
);
CREATE TABLE public.manual_search_index (
  manual_id bigint PRIMARY KEY REFERENCES public.manuals(id) ON DELETE CASCADE,
  search_text text NOT NULL DEFAULT '',
  search_tsv tsvector
);
INSERT INTO public.manuals (id, title, storage_path) VALUES
  (1, 'Visible laser', 'shared/visible.pdf'),
  (2, 'Hidden laser', 'shared/hidden.pdf');
INSERT INTO public.manual_search_index (manual_id, search_text, search_tsv) VALUES
  (1, 'visible laser cavity', to_tsvector('simple', 'visible laser cavity')),
  (2, 'hidden laser cavity', to_tsvector('simple', 'hidden laser cavity'));
GRANT SELECT, INSERT, UPDATE ON public.manuals TO anon, authenticated, service_role;
GRANT SELECT ON public.manual_search_index TO anon, authenticated, service_role;
\\i ${join(here, '../supabase/migrations/20261011_000911_manuals_published.sql').replace(/\\/g, '/')}
-- If a later policy lets authenticated update rows, the guard still refuses published.
CREATE POLICY manuals_proof_update ON public.manuals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
GRANT UPDATE (published) ON public.manuals TO authenticated;
SET ROLE authenticated;
DO $$
BEGIN
  UPDATE public.manuals SET published = false WHERE id = 1;
  RAISE EXCEPTION 'authenticated update of published should have failed';
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
END $$;
RESET ROLE;
UPDATE public.manuals SET published = false WHERE id = 2;
SET ROLE service_role;
UPDATE public.manuals SET published = true WHERE id = 2;
UPDATE public.manuals SET published = false WHERE id = 2;
RESET ROLE;
SET ROLE authenticated;
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.manuals;
  IF n <> 1 THEN
    RAISE EXCEPTION 'authenticated saw % manuals, expected 1', n;
  END IF;
  SELECT count(*) INTO n FROM public.search_manual_catalog('laser');
  IF n <> 1 THEN
    RAISE EXCEPTION 'search returned % rows, expected 1', n;
  END IF;
END $$;
RESET ROLE;
\\i ${join(here, '../supabase/migrations/20261011_000911_manuals_published_rollback.sql').replace(/\\/g, '/')}
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manuals' AND column_name = 'published'
  ) THEN
    RAISE EXCEPTION 'published column survived rollback';
  END IF;
END $$;
`;
  const run = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-d', 'manuals_published_proof', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
    { input: proof, encoding: 'utf8' },
  );
  const cleanup = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS manuals_published_proof;'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, `${run.stderr || ''}\n${run.stdout || ''}`);
  assert.equal(cleanup.status, 0, cleanup.stderr || cleanup.stdout);
});
