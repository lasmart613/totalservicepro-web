import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from '@supabase/supabase-js';
import { catalogPayload, clampPage, clampPageSize, godContainsSearchTerm, listGodRows, sanitizeAuthUser } from './god-crud.ts';
import { getGodTable } from './god-tables.ts';

test('catalog lists featured tables and omitted secrets', () => {
  const cat = catalogPayload();
  assert.ok(cat.tables.some((t) => t.key === 'equipment' && t.featured));
  assert.ok(cat.tables.some((t) => t.key === 'user_profiles' && t.featured));
  assert.ok(cat.tables.some((t) => t.key === 'auth_users' && t.virtual && t.featured));
  assert.ok(cat.omitted.some((t) => /password hash/i.test(t.reason)));
  assert.equal(
    cat.tables.find((t) => t.key === 'god_email_sends')?.canUpdate,
    false
  );
});

test('page clamps stay sane', () => {
  assert.equal(clampPage(0), 1);
  assert.equal(clampPage('3'), 3);
  assert.equal(clampPageSize(999), 200);
  assert.equal(clampPageSize(-1), 1);
});

test('Auth users drop hashes, tokens, and raw identity secrets', () => {
  const user = {
    id: 'u-1',
    email: 'pat@clinic.test',
    phone: null,
    created_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: '2026-02-01T00:00:00Z',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', provider_token: 'NOPE' },
    user_metadata: { first_name: 'Pat', recovery_token: 'NOPE' },
    identities: [
      {
        id: 'i1',
        identity_id: 'iid',
        provider: 'email',
        identity_data: { email: 'pat@clinic.test', email_verified: true, sub: 'x' },
        created_at: '2026-01-01T00:00:00Z',
        last_sign_in_at: '2026-02-01T00:00:00Z',
      },
    ],
  } as unknown as User;
  const row = sanitizeAuthUser(user);
  assert.equal(row.email, 'pat@clinic.test');
  assert.deepEqual(row.providers, ['email']);
  assert.equal((row.app_metadata as { provider?: string }).provider, 'email');
  assert.equal('provider_token' in (row.app_metadata as object), false);
  assert.equal('recovery_token' in (row.user_metadata as object), false);
  assert.equal((row.identities as Array<{ email?: string }>)[0].email, 'pat@clinic.test');
  assert.equal('identity_data' in (row.identities as object[])[0], false);
  assert.equal('encrypted_password' in row, false);
});

test('god table contains-search strips star, percent, and underscore', async () => {
  assert.equal(godContainsSearchTerm('a*b%c_d'), 'a b c d');
  assert.equal(godContainsSearchTerm('  GentleMax  '), 'GentleMax');
  assert.equal(godContainsSearchTerm('***'), '');
  const table = getGodTable('organizations');
  assert.ok(table);
  const seen: string[] = [];
  const admin = {
    from() {
      const query: any = {
        select() {
          return query;
        },
        or(value: string) {
          seen.push(value);
          return query;
        },
        order() {
          return query;
        },
        range: async () => ({ data: [], error: null, count: 0 }),
      };
      return query;
    },
  };
  await listGodRows(admin as never, table!, { q: 'a*b%c_d' });
  assert.equal(seen.length, 1);
  assert.doesNotMatch(seen[0], /[*_]/);
  assert.match(seen[0], /name\.ilike\.%a b c d%/);
  assert.equal((seen[0].match(/%/g) || []).length, table!.searchColumns.length * 2);
});
