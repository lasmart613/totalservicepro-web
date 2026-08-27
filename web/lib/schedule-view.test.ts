import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UNASSIGNED_ASSIGNEE,
  UNASSIGNED_COLOR,
  assigneeColor,
  buildAssigneeColorMap,
  buildScheduleLegend,
  filterTicketsByLegend,
  filterTicketsByOrg,
  filterTicketsForScheduleRole,
  ticketAssigneeId,
  toggleLegendFilter,
} from './schedule-view.ts';

const TICKETS = [
  { id: 1, organization_id: 10, assigned_to: 'fse-a', title: 'A' },
  { id: 2, organization_id: 10, assigned_to: 'fse-b', title: 'B' },
  { id: 3, organization_id: 10, assigned_to: null, title: 'Open' },
  { id: 4, organization_id: 99, assigned_to: 'fse-a', title: 'Other shop' },
];

test('ticket assignee prefers assigned_to and falls back to assigned_fse', () => {
  assert.equal(ticketAssigneeId({ assigned_to: 'u1' }), 'u1');
  assert.equal(ticketAssigneeId({ assigned_to: null, assigned_fse: 'u2' }), 'u2');
  assert.equal(ticketAssigneeId({ assigned_to: '', assigned_to_fse: 'u3' }), 'u3');
  assert.equal(ticketAssigneeId({ assigned_to: null }), null);
});

test('org filter never returns another shop ticket', () => {
  const mine = filterTicketsByOrg(TICKETS, 10);
  assert.deepEqual(
    mine.map((t) => t.id),
    [1, 2, 3]
  );
  assert.equal(
    mine.some((t) => t.organization_id === 99),
    false
  );
});

test('FSE schedule is only tickets assigned to that FSE', () => {
  const mine = filterTicketsForScheduleRole(filterTicketsByOrg(TICKETS, 10), {
    role: 'fse',
    userId: 'fse-a',
  });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, 1);

  const tech = filterTicketsForScheduleRole(filterTicketsByOrg(TICKETS, 10), {
    role: 'technician',
    userId: 'fse-b',
  });
  assert.equal(tech.length, 1);
  assert.equal(tech[0].id, 2);
});

test('admin / scheduler / dispatcher / owner see assigned and unassigned', () => {
  for (const role of ['admin', 'company_admin', 'scheduler', 'dispatcher', 'owner']) {
    const all = filterTicketsForScheduleRole(filterTicketsByOrg(TICKETS, 10), {
      role,
      userId: 'boss',
    });
    assert.equal(all.length, 3, role);
    assert.equal(all.some((t) => !t.assigned_to), true, role);
  }
});

test('unassigned tickets have a distinct color from assigned FSEs', () => {
  const a = assigneeColor('fse-a');
  const b = assigneeColor('fse-b');
  assert.notEqual(a, UNASSIGNED_COLOR);
  assert.notEqual(b, UNASSIGNED_COLOR);
  assert.equal(assigneeColor(null), UNASSIGNED_COLOR);
  assert.equal(assigneeColor('fse-a'), a);
});

/** These UUIDs collide under the old standalone hash (`h * 31 + charCode` % 10). */
const HASH_COLLISION_A = '00000000-1111-4111-8111-111111111111';
const HASH_COLLISION_B = '00000008-1111-4111-8111-111111111111';

function oldHashPaletteIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % 10;
}

test('ids that collide under the old hash get different colors when assigned together', () => {
  assert.equal(oldHashPaletteIndex(HASH_COLLISION_A), oldHashPaletteIndex(HASH_COLLISION_B));
  assert.equal(assigneeColor(HASH_COLLISION_A), assigneeColor(HASH_COLLISION_B));

  const colorMap = buildAssigneeColorMap([HASH_COLLISION_A, HASH_COLLISION_B]);
  const a = assigneeColor(HASH_COLLISION_A, colorMap);
  const b = assigneeColor(HASH_COLLISION_B, colorMap);
  assert.notEqual(a, b);
  assert.notEqual(a, UNASSIGNED_COLOR);
  assert.notEqual(b, UNASSIGNED_COLOR);

  const legend = buildScheduleLegend(
    [
      { assigned_to: HASH_COLLISION_A },
      { assigned_to: HASH_COLLISION_B },
    ],
    [
      { id: HASH_COLLISION_A, name: 'Larry Smart' },
      { id: HASH_COLLISION_B, name: 'Tony Martin' },
    ]
  );
  const larry = legend.find((i) => i.id === HASH_COLLISION_A);
  const tony = legend.find((i) => i.id === HASH_COLLISION_B);
  assert.ok(larry && tony);
  assert.notEqual(larry?.color, tony?.color);
  assert.equal(larry?.color, a);
  assert.equal(tony?.color, b);
  assert.equal(legend.find((i) => i.id === UNASSIGNED_ASSIGNEE)?.color, UNASSIGNED_COLOR);
});

test('more FSEs than the fixed palette still get unique colors', () => {
  const ids = Array.from({ length: 16 }, (_, i) => `fse-${String(i).padStart(2, '0')}`);
  const colorMap = buildAssigneeColorMap(ids);
  const colors = ids.map((id) => assigneeColor(id, colorMap));
  assert.equal(new Set(colors).size, ids.length);
  assert.equal(colors.some((c) => c.toLowerCase() === UNASSIGNED_COLOR), false);
});

test('legend lists FSEs plus Unassigned and click-to-filter toggles', () => {
  const shop = filterTicketsByOrg(TICKETS, 10);
  const legend = buildScheduleLegend(shop, [
    { id: 'fse-a', name: 'Alex Tech' },
    { id: 'fse-b', name: 'Blake Tech' },
  ]);
  assert.equal(legend.some((i) => i.id === 'fse-a' && i.name === 'Alex Tech'), true);
  const un = legend.find((i) => i.id === UNASSIGNED_ASSIGNEE);
  assert.ok(un);
  assert.equal(un?.name, 'Unassigned');
  assert.equal(un?.color, UNASSIGNED_COLOR);

  const onlyA = filterTicketsByLegend(shop, 'fse-a');
  assert.deepEqual(
    onlyA.map((t) => t.id),
    [1]
  );
  const open = filterTicketsByLegend(shop, UNASSIGNED_ASSIGNEE);
  assert.deepEqual(
    open.map((t) => t.id),
    [3]
  );
  assert.equal(toggleLegendFilter(null, 'fse-a'), 'fse-a');
  assert.equal(toggleLegendFilter('fse-a', 'fse-a'), null);
  assert.equal(toggleLegendFilter('fse-a', 'all'), null);
});

test('schedule page uses role filter, FSE colors, and an All control', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  assert.match(src, /filterTicketsForScheduleRole/);
  assert.match(src, /buildScheduleLegend/);
  assert.match(src, /canSeeAllShopTickets/);
  assert.match(src, /legendFilter/);
  assert.match(src, /Unassigned/);
  assert.match(src, /assigneeColor/);
  assert.match(src, /buildAssigneeColorMap/);
  assert.match(src, /colorFor/);
  assert.doesNotMatch(src, /organization_id\.eq\.\$\{oId\},assigned_to\.eq\.\$\{user\.id\}/);
});
