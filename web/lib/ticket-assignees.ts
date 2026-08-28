/**
 * Shop roster for ticket assignment (service-company FSEs / team members).
 * Used by New Service Call and Edit Ticket.
 */

export type TicketAssignee = { id: string; name: string; role: string; email?: string };

const ASSIGNABLE_ROLES = new Set([
  'fse',
  'engineer',
  'technician',
  'service_manager',
  'admin',
  'company_admin',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeUuid(val: unknown): boolean {
  return UUID_RE.test(String(val || '').trim());
}

/** Prefer assigned_to when it is a real user id; else assigned_fse (CHAR(3) leftover). */
export function ticketAssigneeId(
  row: { assigned_to?: unknown; assigned_fse?: unknown } | null | undefined
): string {
  const primary = String(row?.assigned_to ?? '').trim();
  if (looksLikeUuid(primary)) return primary;
  const fallback = String(row?.assigned_fse ?? '').trim();
  if (looksLikeUuid(fallback)) return fallback;
  return '';
}

/**
 * Write both columns. insert/updateOmittingCharOverflow drops assigned_to if it is
 * still CHAR(3), and drops assigned_fse if the migration has not been applied.
 */
export function applyTicketAssignee(
  payload: Record<string, unknown>,
  assigneeId: string | null | undefined
): void {
  const id = String(assigneeId || '').trim();
  if (!id) {
    payload.assigned_to = null;
    payload.assigned_fse = null;
    return;
  }
  payload.assigned_to = id;
  payload.assigned_fse = id;
}

export function memberDisplayName(m: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email || 'Team member';
}

export function isAssignableMember(
  m: { id?: unknown; role?: unknown } | null | undefined,
  meId?: string | null
): boolean {
  if (!m?.id) return false;
  if (meId && String(m.id) === String(meId)) return true;
  return ASSIGNABLE_ROLES.has(String(m.role || '').toLowerCase());
}

export function toAssigneeOpt(m: {
  id?: unknown;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  role?: string | null;
}): TicketAssignee {
  const email = String(m.email || '').trim();
  return {
    id: String(m.id),
    name: memberDisplayName(m),
    role: String(m.role || 'fse'),
    ...(email ? { email } : {}),
  };
}

export function sortTicketAssignees(
  opts: TicketAssignee[],
  meId?: string | null
): TicketAssignee[] {
  return [...opts].sort((a, b) => {
    if (meId && a.id === meId) return -1;
    if (meId && b.id === meId) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function assigneeName(
  assignees: TicketAssignee[],
  id: string | null | undefined,
  fallback = 'Unassigned'
): string {
  const key = String(id || '').trim();
  if (!key) return fallback;
  return assignees.find((a) => a.id === key)?.name || fallback;
}

export async function fetchShopMembers(
  supabase: any,
  orgId: number | string | null
): Promise<any[]> {
  let members: any[] = [];
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (token) {
      const res = await fetch('/api/team/list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        if (Array.isArray(json.members)) members = json.members;
      }
    }
  } catch (e) {
    console.warn('ticket assignees api', e);
  }
  if (!members.length && orgId != null) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, email, role')
      .eq('organization_id', orgId);
    if (error) console.warn('ticket assignees', error.message);
    members = data || [];
  }
  return members;
}

export async function loadTicketAssignees(
  supabase: any,
  opts: {
    orgId: number | string | null;
    meId?: string | null;
    selfName?: string;
    selfRole?: string;
    selfEmail?: string;
    keepIds?: Array<string | null | undefined>;
  }
): Promise<TicketAssignee[]> {
  const { orgId, meId = null, selfName = '', selfRole = '', selfEmail = '', keepIds = [] } = opts;
  if (orgId == null && !meId) return [];

  const members = orgId != null ? await fetchShopMembers(supabase, orgId) : [];
  const keep = new Set(keepIds.map((id) => String(id || '').trim()).filter(Boolean));

  const seen = new Set<string>();
  const optsOut: TicketAssignee[] = [];
  for (const m of members) {
    if (!m?.id) continue;
    const id = String(m.id);
    if (seen.has(id)) continue;
    if (!isAssignableMember(m, meId) && !keep.has(id)) continue;
    seen.add(id);
    optsOut.push(toAssigneeOpt(m));
  }

  if (meId && !optsOut.some((o) => o.id === meId)) {
    const email = String(selfEmail || '').trim();
    optsOut.unshift({
      id: meId,
      name: selfName || 'Me',
      role: selfRole || 'fse',
      ...(email ? { email } : {}),
    });
  }

  return sortTicketAssignees(optsOut, meId);
}

/** Email only on first assign or a change to a different FSE — not re-save or unassign. */
export function shouldNotifyAssignee(opts: {
  previousId?: string | null;
  nextId?: string | null;
  actorId?: string | null;
}): boolean {
  const next = String(opts.nextId || '').trim();
  const prev = String(opts.previousId || '').trim();
  const actor = String(opts.actorId || '').trim();
  if (!next || !looksLikeUuid(next)) return false;
  if (next === prev) return false;
  if (actor && next === actor) return false;
  return true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Manual resend button: assigned FSE with an email on the shop roster. */
export function canEmailAssignedFse(
  assignees: TicketAssignee[],
  assignedId: string | null | undefined
): boolean {
  const id = String(assignedId || '').trim();
  if (!id || !looksLikeUuid(id)) return false;
  const email = String(assignees.find((a) => a.id === id)?.email || '').trim();
  return EMAIL_RE.test(email);
}

export async function notifyTicketAssignee(
  supabase: { auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> } },
  ticketId: unknown,
  assignedTo: string,
  opts?: { force?: boolean }
): Promise<{ emailed?: boolean; error?: string; skipped?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { emailed: false, error: 'Not signed in' };
  const res = await fetch('/api/tickets/notify-assignee', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ticketId,
      assignedTo,
      ...(opts?.force ? { force: true } : {}),
    }),
  });
  return res.json().catch(() => ({}));
}
