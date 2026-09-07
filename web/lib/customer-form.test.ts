import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPTIONAL_ORG_COLUMNS,
  charLimitFromError,
  customerOrgPayload,
  emptyCustomerForm,
  filterLinkedCustomers,
  loadLinkedCustomerOrgs,
  matchLinkedCustomer,
  stripOverflowingAddressFields,
} from './customer-form.ts';

const LUXOR_CUSTOMERS = [
  { id: 1, name: 'Northshore Clinic', city: 'Evanston', state: 'IL' },
  { id: 2, name: 'Galactic Med Spa', city: 'Mos Eisley', state: 'AZ' },
  { id: 3, name: 'Oak Park Dermatology', city: 'Oak Park', state: 'IL' },
];

test('ticket customer autofill matches assigned shops by name or city', () => {
  const byName = filterLinkedCustomers(LUXOR_CUSTOMERS, 'north');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].name, 'Northshore Clinic');

  const byCity = filterLinkedCustomers(LUXOR_CUSTOMERS, 'oak park');
  assert.equal(byCity.length, 1);
  assert.equal(byCity[0].id, 3);

  const emptyQuery = filterLinkedCustomers(LUXOR_CUSTOMERS, '');
  assert.equal(emptyQuery.length, 3);
});

test('exact name match is used instead of creating a duplicate company', () => {
  assert.equal(matchLinkedCustomer(LUXOR_CUSTOMERS, ' galactic med spa ')?.id, 2);
  assert.equal(matchLinkedCustomer(LUXOR_CUSTOMERS, 'Not On Roster'), null);
});

test('new service call form autocompletes assigned customers and can add a new company', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  assert.match(src, /loadLinkedCustomers/);
  assert.match(src, /organization_customers|loadLinkedCustomers/);
  assert.match(src, /AddCustomerModal/);
  assert.match(src, /createLinkedCustomer/);
  assert.match(src, /Add a company/);
  assert.match(src, /customer_organization_id/);
  assert.match(src, /Assign to FSE|AssignFseSelect/);
  assert.match(src, /loadTicketAssignees/);
  assert.match(src, /applyTicketAssignee/);
  assert.match(src, /100dvh/);
  assert.match(src, /overflowY: 'auto'/);
  assert.match(src, /normalizeStateCode/);
  assert.match(src, /customer_state: customerState/);
  assert.match(src, /insertOmittingCharOverflow/);
});

test('postgres character(3) overflow names the limit and optional address fields can be stripped', () => {
  assert.equal(charLimitFromError('value too long for type character(3)'), 3);
  const payload: Record<string, unknown> = { name: 'Clinic', zip: '60601', state: 'TX' };
  assert.equal(stripOverflowingAddressFields(payload, 3), 'zip');
  assert.equal(payload.zip, undefined);
  assert.equal(payload.state, 'TX');
});

test('character(3) retry omits UUID created_by, phone, biz_type, and type — never name', () => {
  const payload: Record<string, unknown> = {
    name: 'Northshore Clinic',
    type: 'customer',
    created_by: '11111111-1111-1111-1111-111111111111',
    phone: '312-555-0100',
    biz_type: 'Medical Spa',
    specialties: ['Hair Removal'],
  };
  assert.equal(stripOverflowingAddressFields(payload, 3), 'created_by');
  assert.equal(payload.created_by, undefined);
  assert.equal(stripOverflowingAddressFields(payload, 3), 'specialties');
  assert.equal(payload.specialties, undefined);
  assert.equal(stripOverflowingAddressFields(payload, 3), 'phone');
  assert.equal(stripOverflowingAddressFields(payload, 3), 'biz_type');
  assert.equal(stripOverflowingAddressFields(payload, 3), 'type');
  assert.equal(payload.type, undefined);
  assert.equal(payload.name, 'Northshore Clinic');
  assert.equal(stripOverflowingAddressFields(payload, 3), null);
});

test('empty specialties are omitted from the org insert payload', () => {
  const payload = customerOrgPayload({ ...emptyCustomerForm(), name: 'Clinic' }, { type: 'customer' });
  assert.equal('specialties' in payload, false);
});

test('customer org payload normalizes social handles and lists social columns as optional', () => {
  const payload = customerOrgPayload(
    { ...emptyCustomerForm(), name: 'Clinic', x_url: '@northshore', instagram_url: 'instagram.com/clinic' },
    { type: 'customer' }
  );
  assert.equal(payload.x_url, 'https://x.com/northshore');
  assert.equal(payload.instagram_url, 'https://instagram.com/clinic');
  assert.equal(payload.website, null);
  assert.equal(payload.facebook_url, null);
  for (const col of [
    'x_url',
    'instagram_url',
    'facebook_url',
    'tiktok_url',
    'youtube_url',
    'linkedin_url',
    'yelp_url',
    'threads_url',
  ]) {
    assert.ok((OPTIONAL_ORG_COLUMNS as readonly string[]).includes(col), col);
  }
});

