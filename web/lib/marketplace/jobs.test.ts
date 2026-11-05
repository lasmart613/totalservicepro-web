import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JOB_ERRORS,
  JOB_PRIVATE_COLUMNS,
  JOB_PUBLIC_COLUMNS,
  JOB_PUBLIC_SELECT,
  buildJobInsert,
  buildJobUpdate,
  canManageJob,
  filterJobs,
  jobPrefillFromSources,
} from './jobs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '../..');
const read = (rel: string) => readFileSync(join(web, rel), 'utf8');
const migration = read('supabase/migrations/20261105_000954_marketplace_jobs.sql');
const rollback = read('supabase/migrations/20261105_000954_marketplace_jobs_rollback.sql');

const qaActor = { userId: 'user-1', orgId: 2655, membershipOrgIds: [2655] };

test('public job select names only public columns', () => {
  const cols = JOB_PUBLIC_SELECT.split(',').map((col) => col.trim());
  assert.deepEqual(cols, [...JOB_PUBLIC_COLUMNS]);
  for (const privateCol of JOB_PRIVATE_COLUMNS) assert.equal(cols.includes(privateCol), false, privateCol);
  assert.equal(cols.includes('*'), false);
});

test('000954 migration locks contact columns, requires org membership, and stays free', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.marketplace_jobs/);
  assert.match(migration, /job_type IN \('full_time', 'part_time', 'contract', 'subcontract'\)/);
  assert.match(migration, /side IN \('hiring', 'looking'\)/);
  assert.match(migration, /status IN \('open', 'filled', 'closed'\)/);
  assert.match(migration, /side <> 'hiring' OR organization_id IS NOT NULL/);
  assert.match(migration, /public\.is_active_org_member\(organization_id\)/);
  assert.match(migration, /REVOKE SELECT \(contact_email, contact_phone\)/);
  assert.match(migration, /GRANT INSERT, UPDATE ON TABLE public\.marketplace_jobs TO authenticated/);
  assert.doesNotMatch(migration, /GRANT DELETE|FOR DELETE/);
  assert.match(migration, /marketplace_job_contact\(uuid\)/);
  assert.doesNotMatch(migration, /marketplace_listings|stripe_|is_premium|premium_until/);
  const grant = migration.slice(migration.indexOf('GRANT SELECT ('), migration.indexOf(') ON public.marketplace_jobs'));
  for (const col of JOB_PUBLIC_COLUMNS) assert.match(grant, new RegExp(`\\b${col}\\b`));
  for (const col of JOB_PRIVATE_COLUMNS) assert.doesNotMatch(grant, new RegExp(`\\b${col}\\b`));

  assert.match(rollback, /DROP TABLE IF EXISTS public\.marketplace_jobs/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.marketplace_job_contact\(uuid\)/);
  assert.doesNotMatch(rollback, /marketplace_listings|stripe_|is_premium|premium_until/);
});

test('hiring needs the caller org; looking can be an individual; subcontract stays a call-out', () => {
  const hiring = buildJobInsert(
    {
      side: 'hiring',
      job_type: 'subcontract',
      title: 'Laser repair call-out',
      description: 'One weekend in another state.',
      equipment: 'GentleMax',
      modality: 'Alexandrite',
      compensation: '   ',
      service_area: 'Texas',
      city: 'Dallas',
      state: 'tx',
    },
    qaActor,
  );
  assert.equal(hiring.ok, true);
  if (!hiring.ok) return;
  assert.equal(hiring.row.organization_id, 2655);
  assert.equal(hiring.row.status, 'open');
  assert.equal(hiring.row.compensation, null);
  assert.equal(hiring.row.equipment, 'GentleMax');
  assert.equal(hiring.row.modality, 'Alexandrite');
  assert.equal(hiring.row.state, 'TX');
  assert.equal(hiring.row.created_by, 'user-1');
  assert.equal('stripe_price_id' in hiring.row, false);

  const stranger = buildJobInsert(
    { side: 'hiring', job_type: 'full_time', title: 'Bench tech', description: 'Shop role.', organization_id: 424242 },
    qaActor,
  );
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.error, JOB_ERRORS.wrongOrg);

  const noOrg = buildJobInsert(
    { side: 'hiring', job_type: 'full_time', title: 'Bench tech', description: 'Shop role.' },
    { userId: 'user-2' },
  );
  assert.equal(noOrg.ok, false);
  if (!noOrg.ok) assert.equal(noOrg.error, JOB_ERRORS.hiringOrg);

  const looking = buildJobInsert(
    { side: 'looking', job_type: 'part_time', title: 'Biomed tech', description: 'Available weekdays.' },
    { userId: 'user-2' },
  );
  assert.equal(looking.ok, true);
  if (looking.ok) assert.equal(looking.row.organization_id, null);

  const closedOnCreate = buildJobInsert(
    { side: 'looking', job_type: 'contract', title: 'Field engineer', description: 'Travel ok.', status: 'closed' },
    { userId: 'user-2' },
  );
  assert.equal(closedOnCreate.ok, true);
  if (closedOnCreate.ok) assert.equal(closedOnCreate.row.status, 'open');
});

