import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleGodCrm,
  estimateWorkStage,
  fetchGodCrmSources,
  filterCrmAccounts,
  filterCrmContacts,
  filterCrmPipeline,
  filterCrmWork,
  formatMoney,
  invoiceWorkStage,
  loadGodCrm,
  needsSchedulingTicket,
  parseCrmTab,
  personName,
  requestPipelineStage,
  ticketWorkStage,
} from './god-crm.ts';
import { GOD_CRM_PATH } from './god-tables.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('parseCrmTab defaults to pipeline', () => {
  assert.equal(parseCrmTab('accounts'), 'accounts');
  assert.equal(parseCrmTab('CONTACTS'), 'contacts');
  assert.equal(parseCrmTab('work'), 'work');
  assert.equal(parseCrmTab('nope'), 'pipeline');
  assert.equal(parseCrmTab(undefined), 'pipeline');
});

test('personName prefers first+last, then name, then email local-part', () => {
  assert.equal(personName({ first_name: 'Pat', last_name: 'Kim' }), 'Pat Kim');
  assert.equal(personName({ name: 'Alex Lee' }), 'Alex Lee');
  assert.equal(personName({ contact_name: 'Sam' }), 'Sam');
  assert.equal(personName({ email: 'owner@glow.test' }), 'owner');
  assert.equal(personName({}), '');
});

test('derived stages stay honest to live statuses', () => {
  assert.equal(requestPipelineStage('open'), 'open');
  assert.equal(requestPipelineStage('awarded'), 'awarded');
  assert.equal(requestPipelineStage('cancelled'), 'closed');
  assert.equal(estimateWorkStage('draft'), 'open');
  assert.equal(estimateWorkStage('pending'), 'open');
  assert.equal(estimateWorkStage('invoiced'), 'won');
  assert.equal(estimateWorkStage('expired'), 'lost');
  assert.equal(invoiceWorkStage('sent'), 'unpaid');
  assert.equal(invoiceWorkStage('draft'), 'unpaid');
  assert.equal(invoiceWorkStage('paid'), 'won');
  assert.equal(ticketWorkStage('Scheduled'), 'active');
  assert.equal(ticketWorkStage('Completed'), 'closed');
  assert.equal(needsSchedulingTicket('Awaiting Scheduling'), true);
  assert.equal(needsSchedulingTicket('Scheduled'), false);
});

