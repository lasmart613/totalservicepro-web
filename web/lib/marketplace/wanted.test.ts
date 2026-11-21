import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canPostWanted } from '../roles.ts';
import {
  WANTED_POSTING_IS_FREE,
  wantedApiErrorMessage,
  buildWantedContentUpdate,
  buildWantedInsert,
  buildWantedStatusPatch,
  canManageWanted,
  filterWantedPosts,
  prefillWantedFromOrg,
  resolveWantedOrgId,
  validateWantedMessage,
  validateWantedWrite,
  wantedBudgetView,
} from './wanted.ts';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '../..');

function read(rel: string) {
  return readFileSync(join(web, rel), 'utf8');
}

const sample = {
  title: '  GentleMax Pro  ',
  description: 'Looking for a working alexandrite / Nd:YAG system.',
  manufacturer: ' Candela ',
  model: 'GentleMax Pro',
  modality: 'laser',
  preferred_condition: 'refurbished',
  city: 'Austin',
  state: 'tx',
  country: 'US',
  service_area: 'Texas',
  budget_min: '15000',
  budget_max: '40000',
  currency: 'usd',
  contact_via: 'message',
  poster_name: 'QA Clinic',
  contact_name: 'Pat',
};

test('wanted posts are free and reject payment fields', () => {
  assert.equal(WANTED_POSTING_IS_FREE, true);
  const blocked = validateWantedWrite({ ...sample, stripe_price_id: 'price_123' });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error, /free/i);
  const ok = validateWantedWrite(sample);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.value.title, 'GentleMax Pro');
  assert.equal(ok.value.state, 'TX');
  assert.equal(ok.value.currency, 'USD');
  assert.equal(ok.value.budget_min, 15000);
  assert.equal(ok.value.contact_via, 'message');
  const insert = buildWantedInsert(ok.value, { userId: 'user-1', organizationId: 2655 });
  assert.equal(insert.status, 'open');
  assert.equal(insert.created_by, 'user-1');
  assert.equal(insert.organization_id, 2655);
  assert.equal('stripe_price_id' in insert, false);
  assert.equal('price' in insert, false);
  const update = buildWantedContentUpdate(ok.value);
  assert.equal('created_by' in update, false);
  assert.equal('organization_id' in update, false);
  assert.equal('status' in update, false);
});

test('wanted validation checks title, budget order, and modality', () => {
  assert.equal(validateWantedWrite({ ...sample, title: 'ab' }).ok, false);
  assert.equal(validateWantedWrite({ ...sample, description: '  ' }).ok, false);
  assert.equal(validateWantedWrite({ ...sample, modality: 'spaceship' }).ok, false);
  assert.equal(validateWantedWrite({ ...sample, budget_min: -1 }).ok, false);
  const backwards = validateWantedWrite({ ...sample, budget_min: 10, budget_max: 2 });
  assert.equal(backwards.ok, false);
  const open = validateWantedWrite({ ...sample, budget_min: '', budget_max: '' });
  assert.equal(open.ok, true);
  if (open.ok) {
    assert.equal(open.value.budget_min, null);
    assert.equal(open.value.modality, 'laser');
  }
});

test('status and messages stay on the free board', () => {
  assert.deepEqual(buildWantedStatusPatch('closed'), { status: 'closed' });
  assert.deepEqual(buildWantedStatusPatch('filled'), { status: 'filled' });
  assert.equal(validateWantedMessage({ body: '  I have a 2016 unit.  ' }).ok, true);
  assert.equal(validateWantedMessage({ body: '   ' }).ok, false);
  assert.equal(validateWantedMessage({ body: 'x'.repeat(2001) }).ok, false);
});

test('prefill uses organization location and does not copy email or phone', () => {
  const filled = prefillWantedFromOrg(
    {
      name: 'QA Clinic 2655',
      city: '',
      state: 'ca',
      country: 'US',
      contact_name: 'Pat',
      service_territories: ['Austin', 'Dallas'],
    },
    { city: 'Austin', state: 'TX' }
  );
  assert.equal(filled.poster_name, 'QA Clinic 2655');
  assert.equal(filled.city, 'Austin');
  assert.equal(filled.state, 'CA');
  assert.equal(filled.service_area, 'Austin, Dallas');
  assert.equal(filled.contact_via, 'message');
  assert.equal(filled.modality, 'laser');
  assert.equal('email' in filled, false);
  assert.equal('phone' in filled, false);
});

test('org resolution and manage rights follow membership', () => {
  assert.equal(canPostWanted('owner', 'laser_clinic'), true);
  assert.equal(canPostWanted('parts_supplier', 'parts_supplier'), true);
  assert.equal(canPostWanted('fse', 'service_company'), true);
  assert.equal(canPostWanted('', ''), false);
  assert.equal(resolveWantedOrgId(2655, { orgId: 2639, membershipOrgIds: [2639, 2655] }), 2655);
  assert.equal(resolveWantedOrgId(1005, { orgId: 2655, membershipOrgIds: [2655] }), 2655);
  assert.equal(resolveWantedOrgId(null, { orgId: null, membershipOrgIds: [] }), null);
  const post = { created_by: 'author', organization_id: 2655, title: 'Laser', description: 'Need one', modality: 'laser' as const, preferred_condition: 'any' as const, contact_via: 'message' as const, currency: 'USD', manufacturer: null, model: null, city: null, state: null, country: null, service_area: null, budget_min: null, budget_max: null, poster_name: null, contact_name: null };
  assert.equal(canManageWanted(post, { userId: 'author' }), true);
  assert.equal(canManageWanted(post, { userId: 'other', orgId: 2655, role: 'fse' }), false);
  assert.equal(canManageWanted(post, { userId: 'admin', orgId: 2655, role: 'company_admin' }), true);
  assert.equal(canManageWanted(post, { userId: 'stranger', orgId: 4, role: 'owner' }), false);
});

