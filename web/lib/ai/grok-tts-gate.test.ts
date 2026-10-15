/**
 * grok-tts uses the same Repair AI caller gate as grok-assistant
 * (supabase/functions/_shared/repair-ai.ts). Service-company members pass;
 * clinics/owners, suppliers, no-org callers and stale profile orgs get 403
 * repair_ai_forbidden before any usage read or xAI call.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAiCaller, repairAiDecision, canAccessRepairAi } from '../../../supabase/functions/_shared/repair-ai.ts';
import * as assistantAccess from '../../../supabase/functions/grok-assistant/ai-access.ts';
import { canAccessRepairAi as webCanAccessRepairAi } from '../roles.ts';

const here = dirname(fileURLToPath(import.meta.url));
const tts = readFileSync(join(here, '../../../supabase/functions/grok-tts/index.ts'), 'utf8');

type Rows = Record<string, Array<Record<string, unknown>>>;
function fakeDb(rows: Rows) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const result = () => (rows[table] || []).filter((r) => filters.every(([k, v]) => String(r[k]) === String(v)));
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        limit: async () => ({ data: result(), error: null }),
        maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      };
      return q;
    },
  };
}

const db = fakeDb({
  user_profiles: [
    { id: 'tech', organization_id: 10 },
    { id: 'clinic', organization_id: 20 },
    { id: 'supplier', organization_id: 30 },
    { id: 'noorg', organization_id: null },
    { id: 'removed', organization_id: 10 },
  ],
  organization_memberships: [
    { user_id: 'tech', organization_id: 10, role: 'fse' },
    { user_id: 'clinic', organization_id: 20, role: 'owner' },
    { user_id: 'supplier', organization_id: 30, role: 'parts_supplier' },
  ],
  organizations: [
    { id: 10, type: 'service_company' },
    { id: 20, type: 'laser_clinic' },
    { id: 30, type: 'parts_supplier' },
  ],
});

test('grok-tts gate: service-company member allowed; clinic, supplier, no org, removed member denied', async () => {
  assert.deepEqual(repairAiDecision(await loadAiCaller(db, 'tech')), { ok: true });
  for (const uid of ['clinic', 'supplier', 'noorg', 'removed']) {
    const d = repairAiDecision(await loadAiCaller(db, uid));
    assert.equal(d.ok, false, uid);
    if (!d.ok) {
      assert.equal(d.status, 403);
      assert.equal(d.error, 'repair_ai_forbidden');
    }
  }
});

test('one shared rule: grok-assistant re-exports it and it matches web/lib/roles.ts', () => {
  assert.equal(assistantAccess.canAccessRepairAi, canAccessRepairAi);
  assert.equal(assistantAccess.repairAiDecision, repairAiDecision);
  assert.equal(assistantAccess.loadAiCaller, loadAiCaller);
  const roles = ['admin', 'company_admin', 'service_manager', 'fse', 'engineer', 'dispatcher', 'owner', 'customer', 'parts_supplier', 'crm', '', null];
  const types = ['service_company', 'service', 'customer', 'laser_clinic', 'parts_supplier', 'vendor', '', null];
  for (const r of roles) for (const t of types) assert.equal(canAccessRepairAi(r, t), webCanAccessRepairAi(r, t), `${r}/${t}`);
});

test('grok-tts source: gate runs right after sign-in, before usage reads and xAI calls', () => {
  const auth = tts.indexOf('await supabaseAuth.auth.getUser()');
  const gate = tts.indexOf('const gate = repairAiDecision(await loadAiCaller(db, uid))');
  assert.ok(auth > 0 && gate > auth);
  assert.ok(gate < tts.indexOf("if (req.method === 'GET')"), 'voice list is gated too');
  assert.ok(gate < tts.indexOf('await countUsage('), 'before per-minute and daily cap reads');
  assert.ok(gate < tts.indexOf('XAI_TTS_URL,') || tts.indexOf('XAI_TTS_URL,') < 0);
  assert.match(tts, /if \(!gate\.ok\) return json\(gate\.status, \{ error: gate\.error, message: gate\.message \}\)/);
  assert.match(tts, /from '\.\.\/_shared\/repair-ai\.ts'/);
});
