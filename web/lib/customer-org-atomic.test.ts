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

// ---- 000919: every shop customer create goes through create_shop_customer_org.

const report = readFileSync(join(here, '../app/reports/new/NewServiceReportClient.tsx'), 'utf8');
const customerForm = readFileSync(join(here, './customer-form.ts'), 'utf8');
const mig919 = readFileSync(join(here, '../supabase/migrations/20261016_000919_customer_org_claim_served_or_shop_created.sql'), 'utf8');
const rollback919 = readFileSync(join(here, '../supabase/migrations/20261016_000919_customer_org_claim_served_or_shop_created_rollback.sql'), 'utf8');
const proof919 = readFileSync(join(here, '../supabase/tests/20261016_customer_org_claim_served_or_shop_created.sql'), 'utf8');

function bodyOf(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, start);
  return src.slice(a, src.indexOf(end, a));
}

test('report form: add-customer and save-time create use the RPC, no browser insert, no ignored link failure', () => {
  const add = bodyOf(report, 'const handleAddNewCustomer = async () => {', '\n  };\n');
  const ensure = bodyOf(report, 'async function ensureCustomerOrg() {', '\n  }\n');
  for (const [name, body] of [['handleAddNewCustomer', add], ['ensureCustomerOrg', ensure]] as const) {
    assert.match(body, /createShopCustomerOrg\(supabase, \{\s*serviceOrgId: currentUserOrgId,/, name);
    assert.doesNotMatch(body, /from\('organizations'\)\.insert/, name);
    assert.doesNotMatch(body, /from\('organization_customers'\)/, name);
  }
  assert.doesNotMatch(report, /ignore link failure/);
  assert.doesNotMatch(report, /from\('organizations'\)\.insert\(/);
});

test('createLinkedCustomer and createShopCustomerOrg: one RPC, errors thrown, no two-step insert', async () => {
  const linked = bodyOf(customerForm, 'export async function createLinkedCustomer(', '\n}\n');
  assert.match(linked, /await createShopCustomerOrg\(supabase, \{/);
  assert.doesNotMatch(linked, /insertOmittingCharOverflow/);
  assert.doesNotMatch(linked, /from\('organization_customers'\)|'organization_customers',/);
  const { createShopCustomerOrg } = await import('./customer-form.ts');
  const calls: Array<[string, Record<string, unknown>]> = [];
  const ok = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { data: 812, error: null }; } };
  assert.equal(await createShopCustomerOrg(ok as never, { serviceOrgId: '4', name: '  Sunrise  ', city: ' ', state: 'AZ' }), 812);
  assert.deepEqual(calls, [['create_shop_customer_org', {
    p_service_org: 4, p_name: 'Sunrise', p_address: null, p_city: null, p_state: 'AZ', p_phone: null,
    p_laser_models: null, p_facility_type: 'Clinic',
  }]]);
  const refused = { rpc: async () => ({ data: null, error: { message: 'only a current member of this service company can add customers' } }) };
  await assert.rejects(createShopCustomerOrg(refused as never, { serviceOrgId: 4, name: 'X' }), /only a current member/);
  await assert.rejects(createShopCustomerOrg(ok as never, { serviceOrgId: null, name: 'X' }), /not loaded/);
  await assert.rejects(createShopCustomerOrg(ok as never, { serviceOrgId: 4, name: '  ' }), /name is required/);
});

test('migration 000919: rules, stamp trigger, served check, member RPC, rollback', () => {
  assert.match(mig919, /^SET LOCAL lock_timeout = '5s';$/m);
  assert.match(mig919, /000918 is reserved by PR #307/);
  assert.equal((mig919.match(/^SECURITY DEFINER$/gm) || []).length, 3);
  assert.equal((mig919.match(/^SET search_path = ''$/gm) || []).length, 3);
  assert.doesNotMatch(mig919, /(pg_catalog|public)\.(extract|coalesce)\b/i);
  assert.match(mig919, /ADD COLUMN IF NOT EXISTS creator_shop_org_id bigint;/);
  assert.match(mig919, /REVOKE INSERT \(creator_shop_org_id\), UPDATE \(creator_shop_org_id\)/);
  assert.match(mig919, /CREATE TRIGGER trg_stamp_org_creator_shop\s+BEFORE INSERT OR UPDATE ON public\.organizations/);
  assert.ok('trg_stamp_org_creator_shop' > 'trg_set_org_created_by', 'fires after created_by is filled');
  assert.match(mig919, /OR o\.creator_shop_org_id IS NOT NULL/);
  assert.match(mig919, /FROM public\.service_reports r\s+WHERE r\.customer_organization_id = o\.id/);
  assert.match(mig919, /FROM public\.service_tickets t\s+WHERE t\.customer_organization_id = o\.id/);
  const rpc = bodyOf(mig919, 'CREATE OR REPLACE FUNCTION public.create_shop_customer_org(', '$function$;');
  assert.doesNotMatch(rpc, /m\.role/);
  assert.match(rpc, /lower\(btrim\(coalesce\(s\.type, ''\)\)\) IN \('service_company', 'service'\)/);
  assert.doesNotMatch(mig919, /UPDATE public\.organizations/, 'no backfill');
  assert.match(rollback919, /^SET LOCAL lock_timeout = '5s';$/m);
  assert.match(rollback919, /IN \('company_admin', 'owner', 'service_manager'\)/);
  assert.match(rollback919, /DROP COLUMN IF EXISTS creator_shop_org_id/);
  for (const marker of [
    'before 000919: shop tech creates unlinked clinic, leaves, claims owner (the bug)',
    'leave-then-claim refused',
    'clinic self-signup: no stamp, founder owner claim still allowed',
    'unlinked but served org refused',
    'rollback: live 000917 functions restored byte for byte',
  ]) {
    assert.ok(proof919.includes(marker), marker);
  }
  assert.doesNotMatch(proof919, /\b1005\b/);
});
