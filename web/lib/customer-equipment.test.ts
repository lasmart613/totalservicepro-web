import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addEquipmentToCustomerOrg,
  canOfferAddToOrg,
  CUSTOMER_EQUIPMENT_COLUMNS,
  customerEquipmentLabel,
  loadCustomerEquipment,
  matchCustomerEquipment,
} from './customer-equipment.ts';

function fakeClient(opts: { rows?: any[]; selectError?: any; insertError?: any; insertData?: any }) {
  const calls: any[] = [];
  const client = {
    from(table: string) {
      const q: any = {
        _op: 'select',
        select(cols: string) {
          calls.push({ table, op: q._op, cols });
          return q;
        },
        eq(col: string, v: any) {
          calls.push({ table, op: 'eq', col, v });
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return Promise.resolve({ data: opts.selectError ? null : opts.rows || [], error: opts.selectError || null });
        },
        insert(rows: any[]) {
          q._op = 'insert';
          calls.push({ table, op: 'insert', rows });
          return q;
        },
        maybeSingle() {
          return Promise.resolve({
            data: opts.insertError ? null : opts.insertData ?? { id: 99 },
            error: opts.insertError || null,
          });
        },
      };
      return q;
    },
  };
  return { client, calls };
}

const rows = [
  { id: 1, equipment_type: 'laser', manufacturer: 'Candela', model: 'GentleMax Pro', serial_number: '9914-1234', notes: 'x' },
  { id: 2, equipment_type: 'beds', manufacturer: 'Midmark', model: 'Ritter 112', serial_number: 'V123' },
];

test('loads only safe columns for the picked org', async () => {
  const { client, calls } = fakeClient({ rows });
  const list = await loadCustomerEquipment(client, 2639);
  assert.equal(list.length, 2);
  assert.equal((list[0] as any).notes, undefined);
  assert.equal(calls[0].cols, CUSTOMER_EQUIPMENT_COLUMNS);
  assert.ok(!/notes|photo|room/.test(CUSTOMER_EQUIPMENT_COLUMNS));
  assert.deepEqual(calls[1], { table: 'equipment', op: 'eq', col: 'customer_organization_id', v: 2639 });
  assert.equal(list[1].equipment_type, 'beds');
});

test('no org or an RLS error gives an empty list', async () => {
  assert.deepEqual(await loadCustomerEquipment(fakeClient({ rows }).client, null), []);
  assert.deepEqual(await loadCustomerEquipment(fakeClient({ selectError: { message: 'denied' } }).client, 5), []);
});

test('label and serial matching', () => {
  const list = rows.map((r) => ({ ...r, equipment_type: r.equipment_type as any }));
  assert.equal(customerEquipmentLabel(list[1] as any), 'Midmark Ritter 112 — S/N V123');
  const d = { equipment_type: 'laser', manufacturer: 'Candela', model: 'GentleMax Pro', serial: ' 9914-1234 ' };
  assert.equal(matchCustomerEquipment(list as any, d)?.id, 1);
  assert.equal(canOfferAddToOrg(list as any, d, 2639), false);
  assert.equal(canOfferAddToOrg(list as any, { ...d, serial: 'NEW-1' }, 2639), true);
  assert.equal(canOfferAddToOrg(list as any, { ...d, serial: 'NEW-1' }, null), false);
  assert.equal(canOfferAddToOrg(list as any, { ...d, serial: '' }, 2639), false);
  assert.equal(canOfferAddToOrg(list as any, { ...d, model: '' }, 2639), false);
});

test('add inserts a new row with type and never updates', async () => {
  const { client, calls } = fakeClient({ rows });
  const r = await addEquipmentToCustomerOrg(client, 2639, {
    equipment_type: 'beds',
    manufacturer: 'Midmark',
    model: 'Ritter 204',
    serial: 'B-7',
  });
  assert.deepEqual(r, { status: 'created', id: 99 });
  const ins = calls.find((c) => c.op === 'insert');
  assert.deepEqual(ins.rows[0], {
    customer_organization_id: 2639,
    manufacturer: 'Midmark',
    model: 'Ritter 204',
    serial_number: 'B-7',
    equipment_type: 'beds',
  });
  assert.ok(!calls.some((c) => c.op === 'update'));
});

test('add returns exists for a serial already on file, without inserting', async () => {
  const { client, calls } = fakeClient({ rows });
  const r = await addEquipmentToCustomerOrg(client, 2639, {
    equipment_type: 'laser',
    manufacturer: 'Candela',
    model: 'GentleMax Pro',
    serial: '9914-1234',
  });
  assert.deepEqual(r, { status: 'exists', id: 1 });
  assert.ok(!calls.some((c) => c.op === 'insert'));
});

test('add skips incomplete or Other placeholder input', async () => {
  const { client } = fakeClient({ rows });
  assert.equal((await addEquipmentToCustomerOrg(client, 1, { equipment_type: 'laser', manufacturer: 'A', model: '', serial: 'x' })).status, 'skipped');
  assert.equal((await addEquipmentToCustomerOrg(client, 1, { equipment_type: 'laser', manufacturer: '__other__', model: 'b', serial: 'x' })).status, 'skipped');
  assert.equal((await addEquipmentToCustomerOrg(client, null, { equipment_type: 'laser', manufacturer: 'a', model: 'b', serial: 'x' })).status, 'skipped');
});

test('RLS refusal and duplicate are reported, not retried as transfer', async () => {
  const d = { equipment_type: 'laser', manufacturer: 'a', model: 'b', serial: 'x' };
  const rls = await addEquipmentToCustomerOrg(fakeClient({ rows: [], insertError: { code: '42501', message: 'new row violates row-level security policy' } }).client, 1, d);
  assert.deepEqual(rls, { status: 'failed', reason: 'not_allowed' });
  const dup = await addEquipmentToCustomerOrg(fakeClient({ rows: [], insertError: { code: '23505', message: 'duplicate key' } }).client, 1, d);
  assert.deepEqual(dup, { status: 'failed', reason: 'duplicate_serial' });
});
