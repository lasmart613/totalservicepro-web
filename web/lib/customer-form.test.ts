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
  updateCustomerOrg,
  finalizeOrganizationPayload,
  filterLinkedCustomers,
  findLinkedCustomerByName,
  loadLinkedCustomerOpt,
  loadLinkedCustomerOrgs,
  matchLinkedCustomer,
  searchShopCustomers,
  sanitizeCustomerSearch,
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

test('customer equipment loads by customer_organization_id only', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/customers/[id]/page.tsx'), 'utf8');
  assert.match(page, /from\('equipment'\)/);
  assert.doesNotMatch(page, /from\('equipment'\)[\s\S]{0,240}\.eq\('organization_id'/);
  const requests = readFileSync(join(here, '../app/service-requests/page.tsx'), 'utf8');
  assert.doesNotMatch(requests, /from\('equipment'\)[\s\S]{0,240}\.eq\('organization_id'/);
});

test('exact name match is used instead of creating a duplicate company', () => {
  assert.equal(matchLinkedCustomer(LUXOR_CUSTOMERS, ' galactic med spa ')?.id, 2);
  assert.equal(matchLinkedCustomer(LUXOR_CUSTOMERS, 'Not On Roster'), null);
});

test('new service call form autocompletes assigned customers and can add a new company', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  assert.match(src, /searchShopCustomers/);
  assert.match(src, /findLinkedCustomerByName/);
  assert.match(src, /customerNameRef/);
  assert.match(src, /matchLinkedCustomer\(rows, customerNameRef\.current\)/);
  assert.match(src, /if \(!lookup\.ok\)/);
  assert.match(src, /LINKED_CUSTOMER_SEARCH_DEBOUNCE_MS/);
  assert.match(src, /customerSearchGen/);
  assert.doesNotMatch(src, /loadLinkedCustomers\(/);
  assert.doesNotMatch(src, /searchLinkedCustomers\(/);
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

test('customer org payload matches live organizations columns on the first insert', () => {
  const form = {
    ...emptyCustomerForm(),
    name: 'Northshore Clinic',
    state: 'Texas',
    zip: '60601',
    phone: '312-555-0100',
    email: 'office@clinic.test',
    notes: 'Front desk',
    contact_name: 'Pat Rivera',
    specialties: ['Hair Removal'],
    x_url: '@northshore',
    instagram_url: 'instagram.com/clinic',
  };
  const payload = customerOrgPayload(form, {
    type: 'customer',
    ticket_prefix: 'NORTHSHORE CLINIC',
    created_by: '11111111-1111-4111-8111-111111111111',
    list_in_directory: null,
    storefront_enabled: null,
    contact: 'Pat Rivera',
    organization_type: 'customer',
    country: 'USA',
    supported_brands: 'Candela, Cutera',
    service_territories: ['TX'],
  });
  assert.equal(payload.type, 'customer');
  assert.equal(payload.ticket_prefix, 'NOR');
  assert.equal(payload.state, 'TX');
  assert.equal(payload.zip, '60601');
  assert.equal(payload.contact_name, 'Pat Rivera');
  assert.equal(payload.created_by, '11111111-1111-4111-8111-111111111111');
  assert.equal(payload.phone, '312-555-0100');
  assert.equal(payload.email, 'office@clinic.test');
  assert.equal(payload.notes, 'Front desk');
  assert.deepEqual(payload.specialties, ['Hair Removal']);
  assert.deepEqual(payload.supported_brands, ['Candela', 'Cutera']);
  assert.deepEqual(payload.service_territories, ['TX']);
  assert.equal(typeof payload.directory_contacts, 'object');
  assert.equal(Array.isArray(payload.directory_contacts), false);
  assert.equal('country' in payload, false);
  assert.equal('contact' in payload, false);
  assert.equal('organization_type' in payload, false);
  assert.equal('list_in_directory' in payload, false);
  assert.equal('storefront_enabled' in payload, false);
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
    assert.equal(col in payload, false, col);
    assert.ok((OPTIONAL_ORG_COLUMNS as readonly string[]).includes(col), col);
  }

  const flagged = finalizeOrganizationPayload({
    name: 'Clinic',
    type: 'laser_clinic',
    list_in_directory: false,
    storefront_enabled: true,
  });
  assert.equal(flagged.type, 'laser_clinic');
  assert.equal(flagged.list_in_directory, false);
  assert.equal(flagged.storefront_enabled, true);
  assert.equal(finalizeOrganizationPayload({ name: 'Clinic', type: 'Clinic' }).type, 'customer');
});

test('Add Customer form accepts full state names instead of forcing ISO typing', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../components/CustomerInfoForm.tsx'), 'utf8');
  assert.match(src, /TX or Texas/);
  assert.doesNotMatch(src, /maxLength=\{2\}/);
});

test('directory form replaces the single contact field with office + five roles + primary radio', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../components/CustomerInfoForm.tsx'), 'utf8');
  const roles = readFileSync(join(here, './customer-contacts.ts'), 'utf8');
  assert.match(src, /Main office email/);
  assert.match(src, /Main office phone/);
  assert.match(src, /directory-primary-contact/);
  assert.match(src, /DIRECTORY_ROLE_LABELS/);
  assert.match(roles, /Owner/);
  assert.match(roles, /Medical Director/);
  assert.match(roles, /Physician/);
  assert.match(roles, /Laser Technician/);
  assert.match(roles, /Office Manager/);
  assert.match(src, /First name/);
  assert.match(src, /Last name/);
  assert.doesNotMatch(src, /placeholder="Name"/);
  assert.match(src, /patchDirectoryRoleField/);
  assert.doesNotMatch(src, /Primary contact person/);
});

test('customer org payload writes directory JSON and syncs contact_name from the primary role', () => {
  const form = emptyCustomerForm();
  form.name = 'Clinic';
  form.email = 'office@clinic.com';
  form.phone = '555-0000';
  form.contact_name = 'Legacy';
  form.directory.roles.owner = {
    first_name: 'Larry',
    last_name: 'Smart',
    email: 'larry@clinic.com',
    phone: '555-0100',
  };
  form.directory.primaryRole = 'owner';
  const payload = customerOrgPayload(form, { type: 'customer' });
  assert.equal(payload.contact_name, 'Larry Smart');
  assert.equal(payload.email, 'office@clinic.com');
  const directory = payload.directory_contacts as {
    primaryRole?: string;
    roles?: { owner?: { name?: string; first_name?: string; last_name?: string } };
  };
  assert.equal(directory.primaryRole, 'owner');
  assert.equal(directory.roles?.owner?.first_name, 'Larry');
  assert.equal(directory.roles?.owner?.last_name, 'Smart');
  assert.equal(directory.roles?.owner?.name, 'Larry Smart');

  form.directory.roles.owner = {
    first_name: 'Larry ',
    last_name: 'Van Der Berg',
    email: 'larry@clinic.com',
    phone: '555-0100',
  };
  const spaced = customerOrgPayload(form, { type: 'customer' });
  assert.equal(spaced.contact_name, 'Larry Van Der Berg');
  const spacedDir = spaced.directory_contacts as {
    roles?: { owner?: { first_name?: string; last_name?: string; name?: string } };
  };
  assert.equal(spacedDir.roles?.owner?.first_name, 'Larry');
  assert.equal(spacedDir.roles?.owner?.last_name, 'Van Der Berg');
  assert.equal(spacedDir.roles?.owner?.name, 'Larry Van Der Berg');
});

test('ticket editor keeps shop organization_id and writes customer_organization_id', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(src, /TICKET_SAVE_FIELDS/);
  assert.match(src, /customer_organization_id: selectedOrg\.id/);
  assert.match(src, /searchShopCustomers/);
  assert.match(src, /Promise\.all/);
  assert.doesNotMatch(src, /searchLinkedCustomers\(/);
  assert.match(src, /LINKED_CUSTOMER_SEARCH_DEBOUNCE_MS/);
  assert.match(src, /customerSearchGen/);
  assert.equal(src.split('listReportsForTicket(').length - 1, 1);
  assert.doesNotMatch(src, /loadLinkedCustomers\(/);
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
        limit(n: number) {
          captured.limit = n;
          return builder;
        },
        then(resolve: (v: any) => void, reject?: (e: any) => void) {
          const payload =
            table === 'organization_customers'
              ? { data: opts.linkRows, error: null }
              : table === 'contacts'
                ? { data: [], error: null }
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

test('estimate and report pickers page all linked customers and do not cap at 500', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of [
    '../app/estimates/new/EstimateFormClient.tsx',
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

test('invoice editor searches linked customers and does not wait on the full directory', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  const init = src.slice(src.indexOf('const invoiceTask = editIdParam'), src.indexOf('function updateLine'));
  assert.match(src, /searchLinkedCustomers/);
  assert.match(src, /filterLinkedCustomers/);
  assert.doesNotMatch(src, /loadLinkedCustomerOrgs|loadLinkedCustomers\(/);
  assert.doesNotMatch(init, /await refreshCustomers|await searchLinkedCustomers|await loadParts|await getOrgRole|await getCompanyTheme/);
  const invoiceAt = init.indexOf('loadInvoice(editIdParam, token)');
  const sessionAt = init.indexOf('auth.getSession');
  assert.ok(invoiceAt >= 0 && sessionAt > invoiceAt, 'the invoice read starts before the session read');
});

function searchClient(opts: {
  failDirectory?: boolean;
  otherError?: boolean;
  rows?: unknown[];
}) {
  const calls: Array<{ select: string; limit?: number; or?: unknown; order?: unknown; eq?: unknown }> = [];
  const client = {
    calls,
    from() {
      const q: Record<string, unknown> & { then: (resolve: (v: unknown) => void) => void } = {
        select(cols: string) {
          q.cols = cols;
          return q;
        },
        eq(col: string, val: unknown) {
          q.eqArgs = [col, val];
          return q;
        },
        order(col: string, opt: unknown) {
          q.orderArgs = [col, opt];
          return q;
        },
        limit(n: number) {
          q.limitArg = n;
          return q;
        },
        or(expr: string, opt: unknown) {
          q.orArgs = [expr, opt];
          return q;
        },
        then(resolve: (v: unknown) => void) {
          const select = String(q.cols || '');
          calls.push({
            select,
            limit: q.limitArg as number | undefined,
            or: q.orArgs,
            order: q.orderArgs,
            eq: q.eqArgs,
          });
          const missing = Boolean(opts.failDirectory) && /directory_contacts/.test(select);
          resolve({
            data: missing || opts.otherError ? null : opts.rows || [],
            error: missing
              ? { message: "Could not find the 'directory_contacts' column of 'organizations' in the schema cache" }
              : opts.otherError
                ? { message: 'permission denied' }
                : null,
          });
        },
      };
      return q;
    },
  };
  return client;
}

test('searchLinkedCustomers is one limited request and keeps recent order', async () => {
  const client = searchClient({
    rows: [
      {
        created_at: '2026-11-01T00:00:00Z',
        organizations: {
          id: 10,
          name: 'Oak Park Dermatology',
          city: 'Oak Park',
          state: 'IL',
          type: 'laser_clinic',
          phone: '555',
          email: 'a@b.c',
          contact_name: 'Pat',
        },
      },
      {
        created_at: '2026-10-01T00:00:00Z',
        organizations: { id: 11, name: 'Service Co', type: 'service_company' },
      },
    ],
  });
  const rows = await searchLinkedCustomers(client as never, 2639, '');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].limit, 12);
  assert.match(client.calls[0].select, /directory_contacts/);
  assert.deepEqual(client.calls[0].eq, ['service_organization_id', 2639]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Oak Park Dermatology');
  assert.equal(rows[0].linkedAt, '2026-11-01T00:00:00Z');
  assert.equal(rows[0].contact, 'Pat');
});

test('a typed customer search does not page and does not retry when the first select works', async () => {
  const client = searchClient({ rows: [] });
  await searchLinkedCustomers(client as never, 2639, 'Oak Park%');
  assert.equal(client.calls.length, 1);
  const or = client.calls[0].or as [string, { referencedTable: string }];
  assert.match(or[0], /name\.ilike\.%Oak Park%/);
  assert.doesNotMatch(or[0], /%%/);
  assert.equal(or[1].referencedTable, 'organizations');
  assert.equal(client.calls[0].order, undefined);
});

test('000960 sorts linked customers in SQL before the limit and does not add indexes', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261117_000960_linked_customer_search.sql'),
    'utf8'
  );
  const rollback = readFileSync(
    join(here, '../supabase/migrations/20261117_000960_linked_customer_search_rollback.sql'),
    'utf8'
  );
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /lower\(btrim\(o\.name\)\) = lower\(btrim\(p_name\)\)/);
  assert.match(sql, /ORDER BY\s+CASE[\s\S]*lower\(m\.org_name\) ASC/);
  const orderAt = sql.indexOf('lower(m.org_name) ASC');
  const limitAt = sql.indexOf('LIMIT least');
  assert.ok(orderAt > 0 && limitAt > orderAt);
  assert.match(sql, /o\.type IS NOT NULL/);
  assert.doesNotMatch(sql, /CREATE INDEX/);
  assert.doesNotMatch(sql, /pg_trgm/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public.search_linked_customers/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public.find_linked_customer_by_name/);
});

function rpcClient(rows: unknown[], error?: { message: string } | null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return { data: rows, error: error || null };
    },
  };
}

test('shop customer search keeps server order for more than 12 matches and sends the raw name', async () => {
  const serverOrder = Array.from({ length: 15 }, (_, i) => ({
    id: 100 - i,
    name: `Clinic ${String(15 - i).padStart(2, '0')}`,
    city: 'Austin',
    state: 'TX',
    phone: '555-2222',
    email: 'larry@smith.test',
    contact: 'Larry Smart',
    contact_role: 'Owner',
    office_phone: '555-1111',
    linked_at: '2026-01-01T00:00:00Z',
  }));
  const client = rpcClient(serverOrder);
  const rows = await searchShopCustomers(client as never, 2655, 'Dr. Smith, Inc.');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].fn, 'search_linked_customers');
  assert.equal(client.calls[0].args.p_query, 'Dr. Smith, Inc.');
  assert.equal(client.calls[0].args.p_sort, 'name');
  assert.equal(client.calls[0].args.p_limit, 12);
  assert.equal(rows.length, 15);
  assert.deepEqual(rows.map((row) => row.name), serverOrder.map((row) => row.name));
  assert.equal(rows[0].phone, '555-2222');
  assert.equal(rows[0].contact, 'Larry Smart');
  assert.equal(rows[0].officePhone, '555-1111');

  const quoted = rpcClient([]);
  await searchShopCustomers(quoted as never, 2655, 'say "hi": Clinic');
  assert.equal(quoted.calls[0].args.p_query, 'say "hi": Clinic');
});

