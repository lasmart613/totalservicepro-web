import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CustomerLocation } from './customer-locations.ts';
import {
  equipmentLocationLabel,
  equipmentRemoveMessage,
  equipmentSaveMessage,
  equipmentWriteRow,
  linksForEquipment,
  loadCustomerEquipmentRecords,
  removalMode,
  removeCustomerEquipmentRecord,
  saveCustomerEquipmentRecord,
  scheduleEquipmentQuery,
  ticketPatchFromSavedEquipment,
} from './customer-equipment-record.ts';

const here = dirname(fileURLToPath(import.meta.url));

function loc(partial: Partial<CustomerLocation> & Pick<CustomerLocation, 'id' | 'name'>): CustomerLocation {
  return {
    address: null,
    city: null,
    state: null,
    zip: null,
    phone: null,
    contact_name: null,
    is_primary: false,
    ...partial,
  };
}

type Row = Record<string, any>;

function memory(seed?: { equipment?: Row[]; tickets?: Row[]; reports?: Row[] }) {
  const tables: Record<string, Row[]> = {
    equipment: [...(seed?.equipment || [])],
    service_tickets: [...(seed?.tickets || [])],
    service_reports: [...(seed?.reports || [])],
  };
  let nextId = 50;
  const client = {
    from(table: string) {
      const state: {
        op: 'select' | 'insert' | 'update' | 'delete';
        filters: { op: string; col: string; v: any }[];
        payload: any;
        cols: string;
      } = { op: 'select', filters: [], payload: null, cols: '*' };
      const matched = () => {
        let rows = tables[table] || [];
        for (const f of state.filters) {
          if (f.op === 'eq') rows = rows.filter((row) => String(row[f.col] ?? '') === String(f.v ?? ''));
          if (f.op === 'is' && f.v == null) rows = rows.filter((row) => row[f.col] == null);
        }
        return rows;
      };
      const project = (row: Row) => {
        if (!state.cols || state.cols === '*') return { ...row };
        const out: Row = {};
        for (const col of state.cols.split(',').map((part) => part.trim())) out[col] = row[col];
        return out;
      };
      const exec = () => {
        if (state.op === 'insert') {
          const row = { id: nextId++, ...(state.payload?.[0] || {}) };
          tables[table].push(row);
          return { data: { id: row.id }, error: null };
        }
        const rows = matched();
        if (state.op === 'update') {
          for (const row of rows) Object.assign(row, state.payload);
          return { data: rows[0] ? { id: rows[0].id } : null, error: null };
        }
        if (state.op === 'delete') {
          const ids = new Set(rows.map((row) => row.id));
          tables[table] = (tables[table] || []).filter((row) => !ids.has(row.id));
          return { data: rows[0] ? { id: rows[0].id } : null, error: null };
        }
        return { data: rows.map(project), error: null };
      };
      const q: any = {
        select(cols: string) {
          state.cols = cols;
          return q;
        },
        eq(col: string, v: any) {
          state.filters.push({ op: 'eq', col, v });
          return q;
        },
        is(col: string, v: any) {
          state.filters.push({ op: 'is', col, v });
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return Promise.resolve(exec());
        },
        insert(rows: Row[]) {
          state.op = 'insert';
          state.payload = rows;
          return q;
        },
        update(payload: Row) {
          state.op = 'update';
          state.payload = payload;
          return q;
        },
        delete() {
          state.op = 'delete';
          return q;
        },
        maybeSingle() {
          return Promise.resolve(exec());
        },
      };
      return q;
    },
  };
  return { client, tables };
}

