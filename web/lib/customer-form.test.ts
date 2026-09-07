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
  matchLinkedCustomer,
  sanitizeIlikeTerm,
  searchLinkedCustomers,
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
  assert.match(src, /searchLinkedCustomers|useLinkedCustomerSearch/);
  assert.match(src, /organization_customers|searchLinkedCustomers|useLinkedCustomerSearch/);
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
  assert.match(src, /searchLinkedCustomers|useLinkedCustomerSearch/);
  assert.doesNotMatch(src, /[^_]organization_id: selectedOrg\.id/);
  assert.doesNotMatch(src, /update\(\{ \.\.\.formData/);
});

test('sanitizeIlikeTerm strips PostgREST metacharacters', () => {
  assert.equal(sanitizeIlikeTerm('  Derm%_clinic, (CA)  '), 'Derm clinic CA');
  assert.equal(sanitizeIlikeTerm(''), '');
});

function mockSearchClient(opts: {
  embedRows?: any[];
  embedError?: { message: string } | null;
  fallbackRows?: any[];
  orgRows?: any[];
  captured: any[];
}) {
  return {
    from(table: string) {
      const captured: any = { table, orders: [] as any[], filters: [] as any[] };
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
        or(filter: string, extra?: any) {
          captured.or = filter;
          captured.orOpts = extra;
          return builder;
        },
        order(col: string, extra?: any) {
          captured.orders.push([col, extra]);
          return builder;
        },
        limit(n: number) {
          captured.limit = n;
          return builder;
        },
        then(resolve: (v: any) => void, reject?: (e: any) => void) {
          const isOrg = table === 'organizations';
          const wantEmbed = /organizations:customer_organization_id/.test(captured.select || '');
          const payload = isOrg
            ? { data: opts.orgRows || [], error: null }
            : wantEmbed && opts.embedError
              ? { data: null, error: opts.embedError }
              : {
                  data: wantEmbed ? opts.embedRows || [] : opts.fallbackRows || [],
                  error: null,
                };
          return Promise.resolve(payload).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('empty linked-customer search returns newest links only (created_at desc, limit 12)', async () => {
  const captured: any[] = [];
  const supabase = mockSearchClient({
    captured,
    embedRows: [
      {
        customer_organization_id: 2564,
        created_at: '2026-09-07T00:00:00Z',
        organizations: {
          id: 2564,
          name: 'Dermatology & Cosmetic Center',
          city: 'Orange',
          state: 'CA',
          contact_name: 'Larry',
        },
      },
    ],
  });
  const rows = await searchLinkedCustomers(supabase as any, 4, '');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 2564);
  assert.equal(rows[0].name, 'Dermatology & Cosmetic Center');
  assert.equal(rows[0].contact, 'Larry');
  const linkQuery = captured.find((c) => c.table === 'organization_customers');
  assert.equal(linkQuery.limit, 12);
  assert.deepEqual(linkQuery.orders[0], ['created_at', { ascending: false, nullsFirst: false }]);
  assert.ok(!captured.some((c) => c.limit === 500));
});

test('typed linked-customer search ilikes name/city among this service org and caps at 20', async () => {
  const captured: any[] = [];
  const supabase = mockSearchClient({
    captured,
    embedRows: [
      {
        customer_organization_id: 2564,
        organizations: { id: 2564, name: 'Dermatology & Cosmetic Center', city: 'Orange' },
      },
    ],
  });
  const rows = await searchLinkedCustomers(supabase as any, 4, 'Dermatology');
  assert.equal(rows[0].id, 2564);
  const linkQuery = captured.find((c) => c.table === 'organization_customers');
  assert.equal(linkQuery.limit, 20);
  assert.match(linkQuery.or, /name\.ilike\.%Dermatology%/);
  assert.match(linkQuery.or, /city\.ilike\.%Dermatology%/);
  assert.equal(linkQuery.orOpts.referencedTable, 'organizations');
  assert.deepEqual(linkQuery.filters[0], ['eq', 'service_organization_id', 4]);
});

test('estimate/invoice/report pickers use server search and do not cap organization_customers at 500', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of [
    '../app/estimates/new/EstimateFormClient.tsx',
    '../app/invoices/new/InvoiceFormClient.tsx',
    '../app/reports/new/NewServiceReportClient.tsx',
  ]) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /searchLinkedCustomers|useLinkedCustomerSearch/, rel);
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
