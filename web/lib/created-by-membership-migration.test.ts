/**
 * Shape pins for 20261011_000916_created_by_requires_membership.sql. Behavior is
 * proven on local Postgres by web/supabase/tests/20261011_created_by_requires_membership.sql.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../supabase/migrations');
const up = readFileSync(join(dir, '20261011_000916_created_by_requires_membership.sql'), 'utf8');
const down = readFileSync(join(dir, '20261011_000916_created_by_requires_membership_rollback.sql'), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('migration starts with lock_timeout and every function has an empty search_path', () => {
  assert.match(code(up).trim(), /^SET LOCAL lock_timeout = '5s';/);
  const fns = code(up).match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g) || [];
  assert.equal(fns.length, 6);
  for (const fn of fns) assert.match(fn, /SET search_path = ''/, fn.slice(0, 80));
  assert.doesNotMatch(code(up), /pg_catalog\.(extract|coalesce)/i);
});

test('created_by never grants org access on its own any more', () => {
  const body = code(up);
  // Only the guarded helper compares created_by to the caller.
  assert.equal((body.match(/(^|[^\w])(o\.)?created_by = auth\.uid\(\)/g) || []).length, 1, 'only membership_insert_allowed (with org_unclaimed_new)');
  assert.match(body, /o\.created_by = auth\.uid\(\)\s+AND public\.org_unclaimed_new\(o\.id, o\.created_at\)/);
  assert.match(body, /p_created_by = auth\.uid\(\)\s+AND \(\s+public\.is_active_org_member\(p_org\)/);
  for (const policy of ['organizations_member_select', '"Users can update their own organizations"', '"Users can delete their own organizations"']) {
    assert.match(body, new RegExp(`ALTER POLICY ${policy.replace(/"/g, '"')} ON public\\.organizations\\s+USING \\([^;]*org_creator_access\\(id, created_by, created_at\\)`));
  }
  for (const fn of ['user_owns_or_created_org', 'profile_org_change_allowed', 'logo_object_readable']) {
    const start = body.indexOf(`FUNCTION public.${fn}(`);
    const end = body.indexOf('$function$;', start);
    assert.match(body.slice(start, end), /public\.org_creator_access\(o\.id, o\.created_by, o\.created_at\)/, fn);
  }
});

test('rollback restores the live definitions and policies and undoes the backfill', () => {
  assert.match(code(down).trim(), /^SET LOCAL lock_timeout = '5s';/);
  assert.equal((down.match(/SET search_path TO 'public', 'pg_temp'/g) || []).length, 3);
  assert.equal((down.match(/SET search_path TO 'public'\n/g) || []).length, 1);
  assert.match(down, /USING \(public\.auth_member_of_org\(id\) OR \(created_by = auth\.uid\(\)\)\);/);
  assert.equal((down.match(/USING \(created_by = auth\.uid\(\)\);/g) || []).length, 2);
  assert.match(down, /DROP FUNCTION IF EXISTS public\.org_creator_access\(bigint, uuid, timestamptz\);/);
  assert.match(down, /DROP FUNCTION IF EXISTS public\.org_unclaimed_new\(bigint, timestamptz\);/);
  assert.match(down, /DELETE FROM public\.organization_customers WHERE notes = 'backfill 000916';/);
  assert.match(up, /'backfill 000916'/);
});