test('exact customer name is one RPC and a failed lookup does not look like no match', async () => {
  const client = rpcClient([
    { id: 10, name: 'Dr. Smith, Inc.', phone: '555-2222', email: 'larry@smith.test', contact: 'Larry Smart' },
  ]);
  const hit = await findLinkedCustomerByName(client as never, 2655, '  Dr. Smith, Inc.  ');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].fn, 'find_linked_customer_by_name');
  assert.equal(client.calls[0].args.p_name, '  Dr. Smith, Inc.  ');
  assert.equal(hit.ok, true);
  if (hit.ok) assert.equal(hit.customer?.id, 10);

  const missing = rpcClient([]);
  const none = await findLinkedCustomerByName(missing as never, 2655, 'Dr Smith Inc');
  assert.deepEqual(none, { ok: true, customer: null });

  const failed = rpcClient([], { message: 'function find_linked_customer_by_name does not exist' });
  const down = await findLinkedCustomerByName(failed as never, 2655, 'Dr. Smith, Inc.');
  assert.deepEqual(down, { ok: false });
});

test('one linked customer is loaded by id without paging the shop', async () => {
  const client = searchClient({
    rows: [
      {
        created_at: '2026-11-02T00:00:00Z',
        organizations: { id: 44, name: 'New Clinic', type: 'customer', city: 'Austin' },
      },
    ],
  });
  const hit = await loadLinkedCustomerOpt(client as never, 2655, 44);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].limit, 1);
  assert.equal(hit?.name, 'New Clinic');
  assert.equal(hit?.city, 'Austin');
});

