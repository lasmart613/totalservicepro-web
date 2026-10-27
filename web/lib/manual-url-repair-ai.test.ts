/**
 * get-manual-url's AI catalog gate uses the membership-checked loadAiCaller and
 * the shared repairAiDecision (service-company owners allowed), not
 * user_profiles.role / organization_id. QA case: a removed owner whose profile
 * still says owner must not open shared PDFs. End-to-end proof:
 * supabase/tests/get-manual-url-access-harness.ts (Deno).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAiCaller, repairAiDecision } from '../../supabase/functions/_shared/repair-ai.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');

test('get-manual-url uses loadAiCaller for the org library, not a profile-role catalog grant', () => {
  assert.match(src, /import \{ loadAiCaller, repairAiDecision \} from "\.\.\/_shared\/repair-ai\.ts";/);
  assert.match(src, /await loadAiCaller\(/);
  assert.match(src, /repairAiAllowed: repairAiDecision\(caller\)\.ok/);
  assert.match(src, /orgId: caller\.member \? caller\.orgId : null/);
  assert.doesNotMatch(src, /mayViewAiCatalog\(/);
  assert.doesNotMatch(src, /function isRepairAiCaller\(/);
  assert.doesNotMatch(src, /from\("user_profiles"\)\s*\.select\("organization_id, role/);
});

type Row = Record<string, unknown>;
function fakeDb(t: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => (t[table] || []).filter((r) => filters.every(([k, v]) => String(r[k]) === String(v)));
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        limit: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      };
      return q;
    },
  };
}

const db = fakeDb({
  user_profiles: [
    { id: 'tech', organization_id: 2655, role: 'fse' },
    { id: 'owner', organization_id: 2655, role: 'owner' },
    { id: 'removed', organization_id: 2655, role: 'owner' },
    { id: 'clinic', organization_id: 2639, role: 'owner' },
  ],
  organization_memberships: [
    { user_id: 'tech', organization_id: 2655, role: 'fse' },
    { user_id: 'owner', organization_id: 2655, role: 'owner' },
    { user_id: 'clinic', organization_id: 2639, role: 'owner' },
  ],
  organizations: [
    { id: 2655, type: 'service_company' },
    { id: 2639, type: 'customer' },
  ],
});

test('membership-checked caller: removed owner refused, service members and owners allowed', async () => {
  const ok = async (u: string) => repairAiDecision(await loadAiCaller(db as any, u)).ok;
  assert.equal(await ok('tech'), true);
  assert.equal(await ok('owner'), true, 'CEO decision: service-company owners keep Repair AI');
  assert.equal(await ok('removed'), false, 'profile still says owner, no membership row');
  assert.equal(await ok('clinic'), false);
  assert.equal((await loadAiCaller(db as any, 'removed')).member, false);
});