test('status changes do not wipe contact or reassign the author', () => {
  const existing = {
    id: 'job-1',
    created_by: 'user-1',
    organization_id: null,
    side: 'looking',
    job_type: 'contract',
    title: 'Field engineer',
    description: 'Weekends.',
    status: 'open',
  };
  const updated = buildJobUpdate(existing, { status: 'closed' }, { userId: 'user-1' });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.row.status, 'closed');
  assert.equal('contact_email' in updated.row, false);
  assert.equal('contact_phone' in updated.row, false);
  assert.equal('created_by' in updated.row, false);

  const stranger = buildJobUpdate(existing, { status: 'filled' }, { userId: 'other', orgId: 2655, membershipOrgIds: [2655] });
  assert.equal(stranger.ok, false);

  const teammate = buildJobUpdate(
    { ...existing, side: 'hiring', organization_id: 2655 },
    { title: 'Updated call-out title' },
    { userId: 'user-9', orgId: 2655, membershipOrgIds: [2655] },
  );
  assert.equal(teammate.ok, true);
  assert.equal(canManageJob({ created_by: 'user-1', organization_id: 2655 }, qaActor), true);
  assert.equal(canManageJob({ created_by: 'user-1', organization_id: null }, { userId: 'user-9', membershipOrgIds: [2655] }), false);
});

test('filters and profile prefill', () => {
  const rows = [
    { title: 'Laser call-out', description: 'Austin', side: 'hiring', job_type: 'subcontract', status: 'open', remote: false, city: 'Austin', equipment: 'GentleMax' },
    { title: 'Dispatcher', description: 'Remote desk', side: 'looking', job_type: 'part_time', status: 'open', remote: true, city: 'Denver' },
    { title: 'Filled bench role', description: 'Taken', side: 'hiring', job_type: 'full_time', status: 'filled', remote: false },
    { title: 'Closed role', description: 'Old', side: 'hiring', job_type: 'contract', status: 'closed', remote: false },
  ];
  assert.deepEqual(filterJobs(rows, { job_type: 'subcontract' }).map((row) => row.title), ['Laser call-out']);
  assert.deepEqual(filterJobs(rows, { remote: 'remote' }).map((row) => row.title), ['Dispatcher']);
  assert.equal(filterJobs(rows, {}).some((row) => row.status === 'filled' || row.status === 'closed'), false);
  assert.equal(filterJobs(rows, { showFilled: true }).some((row) => row.status === 'filled'), true);
  assert.equal(filterJobs(rows, { query: 'gentlemax' }).length, 1);

  const prefill = jobPrefillFromSources({
    profile: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', phone: '555-0100', organization_id: 2655 },
    org: { id: 2655, name: 'QA Shop', address: '1 Main', city: 'Austin', state: 'tx', phone: '555-0199', email: 'shop@example.com', contact_name: 'Front desk' },
  });
  assert.equal(prefill.contact_name, 'Ada Lovelace');
  assert.equal(prefill.contact_email, 'ada@example.com');
  assert.equal(prefill.contact_phone, '555-0100');
  assert.equal(prefill.city, 'Austin');
  assert.equal(prefill.state, 'TX');
  assert.equal(prefill.location, '1 Main, Austin, TX');
  assert.equal(prefill.organization_name, 'QA Shop');
});

test('job board UI is public, free, and does not touch billing', () => {
  const page = read('app/marketplace/jobs/page.tsx');
  const labels = read('components/marketplace/job-labels.tsx');
  const createRoute = read('app/api/marketplace/jobs/route.ts');
  const patchRoute = read('app/api/marketplace/jobs/[id]/route.ts');
  assert.match(page, /<h1 className="text-3xl font-extrabold">\{t\('Job board'\)\}<\/h1>/);
  assert.match(page, /JOB_PUBLIC_SELECT/);
  assert.doesNotMatch(page, /if \(loading\) \{\s*return/);
  for (const rel of [
    'lib/marketplace/jobs.ts',
    'app/marketplace/jobs/page.tsx',
    'app/marketplace/jobs/new/page.tsx',
    'app/marketplace/jobs/mine/page.tsx',
    'app/api/marketplace/jobs/route.ts',
    'app/api/marketplace/jobs/[id]/route.ts',
  ]) {
    const source = read(rel);
    assert.doesNotMatch(source, /getSupabaseAdmin|stripe_|is_premium|from ['"]@?\/lib\/billing|from ['"].*stripe/, rel);
  }
  assert.match(createRoute, /JOB_PUBLIC_SELECT/);
  assert.match(createRoute, /marketplaceUserDb/);
  assert.match(patchRoute, /JOB_PUBLIC_SELECT/);
  assert.doesNotMatch(createRoute, /select\('\*'\)|select\("\*"\)/);
  for (const message of Object.values(JOB_ERRORS)) {
    assert.match(labels, new RegExp(`t\\('${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`), message);
  }
});
