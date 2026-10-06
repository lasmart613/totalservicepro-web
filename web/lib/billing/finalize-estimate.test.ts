import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canConvertEstimateToInvoice,
  estimateWritePayload,
  finalizeEstimateDelivery,
  persistServiceEstimate,
} from './finalize-estimate.ts';

const here = dirname(fileURLToPath(import.meta.url));

type Row = {
  id: number;
  organization_id: number;
  estimate_number: string;
  status: string | null;
  sent_at?: string | null;
  total?: number;
};

function memoryEstimates(initial: Row[], opts?: { missingColumns?: string[] }) {
  const rows = initial.map((row) => ({ ...row }));
  const ops: string[] = [];
  const missing = new Set(opts?.missingColumns || []);

  function from(table: string) {
    if (table !== 'service_estimates') throw new Error(`unexpected table ${table}`);
    const filters: Array<{ op: 'eq' | 'is'; col: string; val: unknown }> = [];
    let patch: Record<string, any> | null = null;
    let inserting: Record<string, any> | null = null;
    let mode: 'idle' | 'update' | 'insert' | 'select' = 'idle';

    const api: any = {
      update(body: Record<string, any>) {
        mode = 'update';
        patch = { ...body };
        return api;
      },
      insert(body: Record<string, any>) {
        mode = 'insert';
        inserting = { ...body };
        return api;
      },
      select() {
        if (mode === 'idle') mode = 'select';
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push({ op: 'eq', col, val });
        return api;
      },
      is(col: string, val: unknown) {
        filters.push({ op: 'is', col, val });
        return api;
      },
      maybeSingle: async () => {
        ops.push('select');
        const found = match();
        return { data: found[0] || null, error: null };
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve()
          .then(() => execute())
          .then(onFulfilled, onRejected);
      },
    };

    function match() {
      return rows.filter((row) =>
        filters.every((filter) => {
          const value = (row as Record<string, unknown>)[filter.col];
          if (filter.op === 'is') return value == null;
          return String(value) === String(filter.val);
        })
      );
    }

    function execute() {
      if (mode === 'update' && patch) {
        const missingCol = Object.keys(patch).find((key) => missing.has(key));
        ops.push(missingCol ? `update-missing:${missingCol}` : 'update');
        if (missingCol) {
          return {
            data: null,
            error: {
              message: `Could not find the '${missingCol}' column of 'service_estimates' in the schema cache`,
            },
          };
        }
        const found = match();
        if (!found.length) return { data: [], error: null };
        Object.assign(found[0], patch);
        return { data: [{ id: found[0].id }], error: null };
      }
      if (mode === 'insert' && inserting) {
        ops.push('insert');
        const dup = rows.find(
          (row) =>
            String(row.organization_id) === String(inserting!.organization_id) &&
            row.estimate_number === inserting!.estimate_number
        );
        if (dup) {
          return {
            data: null,
            error: {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "service_estimates_org_number_uidx"',
            },
          };
        }
        const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1;
        rows.push({
          id,
          organization_id: inserting.organization_id,
          estimate_number: inserting.estimate_number,
          status: inserting.status || 'draft',
          total: inserting.total,
        });
        return { data: [{ id }], error: null };
      }
      ops.push('select');
      return { data: match(), error: null };
    }

    return api;
  }

  return { from, rows, ops };
}

test('finalize after a saved draft updates that id and does not insert', async () => {
  const db = memoryEstimates([
    {
      id: 24,
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-01',
      status: 'draft',
      total: 100,
    },
  ]);
  const saved = await persistServiceEstimate(
    db,
    {
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-01',
      status: 'draft',
      total: 685.13,
      customer_name: 'QA TEST Customer 1005',
    },
    24
  );
  assert.equal(saved.error, null);
  assert.equal(saved.id, 24);
  assert.equal(db.rows[0].total, 685.13);
  assert.equal(db.rows[0].status, 'draft');
  assert.equal(db.ops.includes('insert'), false);

  let sends = 0;
  let statusWhenSent: string | null = null;
  const delivery = await finalizeEstimateDelivery({
    client: db,
    estimateId: 24,
    row: { status: db.rows[0].status },
    send: async () => {
      sends += 1;
      statusWhenSent = db.rows[0].status;
      return { ok: true, id: 'email_1' };
    },
  });
  assert.equal(delivery.ok, true);
  if (delivery.ok) {
    assert.equal(delivery.emailed, true);
    assert.equal(delivery.alreadySent, false);
    assert.equal(delivery.providerId, 'email_1');
  }
  assert.equal(sends, 1);
  assert.equal(statusWhenSent, 'pending');
  assert.equal(db.rows[0].status, 'pending');
  assert.equal(db.rows.length, 1);
  assert.equal(db.ops.includes('insert'), false);
});

