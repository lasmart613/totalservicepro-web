import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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

test('round-2 migration covers the review nits and attribution guard', () => {
  const sql = read('../supabase/migrations/20261006_000800_round2_review_nits.sql');
  assert.match(sql, /existing\.service_organization_id IS DISTINCT FROM p_service/);
  assert.match(sql, /part_home\.is_home IS TRUE/);
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
