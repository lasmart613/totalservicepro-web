import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDirectoryListings, loadLinkedCustomers } from './org-customers.ts';
import { SUPABASE_PAGE_SIZE } from './supabase/fetch-all.ts';

type LinkRow = { customer_organization_id: number };
type OrgRow = { id: number; name: string; type: string; is_active?: boolean };

function mockClient(opts: {
  links: LinkRow[];
  orgs: OrgRow[];
  listed?: OrgRow[];
}) {
  const linkCalls: Array<{ from: number; to: number }> = [];
  const inChunks: number[][] = [];
  return {
    linkCalls,
    inChunks,
    from(table: string) {
      if (table === 'organization_customers') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          async range(from: number, to: number) {
            linkCalls.push({ from, to });
            return { data: opts.links.slice(from, to + 1), error: null };
          },
        };
      }
      if (table === 'organizations') {
        let listedOnly = false;
        let typeFilter: string[] | null = null;
        let idFilter: number[] | null = null;
        return {
          select() {
            return this;
          },
          eq(col: string, val: unknown) {
            if (col === 'list_in_directory' && val === true) listedOnly = true;
            return this;
          },
          in(col: string, vals: unknown[]) {
            if (col === 'id') {
              idFilter = vals as number[];
              inChunks.push(vals as number[]);
            }
            if (col === 'type') typeFilter = vals as string[];
            return this;
          },
          order() {
            return this;
          },
          async range(from: number, to: number) {
            const source = listedOnly ? opts.listed || [] : opts.orgs;
            return { data: source.slice(from, to + 1), error: null };
          },
          then(resolve: (v: unknown) => unknown) {
            let rows = opts.orgs;
            if (idFilter) rows = rows.filter((o) => idFilter!.includes(o.id));
            if (typeFilter) rows = rows.filter((o) => typeFilter!.includes(o.type));
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('loadLinkedCustomers pages 1754 links and returns every matching org', async () => {
  const links = Array.from({ length: 1754 }, (_, i) => ({ customer_organization_id: i + 1 }));
  const orgs = links.map((l) => ({
    id: l.customer_organization_id,
    name: `Clinic ${String(l.customer_organization_id).padStart(4, '0')}`,
    type: 'customer',
  }));
  const sb = mockClient({ links, orgs });
  const { data, error } = await loadLinkedCustomers(sb as any, 4);
  assert.equal(error, null);
  assert.equal(sb.linkCalls.length, 4);
  assert.equal(sb.linkCalls[0].to - sb.linkCalls[0].from + 1, SUPABASE_PAGE_SIZE);
  assert.equal(data.length, 1754);
  assert.equal(data[0].id, 1);
  assert.equal(data[1753].id, 1754);
});

test('loadLinkedCustomers dedupes ids and skips non-CRM types', async () => {
  const links = [
    { customer_organization_id: 1 },
    { customer_organization_id: 1 },
    { customer_organization_id: 2 },
    { customer_organization_id: 3 },
  ];
  const orgs = [
    { id: 1, name: 'Alpha', type: 'customer' },
    { id: 2, name: 'Beta', type: 'service_company' },
    { id: 3, name: 'Gamma', type: 'laser_clinic' },
  ];
  const { data, error } = await loadLinkedCustomers(mockClient({ links, orgs }) as any, 4);
  assert.equal(error, null);
  assert.deepEqual(
    data.map((r) => r.id),
    [1, 3]
  );
});

test('loadDirectoryListings pages listed orgs until empty', async () => {
  const listed = Array.from({ length: 612 }, (_, i) => ({
    id: i + 1,
    name: `Org ${i + 1}`,
    type: 'service_company',
  }));
  const { data, error } = await loadDirectoryListings(mockClient({ links: [], orgs: [], listed }) as any);
  assert.equal(error, null);
  assert.equal(data.length, 612);
});
