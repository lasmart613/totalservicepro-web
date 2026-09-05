import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ticketAssignHtml, ticketAssignSubject, ticketAssignText } from './ticket-assign-email.ts';

const copy = {
  assigneeFirstName: 'Tony',
  assignerName: 'Larry Smart',
  organizationName: 'Luxor Photonix',
  ticketNumber: 'LPX-TKT-20260825-01',
  title: 'Repair — Northshore Clinic',
  customerName: 'Northshore Clinic',
  customerPhone: '847-555-0100',
  serviceType: 'Repair',
  status: 'Scheduled',
  serviceDate: '2026-08-26',
  scheduledTime: '09:00',
  priority: 'High',
  addressLine: '100 Main, Evanston, IL',
  notes: 'No power on start.',
  ticketUrl: 'https://repairplanet.net/service-tickets/99',
};

test('assignment email names the shop, ticket, and FSE', () => {
  const subject = ticketAssignSubject(copy);
  assert.match(subject, /Luxor Photonix/);
  assert.match(subject, /LPX-TKT-20260825-01/);
  assert.match(subject, /Northshore Clinic/);

  const text = ticketAssignText(copy);
  assert.match(text, /Hi Tony/);
  assert.match(text, /Larry Smart/);
  assert.match(text, /Job: Repair — Northshore Clinic/);
  assert.match(text, /Phone: 847-555-0100/);
  assert.match(text, /Status: Scheduled/);
  assert.match(text, /Open ticket: https:\/\/repairplanet\.net\/service-tickets\/99/);
  assert.doesNotMatch(text, /Northshore Clinic invited you/);

  const html = ticketAssignHtml(copy);
  assert.match(html, /Open ticket/);
  assert.match(html, /No power on start/);
  assert.match(html, /847-555-0100/);
  assert.match(html, /Scheduled/);
  assert.match(html, /https:\/\/repairplanet\.net\/service-tickets\/99/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /Create your free account|Sign in to claim/i);
});

test('creating a ticket notifies the assigned FSE', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const schedule = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  const assignLib = readFileSync(join(here, './ticket-assignees.ts'), 'utf8');
  assert.match(schedule, /shouldNotifyAssignee/);
  assert.match(assignLib, /\/api\/tickets\/notify-assignee/);
  const edit = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(edit, /shouldNotifyAssignee/);
  const route = readFileSync(join(here, '../app/api/tickets/notify-assignee/route.ts'), 'utf8');
  assert.match(route, /sendTicketAssignedEmail/);
  assert.match(route, /publicSiteOrigin/);
  assert.match(route, /ticket_assigned/);
  assert.match(route, /customerPhone|customer_phone/);
  assert.match(route, /skipped: 'self'/);
  assert.match(route, /userClient/);
  assert.match(route, /Assignee is not on this shop/);
  assert.doesNotMatch(route, /hasServiceRole\(\) \? getSupabaseAdmin\(\) : userClient;\s*\n\s*const \{ data: ticket/);
});

test('manual resend can email the assigned FSE including self', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const route = readFileSync(join(here, '../app/api/tickets/notify-assignee/route.ts'), 'utf8');
  assert.match(route, /body\.force === true/);
  assert.match(route, /sameId\(assigneeId, user\.id\) && !force/);
  assert.match(route, /sendTicketAssignedEmail/);
  const assignLib = readFileSync(join(here, './ticket-assignees.ts'), 'utf8');
  assert.match(assignLib, /force \? \{ force: true \}/);
  const edit = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(edit, /Email ticket to FSE/);
  assert.match(edit, /canEmailAssignedFse/);
  assert.match(edit, /force:\s*true/);
});