test('a duplicate estimate number adopts the existing draft instead of 409', async () => {
  const db = memoryEstimates([
    {
      id: 26,
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-02',
      status: 'draft',
      total: 50,
    },
  ]);
  const saved = await persistServiceEstimate(
    db,
    {
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-02',
      status: 'draft',
      total: 80,
      created_by: 'user-1',
    },
    null
  );
  assert.equal(saved.error, null);
  assert.equal(saved.id, 26);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].total, 80);
  assert.equal(db.rows[0].status, 'draft');
  assert.deepEqual(
    db.ops.filter((op) => op === 'insert' || op === 'update'),
    ['insert', 'update']
  );
});

test('adopting a sent estimate does not reopen it as a draft', async () => {
  const db = memoryEstimates([
    {
      id: 24,
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-01',
      status: 'pending',
      total: 100,
    },
  ]);
  const saved = await persistServiceEstimate(
    db,
    {
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-01',
      status: 'draft',
      total: 120,
    },
    null
  );
  assert.equal(saved.error, null);
  assert.equal(saved.id, 24);
  assert.equal(db.rows[0].status, 'pending');
  assert.equal(db.rows[0].total, 120);
  assert.equal(db.rows.length, 1);

  let sends = 0;
  const delivery = await finalizeEstimateDelivery({
    client: db,
    estimateId: 24,
    row: { status: db.rows[0].status },
    send: async () => {
      sends += 1;
      return { ok: true, id: 'email_again' };
    },
  });
  assert.equal(delivery.ok, true);
  if (delivery.ok) assert.equal(delivery.alreadySent, true);
  assert.equal(sends, 0);
});

test('repeat finalize does not send a second email or insert', async () => {
  const db = memoryEstimates([
    {
      id: 28,
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-03',
      status: 'draft',
    },
  ]);
  let sends = 0;
  const first = await finalizeEstimateDelivery({
    client: db,
    estimateId: 28,
    row: { status: 'draft' },
    send: async () => {
      sends += 1;
      return { ok: true, id: 'email_1' };
    },
  });
  assert.equal(first.ok, true);
  assert.equal(db.rows[0].status, 'pending');

  const second = await finalizeEstimateDelivery({
    client: db,
    estimateId: 28,
    row: { status: db.rows[0].status },
    send: async () => {
      sends += 1;
      return { ok: true, id: 'email_2' };
    },
  });
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.alreadySent, true);
    assert.equal(second.emailed, false);
  }
  assert.equal(sends, 1);
  assert.equal(db.rows.length, 1);
  assert.equal(db.ops.includes('insert'), false);
});

test('a lost race after the row is already pending does not send', async () => {
  const db = memoryEstimates([
    {
      id: 24,
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-01',
      status: 'pending',
    },
  ]);
  let sends = 0;
  const delivery = await finalizeEstimateDelivery({
    client: db,
    estimateId: 24,
    row: { status: 'draft' },
    send: async () => {
      sends += 1;
      return { ok: true, id: 'email_late' };
    },
  });
  assert.equal(delivery.ok, true);
  if (delivery.ok) assert.equal(delivery.alreadySent, true);
  assert.equal(sends, 0);
  assert.equal(db.rows[0].status, 'pending');
});