test('directory_contacts missing retries once; any other error does not', async () => {
  const missing = searchClient({ failDirectory: true, rows: [] });
  await searchLinkedCustomers(missing as never, 2639, '');
  assert.equal(missing.calls.length, 2);
  assert.doesNotMatch(missing.calls[1].select, /directory_contacts/);

  const denied = searchClient({ otherError: true });
  const rows = await searchLinkedCustomers(denied as never, 2639, 'clinic');
  assert.equal(denied.calls.length, 1);
  assert.deepEqual(rows, []);
});

test('sanitizeCustomerSearch strips ilike wildcards and or() separators', () => {
  assert.equal(sanitizeCustomerSearch('  Oak_Park%, (Dr.)  '), 'Oak Park Dr');
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
  assert.match(src, /documentOwnedByOrganization/);
  assert.match(src, /Invoice not found/);
  assert.doesNotMatch(src, /belongs to another organization/);
  assert.match(src, /if \(invoiceId && inv\)/);
});

function recordingSupabase() {
  const updates: Array<Record<string, unknown>> = [];
  const chain = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
        }
        return (...args: unknown[]) => {
          if (prop === 'update' && args[0] && typeof args[0] === 'object') {
            updates.push(args[0] as Record<string, unknown>);
          }
          return chain();
        };
      },
    });
  return { client: chain() as never, updates };
}

test('QA #325 M-1: updateCustomerOrg never sends notes when org_private_fields failed', async () => {
  const { client, updates } = recordingSupabase();
  const form = { ...emptyCustomerForm(), name: 'Clinic', notes: '' };
  const out = await updateCustomerOrg(client, 40, form, { privateBaseline: null });
  assert.ok(!('notes' in out));
  assert.ok(updates.length > 0 && updates.every((u) => !('notes' in u)));
});

test('QA #325 M-1: updateCustomerOrg skips unchanged notes, sends changed ones', async () => {
  const a = recordingSupabase();
  await updateCustomerOrg(a.client, 40, { ...emptyCustomerForm(), name: 'C', notes: 'same' }, {
    privateBaseline: { notes: 'same', tax_id: null },
  });
  assert.ok(a.updates.every((u) => !('notes' in u)));
  const b = recordingSupabase();
  await updateCustomerOrg(b.client, 40, { ...emptyCustomerForm(), name: 'C', notes: 'new' }, {
    privateBaseline: { notes: 'same', tax_id: null },
  });
  assert.ok(b.updates.some((u) => u.notes === 'new'));
});
