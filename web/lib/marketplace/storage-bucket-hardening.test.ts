import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../supabase');
const forward = readFileSync(join(root, 'migrations/20261122_000974_storage_bucket_hardening.sql'), 'utf8');
const rollback = readFileSync(join(root, 'migrations/20261122_000974_storage_bucket_hardening_rollback.sql'), 'utf8');
const proof = readFileSync(join(root, 'tests/20261122_storage_bucket_hardening.sql'), 'utf8');
const proofB = readFileSync(join(root, 'tests/20261122_storage_bucket_hardening_after_000970.sql'), 'utf8');

const COMPANY_PRIOR = "ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[]";
const MARKET_PRIOR = "ARRAY['image/jpeg','image/jpg']::text[]";
const TARGET = "ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]";

test('000974 guards on live text, the 000970 text, and its own target', () => {
  const created = forward.slice(forward.indexOf('CREATE OR REPLACE FUNCTION public.storage_caller_owns_prefix'));
  assert.match(forward, /\[0\]/);
  assert.match(forward, /\[1\]/);
  assert.doesNotMatch(created, /\[0\]/);
  assert.match(created, /parts\[1\]/);
  assert.match(forward, /storage_000974_marketplace_prior/);
  assert.match(forward, /\(storage\.foldername\(object_name\)\)\[1\]/);
  assert.ok(forward.includes(COMPANY_PRIOR));
  assert.ok(forward.includes(MARKET_PRIOR));
  assert.ok(forward.includes(TARGET));
  assert.match(forward, /file_size_limit = 5242880/);
  assert.match(forward, /file_size_limit = 2097152/);
  assert.match(forward, /file_size_limit = 8388608/);
  assert.match(forward, /allowed_mime_types IS NULL/);
  assert.match(forward, /file_size_limit IS NULL/);
  assert.doesNotMatch(forward, /SET\s+public\b/);
  assert.match(forward, /marketplace_image_public_read/);
  assert.match(forward, /storage_caller_owns_prefix/);
  assert.match(forward, /000973 is/);
  assert.doesNotMatch(forward, /20261122_000973/);
  assert.match(forward, /NOT APPLIED/);
  assert.match(forward, /jsonb_array_elements/);
  assert.doesNotMatch(forward, /strpos\(blob/);
  assert.match(forward, /LOW 4, left as-is/);
  assert.match(forward, /CREATE INDEX IF NOT EXISTS marketplace_listings_created_by_idx/);
  assert.match(rollback, /DROP INDEX IF EXISTS public\.marketplace_listings_created_by_idx/);
  assert.doesNotMatch(forward, /CREATE POLICY[^;]*part-images/i);
});

test('000974 rollback restores the recorded live bucket rows and index 0 policies', () => {
  assert.match(rollback, /\[0\]/);
  assert.ok(rollback.includes(COMPANY_PRIOR));
  assert.ok(rollback.includes(MARKET_PRIOR));
  assert.match(rollback, /SET allowed_mime_types = NULL, file_size_limit = NULL/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.storage_caller_owns_prefix\(text\)/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.marketplace_image_public_read\(text\)/);
  assert.doesNotMatch(rollback, /SET\s+public\b/);
  assert.match(rollback, /equipment_photos_member_read/);
  assert.doesNotMatch(rollback, /DROP POLICY IF EXISTS equipment_photos_member_read/);
  assert.match(proof, /ROLLBACK marketplace mime is jpeg\/jpg and size NULL/);
  assert.match(proof, /2655/);
  assert.doesNotMatch(proof, /\b(153|154|1005|2616|5509|5515|5516|5517)\b/);
  assert.match(rollback, /storage_000974_marketplace_prior/);
  assert.match(proofB, /94e71a7c51d1b31e75768e25ffc6187a/);
  assert.match(proofB, /prior = 'b'/);
  assert.match(proofB, /000968 then 000970/);
  assert.doesNotMatch(proofB, /\b(153|154|1005|2616|5509|5515|5516|5517)\b/);
});
