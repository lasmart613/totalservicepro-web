import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existingOrgSignupTrialSkip,
  FOUNDER_ORG_COLUMNS,
  grantSignupTrialIfEligible,
  loadFounderOrg,
  markTrialOnInsert,
  SIGNUP_TRIAL_WINDOW_MS,
  type FounderOrgRow,
} from './signup-trial.ts';
import { organizationInsertFromPending } from './pending-signup.ts';
import { complimentaryPremiumExpiryFields, COMPLIMENTARY_PREMIUM_DAYS } from './complimentary-premium.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const NOW = new Date('2026-10-11T16:30:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const FOUNDER = '145a7a3a-0917-4498-8dae-224645e11a49';

type Op = { kind: 'select' | 'update'; columns?: string; patch?: Record<string, unknown>; filters: Array<[string, string, unknown]> };

/** In-memory organizations table that honors eq / is(null) on update, like PostgREST. */
function fakeAdmin(rows: Array<Record<string, unknown>>, opts: { failColumns?: RegExp } = {}) {
  const ops: Op[] = [];
  const admin = {
    from(table: string) {
      assert.equal(table, 'organizations');
      const op: Op = { kind: 'select', filters: [] };
      const match = () =>
        rows.filter((r) =>
          op.filters.every(([col, how, v]) => (how === 'eq' ? String(r[col]) === String(v) : r[col] == null))
        );
      const b: any = {
        select(columns: string) {
          if (op.kind === 'select') op.columns = columns;
          return b;
        },
        update(patch: Record<string, unknown>) {
          op.kind = 'update';
          op.patch = patch;
          return b;
        },
        eq(col: string, v: unknown) {
          op.filters.push([col, 'eq', v]);
          return b;
        },
        is(col: string, v: unknown) {
          assert.equal(v, null);
          op.filters.push([col, 'is', v]);
          return b;
        },
        maybeSingle() {
          ops.push(op);
          if (opts.failColumns && op.columns && opts.failColumns.test(op.columns)) {
            return Promise.resolve({ data: null, error: { message: 'column organizations.trial_granted_at does not exist' } });
          }
          const hit = match()[0];
          if (!hit) return Promise.resolve({ data: null, error: null });
          const cols = String(op.columns).split(',').map((c) => c.trim());
          return Promise.resolve({ data: Object.fromEntries(cols.map((c) => [c, hit[c] ?? null])), error: null });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          ops.push(op);
          const hits = match();
          for (const r of hits) Object.assign(r, op.patch);
          return Promise.resolve({ data: hits.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  };
  return { admin, ops, updates: () => ops.filter((o) => o.kind === 'update') };
}

function org(over: Partial<FounderOrgRow> = {}): Record<string, unknown> {
  return {
    id: 2651,
    type: 'service_company',
    created_by: FOUNDER,
    created_at: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    is_premium: false,
    premium_until: null,
    premium_grant: null,
    trial_granted_at: null,
    ...over,
  };
}

async function visit(row: Record<string, unknown>, opts: { failColumns?: RegExp } = {}) {
  const db = fakeAdmin([row], opts);
  const loaded = await loadFounderOrg(db.admin, row.id as number);
  assert.ok(loaded.org, 'org still loads, so the founder link still works');
  const result = await grantSignupTrialIfEligible(db.admin, {
    org: loaded.org!,
    callerId: FOUNDER,
    trialColumnRead: loaded.trialColumnRead,
    now: NOW,
  });
  return { ...result, db, row };
}

test('an expired org that visits /company does not re-grant', async () => {
  // Granted 60 days ago, then God expiry cleared the three premium fields.
  const row = org({
    created_at: new Date(NOW.getTime() - 70 * DAY).toISOString(),
    trial_granted_at: new Date(NOW.getTime() - 70 * DAY).toISOString(),
    ...complimentaryPremiumExpiryFields(),
  });
  const r = await visit(row);
  assert.equal(r.granted, false);
  assert.equal(r.skip, 'trial_used');
  assert.equal(r.db.updates().length, 0);
  assert.equal(row.is_premium, false);
});

test('a removed grant does not re-grant, even inside the 24h window', async () => {
  const row = org({ trial_granted_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() });
  const r = await visit(row);
  assert.equal(r.granted, false);
  assert.equal(r.skip, 'trial_used');
  assert.equal(r.db.updates().length, 0);
});

test('a brand-new founder org created in the request gets 60 days and trial_granted_at on the insert', () => {
  const before = Date.now();
  const row = markTrialOnInsert(
    organizationInsertFromPending(
      {
        kind: 'company',
        name: 'QA Founder',
        firstName: 'QA',
        lastName: 'Founder',
        email: 'f@shop.test',
        role: 'company_admin',
        orgType: 'service_company',
      } as any,
      FOUNDER
    )
  );
  assert.equal(row.is_premium, true);
  assert.equal(row.premium_grant, 'complimentary_signup');
  const until = Date.parse(String(row.premium_until));
  const granted = Date.parse(String(row.trial_granted_at));
  assert.ok(granted >= before - 1000 && granted <= Date.now() + 1000);
  assert.ok(Math.abs(until - granted - COMPLIMENTARY_PREMIUM_DAYS * DAY) < 5000);

  // A clinic gets no trial and no marker.
  const clinic = markTrialOnInsert(
    organizationInsertFromPending({ kind: 'owner', name: 'Clinic', role: 'owner', orgType: 'customer' } as any, FOUNDER)
  );
  assert.equal(clinic.is_premium, false);
  assert.equal('trial_granted_at' in clinic, false);
});

test('a just-created founder org (client insert, then founder link) gets 60 days in one write', async () => {
  const row = org();
  const r = await visit(row);
  assert.equal(r.granted, true);
  const [update] = r.db.updates();
  assert.deepEqual(Object.keys(update.patch!).sort(), ['is_premium', 'premium_grant', 'premium_until', 'trial_granted_at']);
  assert.equal(update.patch!.trial_granted_at, NOW.toISOString());
  assert.equal(Date.parse(String(update.patch!.premium_until)) - NOW.getTime(), COMPLIMENTARY_PREMIUM_DAYS * DAY);
  assert.deepEqual(update.filters, [
    ['id', 'eq', 2651],
    ['trial_granted_at', 'is', null],
    ['premium_grant', 'is', null],
  ]);
  // The next visit (or a concurrent one) sees the trial used.
  const again = await grantSignupTrialIfEligible(r.db.admin, { org: row as FounderOrgRow, callerId: FOUNDER, trialColumnRead: true, now: NOW });
  assert.equal(again.granted, false);
});

test('an org older than 24h with null trial_granted_at gets no grant', async () => {
  for (const age of [SIGNUP_TRIAL_WINDOW_MS + 1000, 30 * DAY, 63 * DAY]) {
    const r = await visit(org({ created_at: new Date(NOW.getTime() - age).toISOString() }));
    assert.equal(r.granted, false);
    assert.equal(r.skip, 'org_too_old');
    assert.equal(r.db.updates().length, 0);
  }
  // Missing or future created_at: no grant.
  assert.equal(existingOrgSignupTrialSkip({ org: org({ created_at: null }) as FounderOrgRow, callerId: FOUNDER, trialColumnRead: true, now: NOW }), 'org_too_old');
  assert.equal(
    existingOrgSignupTrialSkip({ org: org({ created_at: new Date(NOW.getTime() + DAY).toISOString() }) as FounderOrgRow, callerId: FOUNDER, trialColumnRead: true, now: NOW }),
    'org_too_old'
  );
});

test('trial_granted_at read error fails closed: the org still links, no grant', async () => {
  const r = await visit(org(), { failColumns: /trial_granted_at/ });
  assert.equal(r.granted, false);
  assert.equal(r.skip, 'trial_unknown');
  assert.equal(r.db.updates().length, 0);
  const reads = r.db.ops.filter((o) => o.kind === 'select').map((o) => o.columns);
  assert.equal(reads[0], FOUNDER_ORG_COLUMNS);
  assert.doesNotMatch(String(reads[1]), /trial_granted_at/);
});

test('non-creator, non-service, and prior-premium orgs never get a grant', () => {
  const base = { callerId: FOUNDER, trialColumnRead: true, now: NOW };
  assert.equal(existingOrgSignupTrialSkip({ ...base, org: org({ created_by: 'someone-else' }) as FounderOrgRow }), 'not_creator');
  assert.equal(existingOrgSignupTrialSkip({ ...base, org: org({ type: 'customer' }) as FounderOrgRow }), 'not_service_company');
  assert.equal(existingOrgSignupTrialSkip({ ...base, org: org({ is_premium: true }) as FounderOrgRow }), 'prior_premium');
  assert.equal(existingOrgSignupTrialSkip({ ...base, org: org({ premium_grant: 'complimentary_god' }) as FounderOrgRow }), 'prior_premium');
  assert.equal(existingOrgSignupTrialSkip({ ...base, org: org() as FounderOrgRow }), null);
});

test('founder route: grant only via the new helpers, after the creator check', () => {
  const route = readFileSync(join(here, '../app/api/org/founder/route.ts'), 'utf8');
  assert.match(route, /markTrialOnInsert\(organizationInsertFromPending\(pending, user\.id\)\)/);
  assert.match(route, /loadFounderOrg\(admin, orgId\)/);
  assert.ok(route.indexOf('const decision = decideFounderLink') < route.indexOf('await grantSignupTrialIfEligible(admin'));
  // No other premium write in the route.
  assert.doesNotMatch(route, /applyComplimentarySignupFields|is_premium:\s*true|\.update\(patch\)/);
  // Missing column on insert: retry without the marker (the new org gets its one trial).
  assert.match(route, /isTrialGrantedAtMissing\(error\.message\)/);
});

test('/company does not call the founder link on load; create-on-save still does', () => {
  const company = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  const load = company.slice(company.indexOf('if (prof?.organization_id)'), company.indexOf('async function loadTeamMembers'));
  assert.doesNotMatch(load, /ensureServiceCreatorLinked|postFounderOrganization/);
  const created = company.slice(company.indexOf('if (newOrgData?.id)'), company.indexOf('const saveId'));
  assert.match(created, /ensureServiceCreatorLinked\(supabase, newOrgData\.id/);
});

test('expiry and removal fields never touch trial_granted_at', () => {
  assert.deepEqual(Object.keys(complimentaryPremiumExpiryFields()).sort(), ['is_premium', 'premium_grant', 'premium_until']);
  const expire = readFileSync(join(here, '../app/api/god/premium/expire/route.ts'), 'utf8');
  assert.doesNotMatch(expire, /trial_granted_at/);
});

test('migration 000915: lock timeout first, empty search_path, guard covers trial_granted_at, rollback exists', () => {
  const sql = readFileSync(join(here, '../supabase/migrations/20261011_000915_org_trial_granted_at.sql'), 'utf8');
  const rollback = readFileSync(join(here, '../supabase/migrations/20261011_000915_org_trial_granted_at_rollback.sql'), 'utf8');
  const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
  assert.match(code(sql), /^SET LOCAL lock_timeout = '5s';/);
  assert.match(code(rollback), /^SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /SET search_path = ''/);
  assert.match(sql, /trial_granted_at cannot be set by the client/);
  assert.match(sql, /trial_granted_at cannot be changed by the client/);
  assert.match(sql, /WHERE o\.trial_granted_at IS NULL/);
  assert.match(rollback, /DROP COLUMN IF EXISTS trial_granted_at/);
});
