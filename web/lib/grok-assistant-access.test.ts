/**
 * grok-assistant served manual text to any logged-in account (CEO review,
 * HIGH). The edge function now mirrors the web Repair AI gate
 * (canAccessRepairAi on the caller's profile org membership) and the
 * get-manual-url library/catalog rule, and caps usage by the org plan.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canAccessRepairAi as webCanAccessRepairAi } from './roles.ts';
import { currentOrgPlan, orgIsPaid } from './org-plan.ts';
import {
  canAccessRepairAi,
  effectiveAiTier,
  isSharedCatalogPath,
  loadAiCaller,
  loadOwnedManuals,
  manualScopeAllowed,
  orgPlanTier,
  repairAiDecision,
} from '../../supabase/functions/grok-assistant/ai-access.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../supabase/functions/grok-assistant/index.ts'), 'utf8');

const ROLES = [
  '', 'admin', 'company_admin', 'Company_Admin ', 'service_manager', 'fse', 'engineer', 'technician',
  'dispatcher', 'scheduler', 'billing_manager', 'crm', 'owner', 'customer', 'parts_supplier', 'supplier',
  'member', 'viewer', null,
];
const TYPES = [
  '', 'service_company', 'Service_Company', 'service', 'customer', 'laser_clinic', 'laser_rental',
  'laser_reseller', 'parts_supplier', 'vendor', 'supplier', 'other', null,
];

test('edge canAccessRepairAi is exactly the web helper for every role x org type', () => {
  for (const r of ROLES) {
    for (const t of TYPES) {
      assert.equal(canAccessRepairAi(r, t), webCanAccessRepairAi(r, t), `role=${r} type=${t}`);
    }
  }
});

test('org plan tier matches web currentOrgPlan / orgIsPaid', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 86400_000).toISOString();
  const future = new Date(now.getTime() + 86400_000).toISOString();
  const orgs = [
    null,
    {},
    { is_premium: true },
    { is_premium: true, premium_until: future, premium_grant: 'complimentary_signup' },
    { is_premium: true, premium_until: past, premium_grant: 'complimentary_signup' },
    { is_premium: true, premium_until: past, subscription_tier: 'premium' },
    { subscription_tier: 'team' },
    { plan: 'enterprise' },
    { plan: 'pro' },
    { subscription_tier: 'free', is_premium: false },
  ];
  for (const org of orgs) {
    const web = orgIsPaid(org) ? currentOrgPlan(org) : 'free';
    assert.equal(orgPlanTier(org), web, JSON.stringify(org));
  }
});

test('usage cap: higher of the user subscription and the org plan', () => {
  assert.equal(effectiveAiTier('free', { is_premium: true }), 'premium');
  assert.equal(effectiveAiTier('free', null), 'free');
  assert.equal(effectiveAiTier('premium', null), 'premium');
  assert.equal(effectiveAiTier('premium', { subscription_tier: 'team' }), 'team');
  assert.equal(effectiveAiTier('enterprise', { is_premium: true }), 'enterprise');
});

type Rows = Record<string, Array<Record<string, unknown>>>;
function fakeDb(rows: Rows) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const pick = () => (rows[table] || []).filter((r) => filters.every(([c, v]) => String(r[c]) === String(v)));
      const q: any = {
        select() { return q; },
        eq(c: string, v: unknown) { filters.push([c, v]); return q; },
        async maybeSingle() { return { data: pick()[0] ?? null, error: null }; },
        async limit(n: number) { return { data: pick().slice(0, n), error: null }; },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          return Promise.resolve({ data: pick(), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

const db = fakeDb({
  user_profiles: [
    { id: 'tech', organization_id: 10 },
    { id: 'owner', organization_id: 20 },
    { id: 'supplier', organization_id: 30 },
    { id: 'noorg', organization_id: null },
    { id: 'stale', organization_id: 10 },
    { id: 'shopowner', organization_id: 10 },
  ],
  organization_memberships: [
    { user_id: 'tech', organization_id: 10, role: 'fse' },
    { user_id: 'owner', organization_id: 20, role: 'owner' },
    { user_id: 'supplier', organization_id: 30, role: 'parts_supplier' },
    { user_id: 'shopowner', organization_id: 10, role: 'owner' },
  ],
  organizations: [
    { id: 10, type: 'service_company', is_premium: true },
    { id: 20, type: 'customer' },
    { id: 30, type: 'parts_supplier' },
  ],
  organization_manuals: [
    { organization_id: 10, manual_id: 501, manuals: { id: 501, storage_path: 'orgs/10/private/Board.pdf' } },
    { organization_id: 20, manual_id: 777, manuals: { id: 777, storage_path: 'orgs/20/clinic.pdf' } },
  ],
  user_manuals: [{ user_id: 'tech', manual_id: 600, manuals: { id: 600, storage_path: 'users/tech/folder' } }],
});

test('clinic owner, supplier, no-org and stale-profile callers get 403; a service-company member passes', async () => {
  for (const uid of ['owner', 'supplier', 'noorg', 'stale']) {
    const d = repairAiDecision(await loadAiCaller(db, uid));
    assert.equal(d.ok, false, uid);
    if (!d.ok) assert.equal(d.status, 403);
  }
  const tech = await loadAiCaller(db, 'tech');
  assert.deepEqual(repairAiDecision(tech), { ok: true });
  assert.equal(tech.role, 'fse');
  assert.equal(tech.orgType, 'service_company');
  assert.equal(effectiveAiTier('free', tech.org), 'premium', 'company Premium lifts the free cap');
});

test('a service company owner (membership role "owner") keeps Repair AI, same as the web rule', async () => {
  assert.deepEqual(repairAiDecision(await loadAiCaller(db, 'shopowner')), { ok: true });
  assert.equal(webCanAccessRepairAi('owner', 'service_company'), true);
  assert.equal(webCanAccessRepairAi('owner', 'laser_clinic'), false);
  assert.equal(webCanAccessRepairAi('owner', 'parts_supplier'), false);
});

test('manual scope: own library by id or covering path, or shared catalog; nothing else', async () => {
  const owned = await loadOwnedManuals(db, 'tech', 10);
  assert.deepEqual(owned.map((o) => o.id).sort(), ['501', '600']);
  assert.ok(manualScopeAllowed({ manualId: 501, storagePath: 'orgs/10/private/Board.pdf', owned }));
  assert.ok(manualScopeAllowed({ manualId: 9999, storagePath: 'users/tech/folder/ch2.pdf', owned }));
  assert.ok(manualScopeAllowed({ manualId: 1086, storagePath: 'shared/Candela/GentleMAX Pro/SM.pdf', owned }));
  assert.equal(manualScopeAllowed({ manualId: 777, storagePath: 'orgs/20/clinic.pdf', owned }), false, 'another org private upload');
  assert.equal(manualScopeAllowed({ manualId: 777, storagePath: '', owned }), false);
  assert.equal(isSharedCatalogPath('shared/../orgs/20/clinic.pdf'), false);
  assert.equal(isSharedCatalogPath('/Shared/x.pdf'), true);
});

test('index.ts: gate runs right after auth, before subscriptions, manuals, index or PDFs', () => {
  const auth = src.indexOf('await supabaseAuth.auth.getUser()');
  const gate = src.indexOf('const gate = repairAiDecision(aiCaller)');
  const sub = src.indexOf(".from('subscriptions')");
  const firstManual = src.indexOf('await selectManualRows(db', auth);
  assert.ok(auth > 0 && gate > auth && gate < sub && gate < firstManual);
  assert.match(src.slice(gate - 300, gate), /if \(body\?\.action !== 'attach-collection'\) \{/);
  assert.match(src, /const effectiveTier = effectiveAiTier\(userTier, aiCaller\?\.org \?\? null\)/);
});

test('index.ts: manual scope check precedes PDF attach paths and the indexed text read', () => {
  const chat = src.slice(src.indexOf("if (body.action === 'chat') {"));
  const scope = chat.indexOf('const scope = requestedManualDecision(');
  const attach = chat.indexOf('await pdfPathsForChat(db, manualMeta)');
  const index = chat.indexOf('searchIndexedManualText(db, manualMeta.id');
  const citation = chat.indexOf('await citationScopeForChat(db');
  assert.ok(scope > 0 && scope < attach && scope < index && scope < citation);
  assert.match(
    chat.slice(scope - 400, scope),
    /if \(manualMeta \|\| hideUnpublished \|\| normalizeManualPath\(rawPath\)\) \{\s+const owned = await loadOwnedManuals\(db, uid, aiCaller\?\.orgId \?\? null\)/
  );
});