test('provider failure restores draft so a later finalize can send once', async () => {
  const db = memoryEstimates([
    {
      id: 24,
      organization_id: 2639,
      estimate_number: 'QAL-EST-20261005-01',
      status: 'draft',
    },
  ]);
  let sends = 0;
  const failed = await finalizeEstimateDelivery({
    client: db,
    estimateId: 24,
    row: { status: 'draft' },
    send: async () => {
      sends += 1;
      return { ok: false, error: 'Email provider error (502)' };
    },
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.error, /provider error/);
  assert.equal(db.rows[0].status, 'draft');
  assert.equal(sends, 1);

  const retried = await finalizeEstimateDelivery({
    client: db,
    estimateId: 24,
    row: { status: db.rows[0].status },
    send: async () => {
      sends += 1;
      return { ok: true, id: 'email_retry' };
    },
  });
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.emailed, true);
  assert.equal(sends, 2);
  assert.equal(db.rows[0].status, 'pending');
});

test('missing sent_at column still marks the existing row pending', async () => {
  const db = memoryEstimates(
    [
      {
        id: 24,
        organization_id: 2639,
        estimate_number: 'QAL-EST-20261005-01',
        status: 'draft',
      },
    ],
    { missingColumns: ['sent_at'] }
  );
  let statusWhenSent: string | null = null;
  const delivery = await finalizeEstimateDelivery({
    client: db,
    estimateId: 24,
    row: { status: 'draft' },
    send: async () => {
      statusWhenSent = db.rows[0].status;
      return { ok: true, id: 'email_1' };
    },
  });
  assert.equal(delivery.ok, true);
  assert.equal(statusWhenSent, 'pending');
  assert.ok(db.ops.includes('update-missing:sent_at'));
  assert.ok(db.ops.includes('update'));
  assert.equal(db.ops.includes('insert'), false);
});

test('finalize payload does not downgrade a sent row back to draft', () => {
  const payload = { status: 'draft', estimate_number: 'QAL-EST-20261005-01', total: 10 };
  const inserted = estimateWritePayload(payload, null, { preserveStatus: true });
  assert.equal(inserted.status, 'draft');
  const updated = estimateWritePayload(payload, 24, { preserveStatus: true });
  assert.equal('status' in updated, false);
  assert.equal(updated.estimate_number, 'QAL-EST-20261005-01');
  assert.equal(payload.status, 'draft');
});

test('rejected estimates cannot convert to an invoice', () => {
  assert.equal(canConvertEstimateToInvoice({ status: 'draft' }), true);
  assert.equal(canConvertEstimateToInvoice({ status: 'pending' }), true);
  assert.equal(
    canConvertEstimateToInvoice({ status: 'pending', customer_action: 'approved' }),
    true
  );
  assert.equal(
    canConvertEstimateToInvoice({ status: 'pending', customer_action: 'rejected' }),
    false
  );
  assert.equal(
    canConvertEstimateToInvoice({
      status: 'sent',
      estimate_data: { customer_action: 'rejected' },
    }),
    false
  );
  assert.equal(canConvertEstimateToInvoice({ status: 'invoiced' }), false);
  assert.equal(canConvertEstimateToInvoice({ status: 'expired' }), false);
  assert.equal(canConvertEstimateToInvoice({ status: 'cancelled' }), false);
});

test('estimate form finalizes by id and the send route marks sent before mail', () => {
  const form = readFileSync(join(here, '../../app/estimates/new/EstimateFormClient.tsx'), 'utf8');
  assert.match(form, /savedIdRef/);
  assert.match(form, /persistServiceEstimate/);
  assert.match(form, /canConvertEstimateToInvoice/);
  const finalizeStart = form.indexOf('async function finalizeAndEmailEstimate');
  const finalizeEnd = form.indexOf('function markSentWithoutEmail');
  const finalize = form.slice(finalizeStart, finalizeEnd);
  assert.match(finalize, /preserveStatus:\s*true/);
  assert.match(finalize, /sendBillingDocEmail/);
  assert.match(finalize, /alreadySent/);
  assert.doesNotMatch(finalize, /saveEstimate\(\s*['"]pending['"]/);

  const list = readFileSync(join(here, '../../app/estimates/page.tsx'), 'utf8');
  assert.match(list, /canConvertEstimateToInvoice/);

  const route = readFileSync(join(here, '../../app/api/billing/send-estimate/route.ts'), 'utf8');
  const claimAt = route.indexOf('finalizeEstimateDelivery');
  const mailAt = route.indexOf('https://api.resend.com/emails');
  assert.ok(claimAt >= 0 && mailAt > claimAt);
  assert.match(route, /alreadySent/);
  assert.doesNotMatch(route, /\.insert\(/);
});
