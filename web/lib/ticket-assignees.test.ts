import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyTicketAssignee,
  assigneeName,
  isAssignableMember,
  looksLikeUuid,
  memberDisplayName,
  sortTicketAssignees,
  ticketAssigneeId,
  toAssigneeOpt,
} from './ticket-assignees.ts';
import { stripOverflowingAddressFields } from './char-overflow.ts';

const TONY = '22222222-2222-4222-8222-222222222222';
const LARRY = '11111111-1111-4111-8111-111111111111';

test('looksLikeUuid accepts user ids and rejects leftover CHAR(3)', () => {
  assert.equal(looksLikeUuid(TONY), true);
  assert.equal(looksLikeUuid('Lar'), false);
  assert.equal(looksLikeUuid(''), false);
  assert.equal(looksLikeUuid(null), false);
});

test('ticketAssigneeId prefers UUID assigned_to then assigned_fse', () => {
  assert.equal(ticketAssigneeId({ assigned_to: TONY, assigned_fse: LARRY }), TONY);
  assert.equal(ticketAssigneeId({ assigned_to: 'Lar', assigned_fse: TONY }), TONY);
  assert.equal(ticketAssigneeId({ assigned_to: '', assigned_fse: null }), '');
  assert.equal(ticketAssigneeId(null), '');
});

test('applyTicketAssignee writes both columns and allows clear', () => {
  const assigned: Record<string, unknown> = { customer_name: 'Clinic' };
  applyTicketAssignee(assigned, TONY);
  assert.equal(assigned.assigned_to, TONY);
  assert.equal(assigned.assigned_fse, TONY);

  const cleared: Record<string, unknown> = { assigned_to: TONY, assigned_fse: TONY };
  applyTicketAssignee(cleared, '');
  assert.equal(cleared.assigned_to, null);
  assert.equal(cleared.assigned_fse, null);
});

test('CHAR(3) retry drops assigned_to but keeps assigned_fse on the first omit', () => {
  const payload: Record<string, unknown> = {
    customer_name: 'Clinic',
    assigned_to: TONY,
    assigned_fse: TONY,
  };
  assert.equal(stripOverflowingAddressFields(payload, 3), 'assigned_to');
  assert.equal(payload.assigned_to, undefined);
  assert.equal(payload.assigned_fse, TONY);
});

test('loadTicketAssignees keeps shop FSEs and drops customer accounts', async () => {
  const { loadTicketAssignees } = await import('./ticket-assignees.ts');
  const members = [
    { id: TONY, first_name: 'Tony', last_name: 'Martin', role: 'fse', email: 'tony@shop.test' },
    { id: 'cust-1', first_name: 'Live', last_name: 'Customer', role: 'customer', email: 'owner@clinic.test' },
    { id: LARRY, first_name: 'Larry', last_name: 'Smart', role: 'admin', email: 'larry@shop.test' },
  ];
  const supabase = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from() {
      return {
        select() {
          return {
            eq: async () => ({ data: members, error: null }),
          };
        },
      };
    },
  };
  const opts = await loadTicketAssignees(supabase, { orgId: 12, meId: LARRY, selfName: 'Larry Smart' });
  assert.deepEqual(opts.map((o) => o.id).sort(), [LARRY, TONY].sort());
  assert.ok(!opts.some((o) => o.role === 'customer'));
});

test('shop FSEs and admins are assignable; customer accounts are not', () => {
  assert.equal(isAssignableMember({ id: TONY, role: 'fse' }), true);
  assert.equal(isAssignableMember({ id: LARRY, role: 'admin' }), true);
  assert.equal(isAssignableMember({ id: 'cust', role: 'customer' }), false);
  assert.equal(isAssignableMember({ id: 'cust', role: 'customer' }, 'cust'), true);
  assert.equal(memberDisplayName({ first_name: 'Tony', last_name: 'Martin' }), 'Tony Martin');
  assert.equal(toAssigneeOpt({ id: TONY, first_name: 'Tony', last_name: 'Martin', role: 'fse' }).name, 'Tony Martin');
  const sorted = sortTicketAssignees(
    [
      { id: TONY, name: 'Tony Martin', role: 'fse' },
      { id: LARRY, name: 'Larry Smart', role: 'admin' },
    ],
    LARRY
  );
  assert.equal(sorted[0].id, LARRY);
  assert.equal(assigneeName(sorted, TONY), 'Tony Martin');
  assert.equal(assigneeName(sorted, ''), 'Unassigned');
});

test('Edit Ticket has Assign to FSE and persist/reload', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const edit = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(edit, /Assign to FSE/);
  assert.match(edit, /AssignFseSelect/);
  assert.match(edit, /loadTicketAssignees/);
  assert.match(edit, /applyTicketAssignee/);
  assert.match(edit, /updateOmittingCharOverflow/);
  assert.match(edit, /assigned_fse/);
  assert.match(edit, /\/api\/team\/list|loadTicketAssignees/);
  assert.match(edit, /Unassigned/);
  assert.doesNotMatch(edit, /facebook|instagram|linkedin|twitter/i);
});

test('New Service Call writes assigned_fse and uses the shared FSE picker', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const schedule = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  assert.match(schedule, /Assign to FSE|AssignFseSelect/);
  assert.match(schedule, /applyTicketAssignee/);
  assert.match(schedule, /loadTicketAssignees/);
  assert.match(schedule, /insertOmittingCharOverflow/);
});

test('assigned_fse migration is uuid and does not reopen CHAR(3) toast work', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(here, '../supabase/migrations/20260827_000003_ticket_assigned_fse.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS assigned_fse uuid/);
  assert.match(sql, /assigned_to/);
  const edit = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(edit, /updateOmittingCharOverflow/);
});