test('Add Customer form accepts full state names instead of forcing ISO typing', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../components/CustomerInfoForm.tsx'), 'utf8');
  assert.match(src, /TX or Texas/);
  assert.doesNotMatch(src, /maxLength=\{2\}/);
});

test('ticket editor keeps shop organization_id and writes customer_organization_id', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(src, /TICKET_SAVE_FIELDS/);
  assert.match(src, /customer_organization_id: selectedOrg\.id/);
  assert.match(src, /loadLinkedCustomers/);
  assert.doesNotMatch(src, /[^_]organization_id: selectedOrg\.id/);
  assert.doesNotMatch(src, /update\(\{ \.\.\.formData/);
});

test('empty typeahead slice is UI-only and prefers newest links', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    name: `Clinic ${String(i + 1).padStart(2, '0')}`,
    linkedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }));
  const empty = filterLinkedCustomers(many, '');
  assert.equal(empty.length, 12);
  assert.equal(empty[0].id, 20);
  assert.equal(many.length, 20);

  const derm = filterLinkedCustomers(
    [
      ...many,
      { id: 2564, name: 'Dermatology & Cosmetic Center', city: 'Orange', linkedAt: '2026-09-07T00:00:00Z' },
    ],
    'dermatology'
  );
  assert.equal(derm.length, 1);
  assert.equal(derm[0].id, 2564);
});

function mockPagedClient(opts: { linkRows: any[]; orgRows: any[]; captured: any[] }) {
  return {
    from(table: string) {
      const captured: any = { table, filters: [] as any[] };
      opts.captured.push(captured);
      const builder: any = {
        select(sel: string) {
          captured.select = sel;
          return builder;
        },
        eq(col: string, val: any) {
          captured.filters.push(['eq', col, val]);
          return builder;
        },
        in(col: string, val: any) {
          captured.filters.push(['in', col, val]);
          return builder;
        },
        range(from: number, to: number) {
          captured.range = [from, to];
          return builder;
        },
        then(resolve: (v: any) => void, reject?: (e: any) => void) {
          const payload =
            table === 'organization_customers'
              ? { data: opts.linkRows, error: null }
              : { data: opts.orgRows, error: null };
          return Promise.resolve(payload).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('loadLinkedCustomerOrgs pages every organization_customers row then chunks orgs', async () => {
  const captured: any[] = [];
  const supabase = mockPagedClient({
    captured,
    linkRows: [
      { customer_organization_id: 2564, created_at: '2026-09-07T00:00:00Z' },
      { customer_organization_id: 10, created_at: '2025-01-01T00:00:00Z' },
    ],
    orgRows: [
      { id: 10, name: 'Older Clinic', city: 'Irvine', contact_name: 'Pat' },
      { id: 2564, name: 'Dermatology & Cosmetic Center', city: 'Orange', contact_name: 'Larry' },
    ],
  });
  const rows = await loadLinkedCustomerOrgs(supabase as any, 4);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === 2564)?.linkedAt, '2026-09-07T00:00:00Z');
  const linkQuery = captured.find((c) => c.table === 'organization_customers');
  assert.deepEqual(linkQuery.range, [0, 199]);
  assert.equal(linkQuery.limit, undefined);
  assert.ok(!captured.some((c) => c.limit === 500));
  assert.deepEqual(linkQuery.filters[0], ['eq', 'service_organization_id', 4]);
});

test('estimate/invoice/report pickers page all linked customers and do not cap at 500', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of [
    '../app/estimates/new/EstimateFormClient.tsx',
    '../app/invoices/new/InvoiceFormClient.tsx',
    '../app/reports/new/NewServiceReportClient.tsx',
  ]) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /loadLinkedCustomerOrgs|loadLinkedCustomers/, rel);
    assert.match(src, /filterLinkedCustomers/, rel);
    assert.doesNotMatch(
      src,
      /from\('organization_customers'\)[\s\S]{0,400}\.limit\(500\)/,
      rel
    );
  }
});

test('Android estimate/invoice/report pickers search organization_customers instead of dumping all orgs', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of [
    '../../app/src/main/assets/estimate_generator.html',
    '../../app/src/main/assets/invoice_form.html',
    '../../app/src/main/assets/service_report.html',
  ]) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /organization_customers/, rel);
    assert.match(src, /searchLinkedCustomers/, rel);
    assert.match(src, /created_at/, rel);
    assert.doesNotMatch(
      src,
      /from\('organizations'\)[\s\S]{0,200}\.eq\('type',\s*'customer'\)[\s\S]{0,80}\.order\('name'\)/,
      rel
    );
  }
});

test('send-invoice requires an owned invoice row before service-role writes', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/api/billing/send-invoice/route.ts'), 'utf8');
  assert.doesNotMatch(src, /row\.organization_id == null/);
  assert.match(src, /This invoice belongs to another organization/);
  assert.match(src, /if \(invoiceId && inv\)/);
});