test('write row keeps the customer and location and rejects sentinels', () => {
  const ok = equipmentWriteRow(2655, {
    equipment_type: 'laser',
    manufacturer: 'Candela',
    model: 'GentleMax Pro',
    serial: '  ',
    location_id: 12,
    install_date: '2024-05-01',
    warranty_or_contract: ' Contract A ',
    notes: 'Room 2',
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.row.customer_organization_id, 2655);
  assert.equal(ok.row.location_id, 12);
  assert.equal(ok.row.serial_number, null);
  assert.equal(ok.row.install_date, '2024-05-01');
  assert.equal(ok.row.warranty_or_contract, 'Contract A');
  assert.equal(ok.row.removed_at, null);
  assert.equal(equipmentWriteRow(2655, { manufacturer: '__other__', model: 'Z', serial: '1' }).ok, false);
  assert.equal(
    equipmentWriteRow(2655, { manufacturer: 'A', model: 'B', serial: '1', install_date: 'May 1' }).ok,
    false
  );
});

test('roster hides removed units and still saves against customer_organization_id', async () => {
  const { client, tables } = memory({
    equipment: [
      {
        id: 1,
        customer_organization_id: 2655,
        manufacturer: 'Candela',
        model: 'GentleMax Pro',
        serial_number: 'SN1',
        location_id: 3,
        install_date: '2024-01-02',
        warranty_or_contract: 'OEM 2027',
        notes: 'Left bay',
        removed_at: null,
      },
      {
        id: 2,
        customer_organization_id: 2655,
        manufacturer: 'Old',
        model: 'Unit',
        serial_number: 'GONE',
        removed_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  const list = await loadCustomerEquipmentRecords(client, 2655);
  assert.deepEqual(list.map((row) => row.id), [1]);
  assert.equal(list[0].install_date, '2024-01-02');
  assert.equal(list[0].warranty_or_contract, 'OEM 2027');
  assert.equal(list[0].location_id, 3);
  const saved = await saveCustomerEquipmentRecord(client, 2655, null, {
    manufacturer: 'Lumenis',
    model: 'UltraPulse',
    serial: 'UP-9',
    location_id: 3,
    install_date: '2023-11-04',
    warranty_or_contract: 'Contract 9',
    notes: 'Hall',
  });
  assert.equal(saved.status, 'saved');
  const inserted = tables.equipment.find((row) => row.serial_number === 'UP-9');
  assert.equal(inserted?.customer_organization_id, 2655);
  assert.equal(inserted?.location_id, 3);
  assert.equal(inserted?.warranty_or_contract, 'Contract 9');
});

test('same serial on a removed unit is restored and does not insert a second row', async () => {
  const { client, tables } = memory({
    equipment: [
      {
        id: 8,
        customer_organization_id: 2639,
        manufacturer: 'Candela',
        model: 'GentleMax',
        serial_number: 'SN-8',
        removed_at: '2026-02-01T00:00:00.000Z',
      },
    ],
  });
  const restored = await saveCustomerEquipmentRecord(client, 2639, null, {
    manufacturer: 'Candela',
    model: 'GentleMax Pro',
    serial: 'sn-8',
  });
  assert.deepEqual(restored, { status: 'restored', id: 8 });
  assert.equal(tables.equipment.length, 1);
  assert.equal(tables.equipment[0].removed_at, null);
  assert.equal(tables.equipment[0].model, 'GentleMax Pro');
  assert.equal(equipmentSaveMessage(restored), 'That serial was removed. It is back on this customer.');
});

test('an active serial is not duplicated', async () => {
  const { client, tables } = memory({
    equipment: [
      { id: 4, customer_organization_id: 2656, manufacturer: 'A', model: 'B', serial_number: 'DUP', removed_at: null },
    ],
  });
  const again = await saveCustomerEquipmentRecord(client, 2656, null, {
    manufacturer: 'A',
    model: 'C',
    serial: 'DUP',
  });
  assert.deepEqual(again, { status: 'exists', id: 4 });
  assert.equal(tables.equipment.length, 1);
  assert.equal(tables.equipment[0].model, 'B');
});

test('remove archives when a ticket or report is linked and deletes when nothing points at the row', async () => {
  assert.equal(removalMode(1, 0), 'archive');
  assert.equal(removalMode(0, 2), 'archive');
  assert.equal(removalMode(0, 0), 'delete');
  const { client, tables } = memory({
    equipment: [
      { id: 11, customer_organization_id: 2651, manufacturer: 'A', model: 'B', serial_number: 'H', removed_at: null },
      { id: 12, customer_organization_id: 2651, manufacturer: 'C', model: 'D', serial_number: 'N', removed_at: null },
    ],
    tickets: [{ id: 70, customer_organization_id: 2651, equipment_id: 11, ticket_number: 'T-70' }],
    reports: [{ id: 'rep-1', equipment_id: 11, report_number: 'SR-1' }],
  });
  const archived = await removeCustomerEquipmentRecord(client, 2651, 11);
  assert.equal(archived.status, 'archived');
  assert.equal(tables.equipment.find((row) => row.id === 11)?.removed_at != null, true);
  assert.equal(tables.service_tickets[0].equipment_id, 11);
  assert.equal(tables.service_reports[0].equipment_id, 11);
  assert.match(equipmentRemoveMessage(archived), /Tickets and reports still link/);
  const deleted = await removeCustomerEquipmentRecord(client, 2651, 12);
  assert.equal(deleted.status, 'deleted');
  assert.equal(tables.equipment.some((row) => row.id === 12), false);
  assert.equal(tables.service_tickets.length, 1);
});

test('ticket prefill copies make, model, serial, and the unit location', () => {
  const main = loc({
    id: 3,
    name: 'Main office',
    address: '1 HQ',
    city: 'Oakland',
    state: 'CA',
    zip: '94607',
    phone: '555-0100',
    contact_name: 'Ada',
    is_primary: true,
  });
  const suite = loc({
    id: 8,
    name: 'Surgery',
    address: '500 Site Rd',
    city: 'Berkeley',
    state: 'CA',
    zip: '94704',
    phone: '555-0199',
    contact_name: 'Bea',
  });
  const patch = ticketPatchFromSavedEquipment({
    equipment: {
      equipment_type: 'laser',
      manufacturer: 'Candela',
      model: 'GentleMax Pro',
      serial_number: 'SN-1',
      location_id: 8,
    },
    locations: [main, suite],
    current: {
      customer_address: 'old',
      customer_city: 'old',
      customer_state: 'TX',
      customer_zip: '00000',
      customer_phone: '1',
      customer_contact: 'old',
    },
  });
  assert.equal(patch.equipment_make, 'Candela');
  assert.equal(patch.equipment_model, 'GentleMax Pro');
  assert.equal(patch.serial_number, 'SN-1');
  assert.equal(patch.equipment_type, 'laser');
  assert.equal(patch.selectedLocationId, '8');
  assert.equal(patch.address?.customer_address, '500 Site Rd');
  assert.equal(patch.address?.customer_city, 'Berkeley');
  assert.equal(patch.address?.customer_state, 'CA');
  assert.equal(patch.address?.customer_zip, '94704');
  assert.equal(patch.address?.customer_phone, '555-0199');
  assert.equal(patch.address?.customer_contact, 'Bea');
  assert.equal(patch.address?.customer_location_id, 8);

  const unassigned = ticketPatchFromSavedEquipment({
    equipment: { manufacturer: 'Quanta', model: 'Q-Plus', serial_number: '', location_id: null },
    locations: [main],
    current: { customer_address: 'keep me', customer_city: 'Oakland', customer_state: 'CA', customer_zip: '94607', customer_phone: '1', customer_contact: 'Ada' },
  });
  assert.equal(unassigned.selectedLocationId, null);
  assert.equal(unassigned.address, null);
  assert.equal(equipmentLocationLabel(8, [main, suite]), 'Surgery · Berkeley, CA');
  assert.equal(equipmentLocationLabel(null, [main]), 'Unassigned');
});

test('schedule query and history links', () => {
  assert.equal(scheduleEquipmentQuery({ get: () => null }), null);
  assert.deepEqual(
    scheduleEquipmentQuery({
      get: (key) => (key === 'customer_id' ? '2655' : key === 'equipment_id' ? '11' : null),
    }),
    { customerId: '2655', equipmentId: '11' }
  );
  const links = linksForEquipment(
    { id: 11, serial_number: 'SN-1' },
    [
      { id: 70, equipment_id: 11, ticket_number: 'T-70', serial_number: 'other' },
      { id: 71, equipment_id: 99, ticket_number: 'T-71', serial_number: 'sn-1' },
      { id: 72, equipment_id: 99, ticket_number: 'T-72', serial_number: 'nope' },
    ],
    [{ id: 'r1', equipment_id: null, report_number: 'SR-1', serial_number: 'SN-1' }]
  );
  assert.deepEqual(links.tickets.map((row) => row.href), ['/service-tickets/70', '/service-tickets/71']);
  assert.deepEqual(links.reports.map((row) => row.label), ['SR-1']);
});

test('customer record reuses EquipmentCascadeFields and the new ticket form prefills location', () => {
  const page = readFileSync(join(here, '../app/customers/[id]/page.tsx'), 'utf8');
  const section = readFileSync(join(here, '../components/CustomerEquipmentSection.tsx'), 'utf8');
  const schedule = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  const migration = readFileSync(
    join(here, '../supabase/migrations/20261119_000964_customer_equipment_record.sql'),
    'utf8'
  );
  assert.match(page, /CustomerEquipmentSection/);
  assert.match(page, /loadCustomerEquipmentRecords/);
  assert.match(page, /customer_organization_id/);
  assert.doesNotMatch(page, /from\('equipment'\)[\s\S]{0,240}\.eq\('organization_id'/);
  assert.match(section, /EquipmentCascadeFields/);
  assert.match(section, /overflow-x-auto/);
  assert.match(section, /data-testid="customer-equipment-table"/);
  assert.match(section, /min-w-\[56rem\]/);
  assert.match(section, /Warranty or contract/);
  assert.match(section, /customer-eq-install/);
  assert.match(section, /service-schedule\?customer_id=/);
  assert.match(section, /ticket\.href/);
  assert.match(section, /report\.href/);
  const record = readFileSync(join(here, 'customer-equipment-record.ts'), 'utf8');
  assert.match(record, /\/service-tickets\/\$\{ticket\.id\}/);
  assert.match(record, /\/reports\/\$\{report\.id\}/);
  assert.doesNotMatch(section, /orgIsPaid|is_premium|subscription_tier/);
  assert.match(schedule, /ticketPatchFromSavedEquipment/);
  assert.match(schedule, /scheduleEquipmentQuery/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS install_date/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS warranty_or_contract/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS removed_at/);
  assert.match(migration, /refusing to create a second equipment table/);
  assert.doesNotMatch(migration, /CREATE TABLE/);
});
