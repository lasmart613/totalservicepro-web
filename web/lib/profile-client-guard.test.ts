import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAuthEmailsByUserId } from './team-profile.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');

function read(rel: string): string {
  return readFileSync(join(webRoot, rel), 'utf8');
}

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, name);
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION', start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist' || name === 'out') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walkSources(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Assignments of the org pointers inside a user_profiles update/upsert window. */
function pointerWrites(source: string): string[] {
  const hits: string[] = [];
  const re = /from\(['"]user_profiles['"]\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const window = source.slice(Math.max(0, match.index - 700), match.index + 280);
    if (!/\.(update|upsert)\(/.test(window)) continue;
    if (!/organization_id:|active_organization_id:/.test(window)) continue;
    hits.push(window);
  }
  return hits;
}

test('client identity guard rejects a diverging org write and allows an equal one', () => {
  const sql = read('supabase/migrations/20261010_000908_profile_email_auth_identity.sql');
  const guard = functionBody(sql, 'user_profiles_client_identity_guard');
  assert.match(guard, /SECURITY INVOKER/);
  assert.match(sql, /CREATE TRIGGER user_profiles_client_identity_guard\s+BEFORE INSERT OR UPDATE ON public\.user_profiles/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.doesNotMatch(sql, /CONCURRENTLY/);
  assert.doesNotMatch(sql, /\bCOMMIT\b/);

  const serviceAt = guard.indexOf("IF current_user = 'service_role' THEN");
  const serviceReturn = guard.indexOf('RETURN NEW;', serviceAt);
  const firstRaise = guard.indexOf('RAISE EXCEPTION');
  assert.ok(serviceAt >= 0 && serviceReturn > serviceAt && serviceReturn < firstRaise);

  assert.match(
    guard,
    /IF active_changed\s+AND NEW\.active_organization_id IS DISTINCT FROM NEW\.organization_id THEN\s+RAISE EXCEPTION 'active_organization_id must match organization_id'/
  );
  assert.match(
    guard,
    /IF org_changed\s+AND NEW\.active_organization_id IS NOT NULL\s+AND NEW\.active_organization_id IS DISTINCT FROM NEW\.organization_id THEN\s+RAISE EXCEPTION 'organization_id must not leave active_organization_id pointing elsewhere'/
  );
  assert.match(
    guard,
    /IF TG_OP = 'INSERT' THEN\s+IF NEW\.active_organization_id IS NOT NULL\s+AND NEW\.active_organization_id IS DISTINCT FROM NEW\.organization_id THEN\s+RAISE EXCEPTION 'active_organization_id must match organization_id'/
  );
  assert.match(guard, /RAISE EXCEPTION 'user_profiles\.email must match the auth login email'/);
  assert.match(guard, /GRANT EXECUTE ON FUNCTION public\.user_profiles_client_identity_guard\(\) TO authenticated, service_role/);

  const remove = functionBody(sql, 'remove_organization_member');
  assert.match(remove, /SELECT lower\(btrim\(u\.email\)\) INTO member_email\s+FROM auth\.users u\s+WHERE u\.id = p_user_id/);
  assert.doesNotMatch(remove, /lower\(btrim\(p\.email\)\)/);
  assert.match(remove, /active_organization_id = next_org/);
  assert.match(remove, /active_organization_id = NULL/);
});

test('rollback drops the client guard and restores the 000907 invite email source', () => {
  const sql = read('supabase/migrations/20261010_000908_profile_email_auth_identity_rollback.sql');
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.doesNotMatch(sql, /CONCURRENTLY/);
  assert.doesNotMatch(sql, /\bCOMMIT\b/);
  assert.match(sql, /DROP TRIGGER IF EXISTS user_profiles_client_identity_guard ON public\.user_profiles/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.user_profiles_client_identity_guard\(\)/);
  assert.match(sql, /DROP TRIGGER IF EXISTS sync_user_profile_email ON auth\.users/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.sync_user_profile_email_from_auth\(\)/);
  assert.doesNotMatch(sql, /CREATE TRIGGER user_profiles_client_identity_guard/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.user_profiles_client_identity_guard/);
  const remove = functionBody(sql, 'remove_organization_member');
  assert.match(
    remove,
    /SELECT p\.organization_id, p\.active_organization_id, to_jsonb\(p\), lower\(btrim\(p\.email\)\), p\.role/
  );
  assert.match(
    remove,
    /IF member_email IS NULL OR member_email = '' THEN\s+SELECT lower\(btrim\(u\.email\)\) INTO member_email/
  );
});

test('user_profiles pointer writes stay equal or on the service role', () => {
  const flagged: string[] = [];
  for (const file of walkSources(join(webRoot, 'app')).concat(walkSources(join(webRoot, 'lib')))) {
    const rel = relative(webRoot, file);
    const hits = pointerWrites(readFileSync(file, 'utf8'));
    if (hits.length) flagged.push(rel);
  }
  flagged.sort();
  assert.deepEqual(flagged, [
    'app/api/customers/claim/route.ts',
    'app/api/org/leave/route.ts',
    'lib/org-membership-server.ts',
    'lib/team-profile.ts',
  ]);

  const membership = read('lib/org-membership-server.ts');
  assert.match(
    membership,
    /organization_id: input\.organizationId,\s+active_organization_id: input\.organizationId,/
  );
  assert.match(
    membership,
    /organization_id: input\.inviteOrgId,\s+active_organization_id: input\.inviteOrgId,/
  );

  const team = read('lib/team-profile.ts');
  assert.match(team, /organization_id: input\.organizationId,\s+active_organization_id: input\.organizationId,/);

  const leave = read('app/api/org/leave/route.ts');
  const serviceLeave = leave.slice(leave.indexOf('if (hasServiceRole())'));
  assert.match(serviceLeave, /organization_id: null,\s+active_organization_id: null,/);
  assert.match(leave, /rpc\('leave_organization'/);

  const claim = read('app/api/customers/claim/route.ts');
  const readyAt = claim.indexOf('if (!serviceRoleReady())');
  const writeAt = claim.indexOf(".from('user_profiles').upsert");
  assert.ok(readyAt >= 0 && writeAt > readyAt);
  assert.match(claim, /rpc\('set_home_membership'/);
  assert.doesNotMatch(claim, /active_organization_id:/);

  const switchRoute = read('app/api/org/switch/route.ts');
  assert.match(switchRoute, /if \(hasServiceRole\(\)\)/);
  assert.match(switchRoute, /rpc\('switch_active_organization'/);
  assert.doesNotMatch(switchRoute, /active_organization_id:/);
});

test('loadAuthEmailsByUserId fails closed instead of using a profile email', async () => {
  const empty = await loadAuthEmailsByUserId({} as never, []);
  assert.ok(empty);
  assert.equal(empty.size, 0);

  const fromTable = await loadAuthEmailsByUserId(
    {
      schema: () => ({
        from: () => ({
          select: () => ({
            in: async () => ({ data: [{ id: 'u1', email: 'Person@Example.com' }], error: null }),
          }),
        }),
      }),
    },
    ['u1', 'u1', '']
  );
  assert.equal(fromTable?.get('u1'), 'person@example.com');

  const failed = await loadAuthEmailsByUserId(
    {
      schema: () => ({
        from: () => ({
          select: () => ({
            in: async () => ({ data: null, error: { message: 'unavailable' } }),
          }),
        }),
      }),
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: null }, error: { message: 'no' } }),
        },
      },
    },
    ['u1']
  );
  assert.equal(failed, null);
});
