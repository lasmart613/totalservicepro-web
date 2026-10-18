/** Static pins for the 000922 routes: caller-session RPC, service role only for notices. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '../app/api/service-history/requests');
const create = readFileSync(join(app, 'route.ts'), 'utf8');
const respond = readFileSync(join(app, '[id]/respond/route.ts'), 'utf8');

test('routes run the RPC as the signed-in caller, never as service role', () => {
  for (const [src, rpc] of [[create, 'request_service_history_access'], [respond, 'respond_to_service_history_request']] as const) {
    assert.match(src, /userFromRequest\(req\.headers\.get\('authorization'\)\)/);
    assert.match(src, new RegExp(`auth\\.user\\.client\\.rpc\\('${rpc}'`));
    assert.doesNotMatch(src, new RegExp(`getSupabaseAdmin\\(\\)[^;]*\\.rpc\\('${rpc}'`));
  }
});

test('create route notifies only for a newly created request; respond only for approved/denied', () => {
  assert.match(create, /if \(result\.created && result\.requestId && hasServiceRole\(\)\)/);
  assert.match(respond, /if \(\(status === 'approved' \|\| status === 'denied'\) && hasServiceRole\(\)\)/);
});

test('Next 16 params are awaited', () => {
  assert.match(respond, /ctx: \{ params: Promise<\{ id: string \}> \}/);
  assert.match(respond, /const raw = await ctx\.params;/);
});

test('missing RPC maps to 503, never 500 (QA #314 I-1)', async () => {
  const { rpcErrorBody, statusForKind } = await import('./history-request-route.ts');
  assert.equal(statusForKind('unavailable'), 503);
  const r = rpcErrorBody({ code: 'PGRST202', message: 'Could not find the function public.request_service_history_access' });
  assert.equal(r.status, 503);
  assert.equal(r.body.kind, 'unavailable');
  assert.equal(rpcErrorBody({ code: '42883', message: 'function x does not exist' }).status, 503);
});
