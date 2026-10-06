import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PART_PHOTO_MAX_FILES,
  PART_PHOTO_ORG_HOUR_MAX,
  PART_PHOTO_USER_HOUR_MAX,
  PART_PHOTO_USER_STORED_MAX,
  partPhotoQuotaAllows,
  partPhotoStoredAllows,
  recordPartPhotoQuota,
  type PartPhotoQuotaState,
} from './part-photo-upload.ts';

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

function clientRpcCalls(fn: string): string[] {
  const roots = [
    join(here, '../app'),
    join(here, '../components'),
    join(here, '../lib'),
    join(here, '../../app/src/main/assets'),
  ];
  const hits: string[] = [];
  const needle = new RegExp(`\\.rpc\\(\\s*['"\`]${fn}['"\`]`);
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue;
      const path = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(path);
        continue;
      }
      if (ent.name.endsWith('.test.ts') || !/\.(ts|tsx|js|mjs|html)$/.test(ent.name)) continue;
      if (needle.test(readFileSync(path, 'utf8'))) hits.push(path);
    }
  };
  for (const root of roots) walk(root);
  return hits;
}

test('round-2 migration covers the review nits and attribution guard', () => {
  const sql = read('../supabase/migrations/20261006_000800_round2_review_nits.sql');
  assert.match(sql, /existing\.service_organization_id IS DISTINCT FROM p_service/);
  assert.match(sql, /caller_is_part_creator_admin\(created_by\)/);
  assert.match(sql, /caller_is_part_creator_admin\(p\.created_by\)/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.profile_org_change_allowed\(p_org bigint\)/);
  assert.match(sql, /profile_org_change_allowed\(new_row\.organization_id\)/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.profile_org_change_allowed\(uuid, bigint\)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.profile_org_change_allowed\(bigint\) TO authenticated, service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.profile_org_change_allowed\(bigint\) FROM PUBLIC, anon/);
  assert.match(sql, /REVOKE INSERT ON TABLE public\.product_issue_reports FROM anon/);
  assert.match(sql, /DROP POLICY IF EXISTS product_issue_reports_insert_anon/);
  assert.match(sql, /DROP POLICY IF EXISTS "read laser_models"/);
  assert.match(sql, /CREATE POLICY laser_models_read/);
  assert.match(sql, /engineer_id cannot name another user/);
  assert.match(sql, /performed_by cannot name another user/);
  assert.match(sql, /lower\(btrim\(m\.role\)\) = 'company_admin'/);
  assert.match(sql, /REVOKE UPDATE ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /'labor_log'/);
  assert.match(sql, /'inventory_transactions'/);
  assert.doesNotMatch(read('../lib/pending-signup.ts'), /insertOrganizationForPending/);
  assert.match(read('../app/api/product-issues/route.ts'), /getSupabaseAdmin\(\)/);
  assert.doesNotMatch(read('../components/ReportIssueControl.tsx'), /from\('product_issue_reports'\)/);
  const lockdown = read('../supabase/migrations/20261006_000400_user_profiles_tenant_lockdown.sql');
  assert.doesNotMatch(lockdown, /DROP TRIGGER IF EXISTS on_auth_user_created ON auth\.users/);
  const hotfix = read(
    '../supabase/migrations/20261006030456_hotfix_user_profiles_guard_identity_20261005.sql'
  );
  assert.match(hotfix, /20261006030456/);
  assert.match(hotfix, /hotfix_user_profiles_guard_identity_20261005/);
  assert.match(hotfix, /Filename version 20261006030456/);
  assert.doesNotMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.accept_team_invite\(bigint, bigint\) TO (?!service_role\b)/
  );
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.accept_team_invite\(bigint, bigint\) FROM PUBLIC, anon, authenticated/
  );
  const revoke = read(
    '../supabase/migrations/20261006044306_revoke_accept_team_invite_client_20261006_000801.sql'
  );
  assert.match(revoke, /Filename version 20261006044306/);
  assert.match(revoke, /revoke_accept_team_invite_client_20261006_000801/);
  assert.match(
    revoke,
    /REVOKE EXECUTE ON FUNCTION public\.accept_team_invite\(bigint, bigint\) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public\.accept_team_invite\(bigint, bigint\) TO service_role;/
  );
  assert.equal(clientRpcCalls('accept_team_invite').length, 0);
});

test('part photo quota limits each request, each user, and each org', () => {
  const state: PartPhotoQuotaState = { userHits: new Map(), orgHits: new Map() };
  const now = 1_000_000;
  assert.equal(partPhotoQuotaAllows(state, { userId: 'u', organizationId: 4, files: 0, now }).ok, false);
  assert.equal(
    partPhotoQuotaAllows(state, { userId: 'u', organizationId: 4, files: PART_PHOTO_MAX_FILES + 1, now }).ok,
    false
  );
  assert.equal(partPhotoStoredAllows(PART_PHOTO_USER_STORED_MAX, 1).ok, false);
  assert.equal(partPhotoStoredAllows(PART_PHOTO_USER_STORED_MAX - 1, 1).ok, true);

  recordPartPhotoQuota(state, { userId: 'u', organizationId: 4, files: PART_PHOTO_USER_HOUR_MAX, now });
  const userBlocked = partPhotoQuotaAllows(state, { userId: 'u', organizationId: 9, files: 1, now });
  assert.equal(userBlocked.ok, false);

  const otherOrg = partPhotoQuotaAllows(state, { userId: 'other', organizationId: 4, files: 1, now });
  assert.equal(otherOrg.ok, true);
  recordPartPhotoQuota(state, {
    userId: 'crew',
    organizationId: 8,
    files: PART_PHOTO_ORG_HOUR_MAX,
    now,
  });
  const orgBlocked = partPhotoQuotaAllows(state, { userId: 'fresh', organizationId: 8, files: 1, now });
  assert.equal(orgBlocked.ok, false);
  const noOrg = partPhotoQuotaAllows(state, { userId: 'fresh', organizationId: null, files: 1, now });
  assert.equal(noOrg.ok, true);

  const route = read('../app/api/parts/photos/route.ts');
  assert.match(route, /partPhotoQuotaAllows/);
  assert.match(route, /partPhotoStoredAllows/);
  assert.match(route, /recordPartPhotoQuota/);
  assert.match(route, /organization_id/);
  assert.match(route, /status: 429/);
});
