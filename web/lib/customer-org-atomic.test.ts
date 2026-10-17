/** 000917: /company addCustomer creates the customer org and its shop link in one RPC transaction. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
const mig = readFileSync(join(here, '../supabase/migrations/20261015_000917_customer_org_atomic_founder_block.sql'), 'utf8');
const rollback = readFileSync(join(here, '../supabase/migrations/20261015_000917_customer_org_atomic_founder_block_rollback.sql'), 'utf8');
const proof = readFileSync(join(here, '../supabase/tests/20261015_customer_org_atomic_founder_block.sql'), 'utf8');

function addCustomerBody(): string {
  const start = page.indexOf('async function addCustomer()');
  return page.slice(start, page.indexOf('\n  }\n', start));
}

test('addCustomer calls create_shop_customer_org and no longer writes the two rows from the browser', () => {
  const body = addCustomerBody();
  assert.match(body, /supabase\.rpc\('create_shop_customer_org', \{/);
  assert.match(body, /p_service_org: org\.id/);
  assert.doesNotMatch(body, /from\('organizations'\)/);
  assert.doesNotMatch(body, /from\('organization_customers'\)/);
  assert.match(body, /if \(createErr\) throw createErr;/);
});

test('migration 000917: one transaction, current shop manager, failed link rolls back, founder claim narrowed', () => {
  assert.match(mig, /^SET LOCAL lock_timeout = '5s';$/m);
  assert.equal((mig.match(/SET search_path = ''/g) || []).length, 3);
  assert.match(mig, /lower\(btrim\(coalesce\(m\.role, ''\)\)\) IN \('company_admin', 'owner', 'service_manager'\)/);
  assert.match(mig, /lower\(btrim\(coalesce\(s\.type, ''\)\)\) IN \('service_company', 'service'\)/);
  const org = mig.indexOf('INSERT INTO public.organizations');
  const link = mig.indexOf('INSERT INTO public.organization_customers');
  assert.ok(org > 0 && link > org, 'org then link inside the same function body');
  assert.doesNotMatch(mig.slice(org, link), /EXCEPTION WHEN/);
  assert.match(mig, /AND public\.org_founder_claim_allowed\(o\.id\)/);
  assert.match(mig, /REVOKE ALL ON FUNCTION public\.create_shop_customer_org\([^)]*\) FROM PUBLIC, anon;/);
  assert.match(mig, /GRANT EXECUTE ON FUNCTION public\.org_founder_claim_allowed\(bigint\) TO service_role;/);
  // 000916's org_unclaimed_new / org_creator_access stay as they are.
  assert.doesNotMatch(mig, /FUNCTION public\.org_unclaimed_new/);
  assert.doesNotMatch(mig, /FUNCTION public\.org_creator_access/);
});

test('rollback restores the live membership_insert_allowed and drops the new functions', () => {
  assert.match(rollback, /^SET LOCAL lock_timeout = '5s';$/m);
  assert.match(rollback, /AND public\.org_unclaimed_new\(o\.id, o\.created_at\)/);
  assert.doesNotMatch(rollback, /org_founder_claim_allowed\(o\.id\)/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.create_shop_customer_org/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.org_founder_claim_allowed/);
});

test('local proof covers atomic create, failed-link rollback, founder claim refusal and the rollback', () => {
  for (const marker of [
    'company_admin: org % and its link created together',
    'failed link: org rolled back',
    'founder claim on shop-created unlinked customer org refused',
    'rollback: live membership_insert_allowed restored byte for byte',
  ]) {
    assert.ok(proof.includes(marker), marker);
  }
});