test('filters match modality, condition, and text', () => {
  const rows = [
    { title: 'GentleMax', description: 'alex', modality: 'laser', preferred_condition: 'used', status: 'open', state: 'TX', city: 'Austin', manufacturer: 'Candela', model: 'GMax', poster_name: 'QA', service_area: '', contact_name: '' },
    { title: 'C-arm', description: 'OEC', modality: 'c_arm', preferred_condition: 'any', status: 'filled', state: 'CA', city: 'LA', manufacturer: 'GE', model: '9900', poster_name: 'Shop', service_area: '', contact_name: '' },
  ];
  assert.equal(filterWantedPosts(rows, { modality: 'laser' }).length, 1);
  assert.equal(filterWantedPosts(rows, { query: 'oec' })[0].title, 'C-arm');
  assert.equal(filterWantedPosts(rows, { state: 'tx', condition: 'used' }).length, 1);
  assert.deepEqual(wantedBudgetView({ budget_min: 1000, budget_max: null, currency: 'USD' }).kind, 'min');
});

test('migration is free, RLS-locked, and rolls back without touching other tables', () => {
  const up = read('supabase/migrations/20261105_000953_marketplace_wanted.sql');
  const down = read('supabase/migrations/20261105_000953_marketplace_wanted_rollback.sql');
  assert.match(up, /obj_description\(to_regclass\('public\.marketplace_wanted'\), 'pg_class'\)/);
  assert.match(up, /obj_description\(to_regclass\('public\.marketplace_wanted_messages'\), 'pg_class'\)/);
  assert.doesNotMatch(up, /marketplace_wanted'::regclass/);
  assert.doesNotMatch(up, /marketplace_wanted_messages'::regclass/);
  assert.match(up, /ENABLE ROW LEVEL SECURITY/);
  assert.match(up, /is_active_org_member/);
  assert.match(up, /status IN \('open', 'filled', 'closed'\)/);
  assert.match(up, /contact_via IN \('message', 'org'\)/);
  assert.match(up, /posting and viewing are free/i);
  assert.match(up, /REVOKE ALL ON TABLE public\.marketplace_wanted FROM PUBLIC, anon, authenticated/);
  assert.match(up, /GRANT INSERT, UPDATE ON TABLE public\.marketplace_wanted TO authenticated/);
  assert.doesNotMatch(up, /GRANT DELETE ON TABLE public\.marketplace_wanted TO authenticated/);
  assert.doesNotMatch(up, /stripe|checkout|premium/i);
  assert.doesNotMatch(up, /INSERT INTO public\.marketplace_wanted/i);
  assert.match(down, /DROP TABLE IF EXISTS public\.marketplace_wanted_messages/);
  assert.match(down, /DROP TABLE IF EXISTS public\.marketplace_wanted;/);
  assert.doesNotMatch(down, /DROP TABLE IF EXISTS public\.organizations/);
  assert.doesNotMatch(down, /DROP TABLE IF EXISTS public\.marketplace_listings/);
});

test('create and edit surface a 503 when the tables are not on this database', () => {
  assert.equal(
    wantedApiErrorMessage(503, { error: 'The Wanted board is not on this database yet.', free: true }),
    'The Wanted board is not on this database yet.'
  );
  assert.equal(wantedApiErrorMessage(503, {}), 'The Wanted board is not on this database yet.');
  assert.equal(wantedApiErrorMessage(503, null), 'The Wanted board is not on this database yet.');
  assert.equal(wantedApiErrorMessage(400, { error: 'Add a title (at least 3 characters).' }), 'Add a title (at least 3 characters).');
  assert.equal(wantedApiErrorMessage(500, {}), 'That wanted post could not be saved.');
  const form = read('components/marketplace/WantedForm.tsx');
  assert.match(form, /wantedApiErrorMessage\(res\.status, json\)/);
  assert.match(form, /role="alert"/);
  assert.match(form, /toast\.error\(text\)/);
  assert.doesNotMatch(form, /stripe|checkout/);
});

test('wanted API validates writes and does not bill', () => {
  const list = read('app/api/marketplace/wanted/route.ts');
  const one = read('app/api/marketplace/wanted/[id]/route.ts');
  const messages = read('app/api/marketplace/wanted/[id]/messages/route.ts');
  assert.match(list, /validateWantedWrite/);
  assert.match(list, /buildWantedInsert/);
  assert.match(list, /free: true/);
  assert.match(one, /canManageWanted/);
  assert.match(one, /buildWantedStatusPatch/);
  assert.match(messages, /validateWantedMessage/);
  assert.doesNotMatch(`${list}\n${one}\n${messages}`, /stripe|checkout|listing-invoice/i);
  const board = read('components/marketplace/WantedBoard.tsx');
  assert.match(board, /filterWantedPosts/);
  assert.match(board, /WANTED_PUBLIC_SELECT/);
  assert.match(read('app/marketplace/page.tsx'), /\/marketplace\/wanted/);
});
