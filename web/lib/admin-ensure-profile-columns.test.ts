import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const routeRel = 'app/api/admin/ensure-profile-columns/route.ts';
const routePath = join(webRoot, routeRel);
const adminRoot = join(webRoot, 'app/api/admin');

function projectRef(): string {
  const src = readFileSync(join(here, 'supabase/client.ts'), 'utf8');
  const match = src.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  assert.ok(match?.[1], 'public supabase host is present on the browser client');
  return match[1];
}

function assertNoSchemaLeak(body: string) {
  assert.equal(body.includes(projectRef()), false);
  assert.equal(/alter\s+table/i.test(body), false);
  assert.equal(/add\s+column/i.test(body), false);
  assert.equal(/notify\s+pgrst/i.test(body), false);
  assert.equal(/sql\s+editor/i.test(body), false);
}

function listAdminRoutes(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listAdminRoutes(path));
    else if (ent.name === 'route.ts' || ent.name === 'route.js') out.push(path);
  }
  return out.sort();
}

/**
 * Missing route file: Next.js answers with 404 and this handler has no body.
 * If the file is restored it must require a session (401) and reject a
 * non-admin bearer (403) without echoing schema text.
 */
async function callEnsure(method: 'GET' | 'POST', authorization: string | null) {
  if (!existsSync(routePath)) return { status: 404, body: '' };
  const mod = await import(`../${routeRel}`);
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  const req = new NextRequest('http://localhost/api/admin/ensure-profile-columns', {
    method,
    headers,
  });
  const handler = method === 'GET' ? mod.GET : mod.POST;
  const res = await handler(req);
  return { status: res.status as number, body: await res.text() };
}

test('unauthenticated GET and POST are 404 because the route was removed', async () => {
  assert.equal(existsSync(routePath), false);
  for (const method of ['GET', 'POST'] as const) {
    const res = await callEnsure(method, null);
    assert.equal(res.status, 404);
    assertNoSchemaLeak(res.body);
  }
});

test('a non-admin GET and POST do not receive profile-column SQL', async () => {
  for (const method of ['GET', 'POST'] as const) {
    const res = await callEnsure(method, 'Bearer not-an-admin');
    // Removed route: every caller, including a signed-in non-admin, gets 404.
    // A restored handler must reject that caller with 403.
    assert.equal(res.status, existsSync(routePath) ? 403 : 404);
    assertNoSchemaLeak(res.body);
  }
});

test('nothing in the app calls ensure-profile-columns', () => {
  const skip = new Set(['node_modules', '.next', '_next', '.git', 'admin-ensure-profile-columns.test.ts']);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue;
      const path = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs|html|md|csv|json)$/.test(ent.name)) continue;
      if (readFileSync(path, 'utf8').includes('/api/admin/ensure-profile-columns')) hits.push(path);
    }
  };
  walk(webRoot);
  assert.deepEqual(hits, []);
});

test('no other /api/admin route is sessionless or returns DDL', () => {
  const routes = listAdminRoutes(adminRoot);
  const ref = projectRef();
  const sessionless: string[] = [];
  for (const route of routes) {
    const src = readFileSync(route, 'utf8');
    const gated = /requireGodCaller|isGodIdentity|isAdmin\(/.test(src);
    if (!gated) sessionless.push(route);
    assert.equal(src.includes(ref), false, route);
    assert.doesNotMatch(src, /alter\s+table/i);
    assert.doesNotMatch(src, /add\s+column/i);
    assert.doesNotMatch(src, /notify\s+pgrst/i);
  }
  assert.deepEqual(sessionless, []);
  assert.deepEqual(routes, []);
});
