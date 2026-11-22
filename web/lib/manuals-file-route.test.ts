/**
 * /api/manuals/file must sign only a path the loaded catalog row covers.
 * The gate used to read the { row } wrapper, so every storage path was 403.
 * Fixture paths only — no live org manuals.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { NextRequest } from 'next/server';
import { MANUAL_PATH_NOT_COVERED } from './manual-file.ts';
import { ADD_TO_LIBRARY_TO_OPEN, MANUALS_UNAVAILABLE } from './manuals-access.ts';

const stub = `
export function createClient() {
  const build = globalThis.__manualFileClient;
  if (typeof build !== 'function') throw new Error('manual file test client is not installed');
  return build();
}
export class SupabaseClient {}
`;

const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === '@supabase/supabase-js') {
    return {
      url: 'data:text/javascript,' + ${JSON.stringify(encodeURIComponent(stub))},
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
`;

register('data:text/javascript,' + encodeURIComponent(hooks));

const COVERED = 'shared/qa/fixture/service-manual.pdf';
const FOREIGN = 'shared/qa/fixture/other-manual.pdf';
const PDF = '%PDF-1.4 manuals-file-route-test';
const SIGNED = 'https://manuals-file.test/signed.pdf';

const SERVICE_PROFILE = { role: 'fse', organizations: { type: 'service_company' } };
const SUPPLIER_PROFILE = { role: 'supplier', organizations: { type: 'parts_supplier' } };

const COVERED_ROW = {
  id: 9001,
  brand: 'QA',
  title: 'QA fixture service manual',
  model: 'QA-1',
  storage_path: COVERED,
  doc_kind: 'service',
  is_folder: false,
  entry_file_path: COVERED,
  chapter_metadata: [],
  published: true,
};

type QueryResult = { data: Record<string, unknown> | null; error: null };

function query(result: QueryResult) {
  const api = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    maybeSingle: async () => result,
  };
  return api;
}

function clientFor(profile: Record<string, unknown>, manual: Record<string, unknown> | null) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-qa' } }, error: null }),
    },
    from(table: string) {
      if (table === 'user_profiles') return query({ data: profile, error: null });
      if (table === 'manuals') return query({ data: manual, error: null });
      return query({ data: null, error: null });
    },
  };
}

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

function installTestEnv() {
  const saved = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://manuals-file.test';
  delete process.env.SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  return () => {
    for (const [key, value] of saved) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function request(body: { manual_id?: number; storage_path?: string }) {
  return new NextRequest('http://127.0.0.1/api/manuals/file', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function callFile(opts: {
  profile: Record<string, unknown>;
  manual: Record<string, unknown> | null;
  body: { manual_id?: number; storage_path?: string };
  inLibrary?: boolean;
  freeIncomplete?: boolean;
  signedPath?: string;
}) {
  const restoreEnv = installTestEnv();
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  const signedPaths: string[] = [];
  (globalThis as { __manualFileClient?: () => unknown }).__manualFileClient = () =>
    clientFor(opts.profile, opts.manual);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/functions/v1/get-manual-url')) {
      const sent = JSON.parse(String(init?.body || '{}')) as { storage_path?: string; manual_id?: number };
      signedPaths.push(String(sent.storage_path ?? ''));
      assert.equal(sent.storage_path, opts.signedPath ?? opts.body.storage_path);
      assert.equal(sent.manual_id, opts.body.manual_id);
      return new Response(
        JSON.stringify({
          url: SIGNED,
          in_library: opts.inLibrary !== false,
          ...(opts.freeIncomplete ? { free_incomplete: true } : {}),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === SIGNED) {
      return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;

  try {
    const { POST } = await import('../app/api/manuals/file/route.ts');
    const res = await POST(request(opts.body));
    return { res, calls, signedPaths };
  } finally {
    globalThis.fetch = previousFetch;
    delete (globalThis as { __manualFileClient?: unknown }).__manualFileClient;
    restoreEnv();
  }
}

test('covered path with a catalog row is served inline', async () => {
  const { res, calls } = await callFile({
    profile: SERVICE_PROFILE,
    manual: COVERED_ROW,
    body: { manual_id: 9001, storage_path: COVERED },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') || '', /^inline; filename="service-manual\.pdf"$/);
  assert.equal(await res.text(), PDF);
  assert.deepEqual(calls, ['https://manuals-file.test/functions/v1/get-manual-url', SIGNED]);
});

test('missing catalog row fails closed with 403', async () => {
  const { res, calls } = await callFile({
    profile: SERVICE_PROFILE,
    manual: null,
    body: { manual_id: 9001, storage_path: COVERED },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: MANUAL_PATH_NOT_COVERED });
  assert.deepEqual(calls, []);
});

test('a path the catalog row does not cover is 403', async () => {
  const { res, calls } = await callFile({
    profile: SERVICE_PROFILE,
    manual: COVERED_ROW,
    body: { manual_id: 9001, storage_path: FOREIGN },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: MANUAL_PATH_NOT_COVERED });
  assert.deepEqual(calls, []);
});

test('a covered path still requires the manual to be in the library', async () => {
  const { res, calls } = await callFile({
    profile: SERVICE_PROFILE,
    manual: COVERED_ROW,
    body: { manual_id: 9001, storage_path: COVERED },
    inLibrary: false,
    freeIncomplete: true,
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), {
    error: ADD_TO_LIBRARY_TO_OPEN,
    requires_add: true,
    free_incomplete: true,
  });
  assert.deepEqual(calls, ['https://manuals-file.test/functions/v1/get-manual-url']);
});

const FOLDER = 'shared/qa/fixture/12';
const CHAPTER = `${FOLDER}/ch1.pdf`;
const FOLDER_ROW = {
  id: 9002,
  brand: 'QA',
  title: 'QA fixture folder',
  model: 'QA-12',
  storage_path: FOLDER,
  doc_kind: 'service',
  is_folder: true,
  entry_file_path: CHAPTER,
  chapter_metadata: [{ storage_path: CHAPTER }],
  published: true,
};

test('traversal with ../ and %2e%2e is refused before signing', async () => {
  const paths = [
    `${FOLDER}/../13/secret.pdf`,
    `${FOLDER}/%2e%2e/%2e%2e/other/secret.pdf`,
    '../secret.pdf',
  ];
  for (const storage_path of paths) {
    const { res, calls } = await callFile({
      profile: SERVICE_PROFILE,
      manual: FOLDER_ROW,
      body: { manual_id: 9002, storage_path },
    });
    assert.equal(res.status, 403, storage_path);
    assert.deepEqual(await res.json(), { error: MANUAL_PATH_NOT_COVERED });
    assert.deepEqual(calls, []);
  }
});

test('query, fragment, and encoded-slash injection are not forwarded raw', async () => {
  for (const storage_path of [`${CHAPTER}?x=../../13`, `${CHAPTER}#section`]) {
    const { res, calls, signedPaths } = await callFile({
      profile: SERVICE_PROFILE,
      manual: FOLDER_ROW,
      body: { manual_id: 9002, storage_path },
      signedPath: CHAPTER,
    });
    assert.equal(res.status, 200, storage_path);
    assert.equal(await res.text(), PDF);
    assert.deepEqual(signedPaths, [CHAPTER]);
    assert.equal(calls.includes(SIGNED), true);
  }

  const escaped = `${FOLDER}/ch1.pdf%2f..%2f..%2f13%2fsecret.pdf`;
  const denied = await callFile({
    profile: SERVICE_PROFILE,
    manual: FOLDER_ROW,
    body: { manual_id: 9002, storage_path: escaped },
  });
  assert.equal(denied.res.status, 403);
  assert.deepEqual(await denied.res.json(), { error: MANUAL_PATH_NOT_COVERED });
  assert.deepEqual(denied.calls, []);
});

test('folder 12 covers its own child and refuses sibling 123', async () => {
  const child = `${FOLDER}/notes/extra.pdf`;
  const opened = await callFile({
    profile: SERVICE_PROFILE,
    manual: FOLDER_ROW,
    body: { manual_id: 9002, storage_path: child },
    signedPath: child,
  });
  assert.equal(opened.res.status, 200);
  assert.deepEqual(opened.signedPaths, [child]);

  const sibling = await callFile({
    profile: SERVICE_PROFILE,
    manual: FOLDER_ROW,
    body: { manual_id: 9002, storage_path: 'shared/qa/fixture/123/ch1.pdf' },
  });
  assert.equal(sibling.res.status, 403);
  assert.deepEqual(await sibling.res.json(), { error: MANUAL_PATH_NOT_COVERED });
  assert.deepEqual(sibling.calls, []);
});

test('a user who cannot open manuals is 403', async () => {
  const { res, calls } = await callFile({
    profile: SUPPLIER_PROFILE,
    manual: COVERED_ROW,
    body: { manual_id: 9001, storage_path: COVERED },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: MANUALS_UNAVAILABLE });
  assert.deepEqual(calls, []);
});
