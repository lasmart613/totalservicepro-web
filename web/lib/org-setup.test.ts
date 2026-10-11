import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDest, onboardingLeaveTarget } from './no-org-route.ts';
import {
  ORG_SET_UP_RPC,
  adminRoutingNeedsOrgSetupLookup,
  lookupOrgSetUp,
  type OrgSetUpClient,
} from './org-setup.ts';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '../supabase/migrations/20261011_000914_org_set_up_for_routing.sql'),
  'utf8'
);
const rollback = readFileSync(
  join(here, '../supabase/migrations/20261011_000914_org_set_up_for_routing_rollback.sql'),
  'utf8'
);

function clientReturning(result: { data: boolean | null; error: { message?: string } | null } | 'throw'): OrgSetUpClient & { calls: number } {
  const calls = { n: 0 };
  return {
    get calls() {
      return calls.n;
    },
    rpc: async (fn, args) => {
      calls.n += 1;
      assert.equal(fn, ORG_SET_UP_RPC);
      assert.equal(args.p_organization_id, 12);
      if (result === 'throw') throw new Error('network down');
      return result;
    },
  };
}

test('lookupOrgSetUp is one rpc and fails safe', async () => {
  const ready = clientReturning({ data: true, error: null });
  assert.equal(await lookupOrgSetUp(ready, 12), true);
  assert.equal(ready.calls, 1);

  const empty = clientReturning({ data: false, error: null });
  assert.equal(await lookupOrgSetUp(empty, '12'), false);

  const missing = clientReturning({ data: null, error: { message: 'function does not exist' } });
  assert.equal(await lookupOrgSetUp(missing, 12), null);

  const blown = clientReturning('throw');
  assert.equal(await lookupOrgSetUp(blown, 12), null);

  assert.equal(await lookupOrgSetUp(ready, null), null);
  assert.equal(await lookupOrgSetUp(ready, 'nope'), null);
  assert.equal(ready.calls, 1);
});

test('a lookup error keeps the unfinished admin on /onboarding', async () => {
  const profile = { organization_id: 12, role: 'company_admin', onboarding_completed: false as const };
  assert.equal(adminRoutingNeedsOrgSetupLookup(profile), true);
  const orgSetUp = await lookupOrgSetUp(clientReturning({ data: null, error: { message: 'timeout' } }), profile.organization_id);
  assert.equal(orgSetUp, null);
  assert.equal(homeDest({ profile, claim: { ok: true, claimed: false, pendingInvite: false }, orgSetUp }), '/onboarding');
  assert.equal(onboardingLeaveTarget({ profile, orgSetUp, orgType: 'service_company' }), null);
});

test('only an unfinished admin with an org asks for the set-up lookup', () => {
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: 12, role: 'company_admin', onboarding_completed: false }),
    true
  );
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: 12, role: 'service_manager', onboarding_completed: false }),
    true
  );
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: 12, role: 'billing_manager', onboarding_completed: false }),
    true
  );
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: 12, role: 'fse', onboarding_completed: false }),
    false
  );
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: 12, role: 'owner', onboarding_completed: false }),
    false
  );
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: 12, role: 'customer', onboarding_completed: false }),
    false
  );
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: 12, role: 'parts_supplier', onboarding_completed: false }),
    false
  );
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: 12, role: 'company_admin', onboarding_completed: true }),
    false
  );
  assert.equal(
    adminRoutingNeedsOrgSetupLookup({ organization_id: null, role: 'company_admin', onboarding_completed: false }),
    false
  );
});

test('the set-up migration is one read and does not flip onboarding_completed', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.organization_is_set_up_for_routing\(p_organization_id bigint\)/);
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /SET search_path = ''/);
  assert.doesNotMatch(migration, /search_path = public/);
  assert.doesNotMatch(migration, /pg_catalog\.(extract|coalesce)\b/i);
  assert.match(rollback, /20261011_000914_org_set_up_for_routing\.sql/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.organization_is_set_up_for_routing\(bigint\)/);
  assert.match(rollback, /DROP INDEX IF EXISTS public\.service_tickets_organization_id_idx/);
  assert.match(rollback, /DROP INDEX IF EXISTS public\.idx_service_reports_organization_id/);
  assert.match(migration, /public\.organization_customers/);
  assert.match(migration, /c\.service_organization_id = o\.id/);
  assert.match(migration, /public\.service_tickets/);
  assert.match(migration, /public\.service_reports/);
  assert.match(migration, /pg_catalog\.btrim\(o\.name\) <> ''/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS service_tickets_organization_id_idx/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_service_reports_organization_id/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.organization_is_set_up_for_routing\(bigint\) TO authenticated, service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.organization_is_set_up_for_routing\(bigint\) FROM PUBLIC, anon/);
  assert.doesNotMatch(migration, /\bUPDATE\b/i);
  assert.doesNotMatch(migration, /onboarding_completed/);
  assert.doesNotMatch(migration, /\bINSERT\b/i);
  assert.doesNotMatch(migration, /\bDELETE\b/i);

  const routing = readFileSync(join(here, 'no-org-route.ts'), 'utf8');
  const lookup = readFileSync(join(here, 'org-setup.ts'), 'utf8');
  assert.doesNotMatch(routing, /\.update\(/);
  assert.doesNotMatch(lookup, /\.update\(/);
  assert.doesNotMatch(lookup, /onboarding_completed\s*:/);

  const home = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  const onboarding = readFileSync(join(here, '../app/onboarding/page.tsx'), 'utf8');
  assert.match(home, /lookupOrgSetUp/);
  assert.match(home, /orgSetUp/);
  assert.match(onboarding, /lookupOrgSetUp/);
  assert.match(onboarding, /orgSetUp/);
});
