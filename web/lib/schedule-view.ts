/**
 * Schedule visibility + calendar color helpers.
 * Tickets use service_tickets.assigned_to (assigned_fse is a read alias if present).
 */

import { canSeeAllShopTickets } from './roles.ts';

export const UNASSIGNED_ASSIGNEE = '__unassigned__';

/** Distinct from FSE palette — shop stock / no assignee. */
export const UNASSIGNED_COLOR = '#64748b';

const FSE_PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#f97316',
  '#a855f7',
  '#06b6d4',
  '#e11d48',
  '#84cc16',
  '#14b8a6',
  '#f59e0b',
  '#6366f1',
] as const;

export type AssigneeColorMap = ReadonlyMap<string, string>;

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function extraAssigneeColor(extraIndex: number, used: Set<string>): string {
  for (let attempt = 0; attempt < 720; attempt++) {
    const hue = (extraIndex * 137.508 + attempt * 11 + 19) % 360;
    const sat = 62 + ((extraIndex + attempt) % 4) * 7;
    const light = 38 + ((extraIndex + attempt) % 3) * 8;
    const hex = hslToHex(hue, sat, light);
    if (!used.has(hex.toLowerCase())) return hex;
  }
  return hslToHex((extraIndex * 47) % 360, 70, 40);
}

/** Unique colors for the FSEs currently on the shop schedule (stable input order). */
export function buildAssigneeColorMap(
  ids: Iterable<string | null | undefined>
): Map<string, string> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || id === UNASSIGNED_ASSIGNEE || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  const used = new Set<string>([UNASSIGNED_COLOR.toLowerCase()]);
  const map = new Map<string, string>();
  unique.forEach((id, i) => {
    let color: string;
    if (i < FSE_PALETTE.length) {
      color = FSE_PALETTE[i];
    } else {
      color = extraAssigneeColor(i - FSE_PALETTE.length, used);
    }
    used.add(color.toLowerCase());
    map.set(id, color);
  });
  return map;
}

function hashPaletteColor(assigneeId: string): string {
  let h = 0;
  for (let i = 0; i < assigneeId.length; i++) {
    h = (h * 31 + assigneeId.charCodeAt(i)) >>> 0;
  }
  return FSE_PALETTE[h % FSE_PALETTE.length];
}

export type TicketAssigneeLike = {
  assigned_to?: unknown;
  assigned_fse?: unknown;
  assigned_to_fse?: unknown;
  organization_id?: unknown;
};

export function ticketAssigneeId(ticket: TicketAssigneeLike | null | undefined): string | null {
  if (!ticket) return null;
  for (const raw of [ticket.assigned_to, ticket.assigned_fse, ticket.assigned_to_fse]) {
    const s = String(raw ?? '').trim();
    if (s) return s;
  }
  return null;
}

export function assigneeColor(
  assigneeId: string | null | undefined,
  colorMap?: AssigneeColorMap | null
): string {
  if (!assigneeId || assigneeId === UNASSIGNED_ASSIGNEE) return UNASSIGNED_COLOR;
  const mapped = colorMap?.get(assigneeId);
  if (mapped) return mapped;
  return hashPaletteColor(assigneeId);
}

export function sameOrgId(
  left: unknown,
  right: unknown
): boolean {
  if (left == null || right == null || left === '' || right === '') return false;
  return String(left) === String(right);
}

/** Keep tickets inside the active shop. Never mix other orgs. */
export function filterTicketsByOrg<T extends { organization_id?: unknown }>(
  tickets: T[],
  orgId: unknown
): T[] {
  if (orgId == null || orgId === '') return tickets;
  return tickets.filter((t) => sameOrgId(t.organization_id, orgId));
}

/**
 * FSE / technician: only tickets assigned to them.
 * Shop leads: all org tickets (assigned or unassigned).
 * Unknown roles fail closed (personal schedule only) so we do not leak the shop board.
 */
export function filterTicketsForScheduleRole<T extends TicketAssigneeLike>(
  tickets: T[],
  opts: { role?: string | null; userId?: string | null }
): T[] {
  if (canSeeAllShopTickets(opts.role)) return tickets;
  const uid = String(opts.userId || '').trim();
  if (!uid) return [];
  return tickets.filter((t) => ticketAssigneeId(t) === uid);
}

export function filterTicketsByLegend<T extends TicketAssigneeLike>(
  tickets: T[],
  legendFilter: string | null | undefined
): T[] {
  if (!legendFilter) return tickets;
  if (legendFilter === UNASSIGNED_ASSIGNEE) {
    return tickets.filter((t) => !ticketAssigneeId(t));
  }
  return tickets.filter((t) => ticketAssigneeId(t) === legendFilter);
}

export type ScheduleLegendItem = {
  id: string;
  name: string;
  color: string;
  count: number;
};

export type ScheduleRosterMember = {
  id: string;
  name: string;
  role?: string | null;
};

/**
 * Legend: each FSE on the roster (or with tickets) + Unassigned.
 * Clickable ids are member uuid or UNASSIGNED_ASSIGNEE.
 */
export function buildScheduleLegend(
  tickets: TicketAssigneeLike[],
  roster: ScheduleRosterMember[]
): ScheduleLegendItem[] {
  const counts = new Map<string, number>();
  for (const t of tickets) {
    const id = ticketAssigneeId(t) || UNASSIGNED_ASSIGNEE;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const seen = new Set<string>();
  const items: ScheduleLegendItem[] = [];

  const add = (id: string, name: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({
      id,
      name,
      color: UNASSIGNED_COLOR,
      count: counts.get(id) || 0,
    });
  };

  for (const m of roster) {
    if (m?.id) add(String(m.id), m.name || 'FSE');
  }
  for (const [id] of counts) {
    if (id === UNASSIGNED_ASSIGNEE) continue;
    if (!seen.has(id)) add(id, 'FSE');
  }

  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const colorMap = buildAssigneeColorMap(items.map((item) => item.id));
  for (const item of items) {
    item.color = colorMap.get(item.id) || UNASSIGNED_COLOR;
  }
  items.push({
    id: UNASSIGNED_ASSIGNEE,
    name: 'Unassigned',
    color: UNASSIGNED_COLOR,
    count: counts.get(UNASSIGNED_ASSIGNEE) || 0,
  });
  return items;
}

export function toggleLegendFilter(
  current: string | null,
  clicked: string
): string | null {
  if (!clicked || clicked === 'all') return null;
  return current === clicked ? null : clicked;
}
