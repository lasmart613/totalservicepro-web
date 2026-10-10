import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { runSendEstimate } from '../../app/api/billing/send-estimate/route.ts';
import { runVoidInvoice } from '../../app/api/billing/invoices/void/route.ts';
import { runSendInvoice } from '../../app/api/billing/send-invoice/route.ts';
import { runSendPurchaseOrder } from '../../app/api/billing/send-purchase-order/route.ts';
import { runSendReport } from '../../app/api/billing/send-report/route.ts';

const profile = {
  id: 'user-1',
  organization_id: 7,
  role: 'admin',
  first_name: 'Ada',
  last_name: 'Lovelace',
};

type Row = Record<string, unknown>;

function memoryClient(tables: Record<string, Row[]>) {
  const calls: { table: string; cols: string }[] = [];
  const client = {
    calls,
    from(table: string) {
      let cols = '';
      const filters: { col: string; val: unknown }[] = [];
      const api = {
        select(next: string) {
          cols = next;
          return api;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return api;
        },
        maybeSingle: async () => {
          calls.push({ table, cols });
          const found = (tables[table] || []).find((row) =>
            filters.every((filter) => row[filter.col] != null && String(row[filter.col]) === String(filter.val))
          );
          return { data: found || null, error: null };
        },
        update() {
          throw new Error(`${table} should not be written`);
        },
      };
      return api;
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'ada@cedar.test' } }, error: null }),
    },
  };
  return client;
}

function request(url: string, body: unknown, auth = true) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      ...(auth ? { authorization: 'Bearer session-token' } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function snapshot(res: Response) {
  const headers = [...res.headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return { status: res.status, headers, body: await res.text() };
}

/**
 * The signed-in client cannot see the other shop's row (RLS). The service
 * role client can. A missing id and that hidden row must still match.
 */
function hiddenPair(table: string, foreignRow: Row) {
  const user = () => memoryClient({ user_profiles: [profile], [table]: [] });
  const foreign = {
    user: user(),
    admin: memoryClient({ [table]: [foreignRow] }),
  };
  const missing = {
    user: user(),
    admin: memoryClient({ [table]: [] }),
  };
  return { foreign, missing };
}

test('send and void routes answer 404 the same way for another shop and a missing id', async () => {
  const cases: Array<{
    name: string;
    url: string;
    table: string;
    idKey: string;
    notFound: string;
    row: Row;
    run: (
      req: NextRequest,
      deps: { userClient: ReturnType<typeof memoryClient>; adminClient: ReturnType<typeof memoryClient> }
    ) => Promise<Response>;
  }> = [
    {
      name: 'POST /api/billing/send-invoice',
      url: 'https://repairplanet.net/api/billing/send-invoice',
      table: 'service_invoices',
      idKey: 'invoice_id',
      notFound: 'Invoice not found.',
      row: { id: 99, organization_id: 8, customer_email: 'victim@other.test', invoice_data: {} },
      run: (req, deps) => runSendInvoice(req, deps),
    },
    {
      name: 'POST /api/billing/send-estimate',
      url: 'https://repairplanet.net/api/billing/send-estimate',
      table: 'service_estimates',
      idKey: 'estimate_id',
      notFound: 'Estimate not found.',
      row: { id: 99, organization_id: 8, customer_email: 'victim@other.test', estimate_data: {} },
      run: (req, deps) => runSendEstimate(req, deps),
    },
    {
      name: 'POST /api/billing/send-report',
      url: 'https://repairplanet.net/api/billing/send-report',
      table: 'service_reports',
      idKey: 'report_id',
      notFound: 'Service report not found.',
      row: { id: 99, organization_id: 8, customer_email: 'victim@other.test' },
      run: (req, deps) => runSendReport(req, deps),
    },
    {
      name: 'POST /api/billing/send-purchase-order',
      url: 'https://repairplanet.net/api/billing/send-purchase-order',
      table: 'purchase_orders',
      idKey: 'purchase_order_id',
      notFound: 'Purchase order not found.',
      row: { id: 99, organization_id: 8, supplier_email: 'victim@other.test' },
      run: (req, deps) => runSendPurchaseOrder(req, deps),
    },
    {
      name: 'POST /api/billing/invoices/void',
      url: 'https://repairplanet.net/api/billing/invoices/void',
      table: 'service_invoices',
      idKey: 'invoice_id',
      notFound: 'Invoice not found.',
      row: { id: 99, organization_id: 8, customer_email: 'victim@other.test', invoice_data: {} },
      run: (req, deps) => runVoidInvoice(req, deps),
    },
  ];

  for (const item of cases) {
    const { foreign, missing } = hiddenPair(item.table, item.row);
    const foreignRes = await item.run(request(item.url, { [item.idKey]: 99, html: '<b>nope</b>' }), {
      userClient: foreign.user,
      adminClient: foreign.admin,
    });
    const missingRes = await item.run(request(item.url, { [item.idKey]: 77, html: '<b>nope</b>' }), {
      userClient: missing.user,
      adminClient: missing.admin,
    });
    const foreignSnap = await snapshot(foreignRes);
    const missingSnap = await snapshot(missingRes);
    assert.deepEqual(foreignSnap, missingSnap, item.name);
    assert.equal(foreignSnap.status, 404, item.name);
    assert.equal(foreignSnap.body, JSON.stringify({ error: item.notFound }), item.name);
    assert.equal(foreignSnap.body.includes('victim@other.test'), false, item.name);
    assert.equal(foreignSnap.body.includes('another organization'), false, item.name);
    assert.deepEqual(
      foreign.user.calls.map((call) => call.table),
      missing.user.calls.map((call) => call.table),
      item.name
    );
    assert.deepEqual(
      foreign.admin.calls.map((call) => ({ table: call.table, cols: call.cols })),
      missing.admin.calls.map((call) => ({ table: call.table, cols: call.cols })),
      item.name
    );
    assert.equal(foreign.admin.calls.some((call) => call.cols === '*'), false, item.name);
    assert.equal(foreign.user.calls.filter((call) => call.table === item.table).length, 1, item.name);
    assert.equal(foreign.admin.calls.filter((call) => call.table === item.table).length, 1, item.name);

    const anon = await item.run(request(item.url, { [item.idKey]: 99 }, false), {
      userClient: memoryClient({ user_profiles: [profile] }),
      adminClient: memoryClient({}),
    });
    assert.equal(anon.status, 401, item.name);
    assert.equal((await anon.json()).error, 'Sign in required', item.name);
  }
});