test('assembleGodCrm composes pipeline, accounts, contacts, and work', () => {
  const payload = assembleGodCrm({
    orgs: [
      {
        id: 12,
        name: 'Glow Repair',
        type: 'service_company',
        email: 'shop@glow.test',
        phone: '555-0100',
        city: 'Austin',
        state: 'TX',
        is_premium: true,
        subscription_tier: 'premium',
        created_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 44,
        name: 'Lakeview Aesthetics',
        type: 'laser_clinic',
        email: 'pat@lakeview.test',
        city: 'Dallas',
        state: 'TX',
        plan: 'free',
        created_at: '2026-03-01T00:00:00Z',
      },
    ],
    contacts: [
      {
        id: 7,
        first_name: 'Pat',
        last_name: 'Kim',
        email: 'pat@lakeview.test',
        phone: '555-0111',
        title: 'Owner',
        is_primary: true,
        organization_id: 44,
        created_at: '2026-03-02T00:00:00Z',
      },
    ],
    requests: [
      {
        id: 'sr-1',
        title: 'Holmium fiber swap',
        status: 'open',
        manufacturer: 'Lumenis',
        model: 'Pulse 120H',
        city: 'Dallas',
        state: 'TX',
        urgency: 'Emergency',
        organization_id: 44,
        created_at: '2026-09-01T00:00:00Z',
      },
    ],
    leads: [
      {
        id: 'lead-1',
        clinic_name: 'Sunset MedSpa',
        contact_name: 'Jordan',
        email: 'jordan@sunset.test',
        location: 'Phoenix, AZ',
        urgency: 'This week',
        created_at: '2026-09-02T00:00:00Z',
      },
    ],
    waitlist: [{ id: 'w1', email: 'new@shop.test', plan: 'premium', created_at: '2026-08-01T00:00:00Z' }],
    marketplaceRequests: [],
    tickets: [
      {
        id: 9,
        ticket_number: 'GLW-100',
        status: 'Awaiting Scheduling',
        customer_name: 'Lakeview Aesthetics',
        organization_id: 12,
        customer_organization_id: 44,
        created_at: '2026-09-03T00:00:00Z',
      },
    ],
    estimates: [
      {
        id: 3,
        status: 'pending',
        customer_name: 'Lakeview Aesthetics',
        total: 2400,
        organization_id: 12,
        created_at: '2026-09-04T00:00:00Z',
      },
    ],
    invoices: [
      {
        id: 5,
        status: 'sent',
        customer_name: 'Lakeview Aesthetics',
        total: 1800,
        organization_id: 12,
        created_at: '2026-09-05T00:00:00Z',
      },
    ],
    links: [{ service_organization_id: 12, customer_organization_id: 44 }],
    listingCounts: { active: 27 },
    missingTables: [],
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.summary.organizations, 2);
  assert.equal(payload.summary.contacts, 1);
  assert.equal(payload.summary.shopClinicLinks, 1);
  assert.equal(payload.summary.openRequests, 1);
  assert.equal(payload.summary.clinicLeads, 1);
  assert.equal(payload.summary.waitlist, 1);
  assert.equal(payload.summary.openTickets, 1);
  assert.equal(payload.summary.needsScheduling, 1);
  assert.equal(payload.summary.openEstimates, 1);
  assert.equal(payload.summary.unpaidInvoices, 1);
  assert.equal(payload.summary.activeListings, 27);

  assert.equal(payload.pipeline.length, 3);
  assert.equal(payload.pipeline[0]?.source, 'clinic_lead');
  assert.equal(payload.pipeline.some((p) => p.source === 'service_request' && p.company === 'Lakeview Aesthetics'), true);
  assert.equal(payload.accounts.find((a) => a.id === 12)?.customerCount, 1);
  assert.equal(payload.accounts.find((a) => a.id === 44)?.shopCount, 1);
  assert.equal(payload.accounts.find((a) => a.id === 12)?.planLabel, 'Premium');
  assert.equal(payload.contacts[0]?.name, 'Pat Kim');
  assert.equal(payload.contacts[0]?.orgName, 'Lakeview Aesthetics');
  assert.equal(payload.work.some((w) => w.kind === 'invoice' && w.stage === 'unpaid'), true);
  assert.equal(payload.work.some((w) => w.kind === 'estimate' && w.amount === 2400), true);
  assert.match(payload.notes[0] || '', /No deals/);
});

test('missing clinic_service_leads does not invent a leads count', () => {
  const payload = assembleGodCrm({
    orgs: [],
    contacts: [],
    requests: [],
    leads: [],
    waitlist: [],
    marketplaceRequests: [],
    tickets: [],
    estimates: [],
    invoices: [],
    links: [],
    missingTables: ['clinic_service_leads'],
  });
  assert.equal(payload.summary.clinicLeads, null);
  assert.ok(payload.notes.some((n) => /clinic_service_leads is not on this Supabase project/i.test(n)));
});

test('CRM filters cover pipeline, accounts, contacts, and work', () => {
  const payload = assembleGodCrm({
    orgs: [
      { id: 1, name: 'Glow Repair', type: 'service_company', email: 'shop@glow.test', is_premium: true },
      { id: 2, name: 'Lakeview', type: 'laser_clinic', plan: 'free' },
    ],
    contacts: [
      { id: 9, first_name: 'Pat', last_name: 'Kim', email: 'pat@lakeview.test', organization_id: 2 },
    ],
    requests: [{ id: 'sr', title: 'Fiber', status: 'open', organization_id: 2, created_at: '2026-01-01T00:00:00Z' }],
    estimates: [{ id: 3, status: 'expired', customer_name: 'Lakeview', total: 10, organization_id: 1 }],
    invoices: [{ id: 4, status: 'paid', customer_name: 'Lakeview', total: 20, organization_id: 1 }],
  });
  assert.equal(filterCrmPipeline(payload.pipeline, { source: 'service_request' }).length, 1);
  assert.equal(filterCrmPipeline(payload.pipeline, { q: 'fiber' })[0]?.title, 'Fiber');
  assert.equal(filterCrmAccounts(payload.accounts, { type: 'service_company' }).length, 1);
  assert.equal(filterCrmAccounts(payload.accounts, { q: 'lakeview' })[0]?.id, 2);
  assert.equal(filterCrmContacts(payload.contacts, { q: 'pat@' }).length, 1);
  assert.equal(filterCrmWork(payload.work, { kind: 'estimate', stage: 'lost' }).length, 1);
  assert.equal(filterCrmWork(payload.work, { kind: 'invoice', stage: 'won' }).length, 1);
});

test('formatMoney leaves empty amounts as a dash', () => {
  assert.equal(formatMoney(2400), '$2,400');
  assert.equal(formatMoney(12.5), '$12.50');
  assert.equal(formatMoney(null), '—');
});

function thenableQuery(result: { data?: unknown; error?: { message?: string } | null; count?: number | null }) {
  const query = {
    select() {
      return query;
    },
    order() {
      return query;
    },
    range() {
      return query;
    },
    eq() {
      return query;
    },
    limit() {
      return query;
    },
    then(onFulfilled?: (value: typeof result) => unknown) {
      return Promise.resolve(result).then(onFulfilled);
    },
  };
  return query;
}

test('fetchGodCrmSources tolerates a missing clinic_service_leads table', async () => {
  const admin = {
    from(table: string) {
      if (table === 'clinic_service_leads') {
        return thenableQuery({
          data: [],
          error: { message: 'Could not find the table public.clinic_service_leads in the schema cache' },
        });
      }
      if (table === 'marketplace_listings') {
        return thenableQuery({ data: [], error: null, count: 27 });
      }
      if (table === 'organizations') {
        return thenableQuery({
          data: [{ id: 12, name: 'Glow Repair', type: 'service_company', created_at: '2026-01-01T00:00:00Z' }],
          error: null,
        });
      }
      if (table === 'contacts') {
        return thenableQuery({
          data: [{ id: 1, first_name: 'Pat', last_name: 'Kim', organization_id: 12 }],
          error: null,
        });
      }
      return thenableQuery({ data: [], error: null });
    },
  };
  const sources = await fetchGodCrmSources(admin);
  assert.deepEqual(sources.missingTables, ['clinic_service_leads']);
  assert.equal(sources.orgs?.length, 1);
  assert.equal(sources.contacts?.length, 1);
  assert.equal(sources.leads?.length, 0);
  const payload = await loadGodCrm(admin);
  assert.equal(payload.summary.clinicLeads, null);
  assert.equal(payload.summary.organizations, 1);
  assert.equal(payload.summary.activeListings, 27);
});

test('CRM API, page, and nav stay behind the God gate', () => {
  const api = readFileSync(join(here, '../app/api/god/crm/route.ts'), 'utf8');
  const page = readFileSync(join(here, '../app/admin/god/crm/page.tsx'), 'utf8');
  const panel = readFileSync(join(here, '../components/god/GodCrmPanel.tsx'), 'utf8');
  const nav = readFileSync(join(here, '../components/god/GodSubnav.tsx'), 'utf8');
  const home = readFileSync(join(here, '../app/admin/god/page.tsx'), 'utf8');
  const layout = readFileSync(join(here, '../app/admin/layout.tsx'), 'utf8');
  assert.match(api, /requireGodCaller/);
  assert.match(api, /loadGodCrm/);
  assert.doesNotMatch(api, /process\.env/);
  assert.match(page, /GodCrmPanel/);
  assert.match(panel, /fetchGodMe/);
  assert.match(panel, /\/api\/god\/crm/);
  assert.match(panel, /This page could not be found/);
  assert.match(nav, /CRM/);
  assert.match(nav, /GOD_CRM_PATH/);
  assert.match(home, /\/admin\/god\/crm/);
  assert.match(layout, /GOD_CRM_PATH/);
  assert.equal(GOD_CRM_PATH, '/admin/god/crm');
});
