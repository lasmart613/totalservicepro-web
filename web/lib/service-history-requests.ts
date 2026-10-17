/**
 * Locked service history teaser + owner permission requests (migration 000922).
 *
 * Shop side: for a laser of a clinic the shop is linked to, the teaser lists
 * only (ref, title, service_date) of the other shops' finished reports. The
 * title is synthesized from the report type in SQL; nothing else (shop, tech,
 * report number, notes, parts) ever reaches the shop. The shop asks for
 * access through POST /api/service-history/requests, which calls
 * request_service_history_access with the user's session and notifies the
 * clinic's owners/admins.
 *
 * Clinic side: owners/admins list incoming requests and approve (creates a
 * service_history_grants row via grant_service_history; this laser by
 * default, or all lasers) or deny through
 * POST /api/service-history/requests/[id]/respond.
 *
 * All authorization is in the SECURITY DEFINER RPCs; these wrappers only map
 * arguments and errors.
 */

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => any };

export type TeaserRow = { ref: string; title: string; service_date: string | null };

export type TeaserState = 'ok' | 'unclaimed' | 'unavailable' | 'rate_limited' | 'error';

export type HistoryRequestError =
  | 'rate_limited'
  | 'cooldown'
  | 'unclaimed'
  | 'forbidden'
  | 'not_open'
  | 'nothing_to_request'
  | 'invalid'
  | 'error';

export type MyHistoryRequest = {
  id: number;
  owner_org_id: number;
  equipment_id: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  approved_scope: 'equipment' | 'all' | null;
  retry_after: string | null;
};

export type IncomingHistoryRequest = {
  id: number;
  requester_shop_org_id: number;
  shop_name: string | null;
  equipment_id: number;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  teaser_count: number;
  requested_title: string | null;
  requested_date: string | null;
  requested_by_name: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  close_reason: string | null;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  approved_scope: 'equipment' | 'all' | null;
  total_count: number;
};

export type OwnerHistoryGrant = {
  id: number;
  grantee_shop_org_id: number;
  shop_name: string | null;
  equipment_id: number | null;
  granted_at: string;
};

/** Per-member email opt-out key in user_profiles.notification_prefs. */
export const HISTORY_REQUEST_EMAIL_PREF = 'notif_history_request_email';

/** In-app notification kinds (notifications.type stays 'general'; kind is in data). */
export const HISTORY_NOTIFICATION_KINDS = {
  request: 'history_access_request',
  approved: 'history_access_approved',
  denied: 'history_access_denied',
} as const;

export const INBOX_PATH = '/my-lasers/history-requests';

export function positiveId(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Map a PostgREST / RPC error to a stable kind (messages are set in 000922). */
export function classifyHistoryRequestError(err: unknown): { kind: HistoryRequestError; retryAfter: string | null } {
  const e = (err || {}) as { message?: unknown; code?: unknown; details?: unknown };
  const msg = String(e.message || '').toLowerCase();
  const code = String(e.code || '');
  const details = String(e.details || '');
  const retry = /retry_after=([0-9TZ:\-]+)/.exec(details)?.[1] || null;
  if (msg.includes('rate_limited')) return { kind: 'rate_limited', retryAfter: null };
  if (msg.includes('request_cooldown')) return { kind: 'cooldown', retryAfter: retry };
  if (msg.includes('clinic_unclaimed')) return { kind: 'unclaimed', retryAfter: null };
  if (msg.includes('no longer open')) return { kind: 'not_open', retryAfter: null };
  if (msg.includes('no locked history')) return { kind: 'nothing_to_request', retryAfter: null };
  if (code === '42501' || msg.includes('not available') || msg.includes('only ')) return { kind: 'forbidden', retryAfter: null };
  if (code === '22023') return { kind: 'invalid', retryAfter: null };
  return { kind: 'error', retryAfter: null };
}

export function historyRequestErrorText(kind: HistoryRequestError, retryAfter?: string | null): string {
  switch (kind) {
    case 'rate_limited':
      return 'Too many requests right now. Try again later.';
    case 'cooldown':
      return retryAfter
        ? `The clinic declined recently. You can ask again after ${retryAfter.slice(0, 10)}.`
        : 'The clinic declined recently. You can ask again in 30 days.';
    case 'unclaimed':
      return 'This clinic has not joined Total Service Pro yet. Invite them to request earlier history.';
    case 'not_open':
      return 'This request is no longer open.';
    case 'nothing_to_request':
      return 'There is no locked history on this laser.';
    case 'forbidden':
      return 'You can’t do that for this laser.';
    case 'invalid':
      return 'That request is not valid.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/** Locked teaser for one laser of a linked clinic (title + date only). */
export async function loadLockedTeaser(
  client: RpcClient,
  ownerOrg: string | number,
  equipmentId: string | number
): Promise<{ rows: TeaserRow[]; state: TeaserState }> {
  const owner = positiveId(ownerOrg);
  const eq = positiveId(equipmentId);
  if (!owner || !eq) return { rows: [], state: 'unavailable' };
  try {
    const { data, error } = await client.rpc('get_locked_service_history_teaser', {
      p_owner_org: owner,
      p_equipment_id: eq,
    });
    if (error) {
      const { kind } = classifyHistoryRequestError(error);
      if (kind === 'unclaimed') return { rows: [], state: 'unclaimed' };
      if (kind === 'rate_limited') return { rows: [], state: 'rate_limited' };
      if (kind === 'forbidden') return { rows: [], state: 'unavailable' };
      // Not deployed yet (42883 / PGRST202): feature off.
      return { rows: [], state: 'unavailable' };
    }
    const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
      ref: String(r?.ref || ''),
      title: String(r?.title || 'Service report'),
      service_date: r?.service_date ? String(r.service_date) : null,
    }));
    return { rows, state: 'ok' };
  } catch {
    return { rows: [], state: 'error' };
  }
}

export async function listMyHistoryRequests(
  client: RpcClient,
  equipmentId?: string | number | null
): Promise<MyHistoryRequest[]> {
  try {
    const { data, error } = await client.rpc('list_my_service_history_requests', {
      p_equipment_id: positiveId(equipmentId ?? null),
    });
    if (error || !Array.isArray(data)) return [];
    return data as MyHistoryRequest[];
  } catch {
    return [];
  }
}

/** Latest request per laser (rows come newest first). */
export function latestRequestByEquipment(rows: MyHistoryRequest[]): Map<number, MyHistoryRequest> {
  const out = new Map<number, MyHistoryRequest>();
  for (const r of rows) {
    const id = Number(r.equipment_id);
    if (!out.has(id)) out.set(id, r);
  }
  return out;
}

export async function listIncomingHistoryRequests(
  client: RpcClient,
  ownerOrg: string | number,
  opts: { status?: 'pending' | 'closed' | 'all'; equipmentId?: string | number | null; limit?: number; offset?: number } = {}
): Promise<{ rows: IncomingHistoryRequest[]; total: number; error: string | null }> {
  const owner = positiveId(ownerOrg);
  if (!owner) return { rows: [], total: 0, error: 'clinic is required' };
  try {
    const { data, error } = await client.rpc('list_incoming_service_history_requests', {
      p_owner_org: owner,
      p_status: opts.status || 'pending',
      p_equipment_id: positiveId(opts.equipmentId ?? null),
      p_limit: Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 1, 1), 200),
      p_offset: Math.max(Math.trunc(opts.offset ?? 0) || 0, 0),
    });
    if (error) return { rows: [], total: 0, error: error.message || String(error) };
    const rows = (Array.isArray(data) ? data : []) as IncomingHistoryRequest[];
    return { rows, total: rows.length ? Number(rows[0].total_count) || rows.length : 0, error: null };
  } catch (e) {
    return { rows: [], total: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listOwnerHistoryGrants(
  client: RpcClient,
  ownerOrg: string | number,
  equipmentId?: string | number | null
): Promise<{ rows: OwnerHistoryGrant[]; error: string | null }> {
  const owner = positiveId(ownerOrg);
  if (!owner) return { rows: [], error: 'clinic is required' };
  try {
    const { data, error } = await client.rpc('list_owner_service_history_grants', {
      p_owner_org: owner,
      p_equipment_id: positiveId(equipmentId ?? null),
    });
    if (error) return { rows: [], error: error.message || String(error) };
    return { rows: (Array.isArray(data) ? data : []) as OwnerHistoryGrant[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}>;

export type RequestAccessResult = {
  ok: boolean;
  status?: string;
  created?: boolean;
  error?: HistoryRequestError;
  retryAfter?: string | null;
};

/** Shop asks the clinic for one laser's history (server route notifies the clinic). */
export async function requestHistoryAccess(
  fetchImpl: FetchLike,
  token: string,
  input: { ownerOrgId: string | number; equipmentId: string | number; ref?: string | null }
): Promise<RequestAccessResult> {
  const owner = positiveId(input.ownerOrgId);
  const eq = positiveId(input.equipmentId);
  if (!owner || !eq) return { ok: false, error: 'invalid' };
  const res = await fetchImpl('/api/service-history/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ownerOrgId: owner, equipmentId: eq, ref: input.ref || null }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body?.kind as HistoryRequestError) || 'error', retryAfter: body?.retryAfter ?? null };
  return { ok: true, status: body?.status, created: body?.created === true };
}

/** Clinic owner/admin approves or denies (server route notifies the shop). */
export async function respondToHistoryRequest(
  fetchImpl: FetchLike,
  token: string,
  requestId: string | number,
  decision: 'approve' | 'deny',
  scope: 'equipment' | 'all' = 'equipment'
): Promise<{ ok: boolean; status?: string; error?: HistoryRequestError }> {
  const id = positiveId(requestId);
  if (!id) return { ok: false, error: 'invalid' };
  const res = await fetchImpl(`/api/service-history/requests/${id}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ decision, scope }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body?.kind as HistoryRequestError) || 'error' };
  return { ok: true, status: body?.status };
}

/** notification_prefs with the history-request email flag set (other keys kept). */
export function withHistoryEmailPref(prefs: unknown, emailOn: boolean): Record<string, unknown> {
  const base = prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? { ...(prefs as Record<string, unknown>) } : {};
  base[HISTORY_REQUEST_EMAIL_PREF] = emailOn;
  return base;
}

export function historyEmailOn(prefs: unknown): boolean {
  if (!prefs || typeof prefs !== 'object') return true;
  return (prefs as Record<string, unknown>)[HISTORY_REQUEST_EMAIL_PREF] !== false;
}

export function requestStatusText(r: Pick<MyHistoryRequest, 'status' | 'expires_at' | 'retry_after'>): string {
  const day = (s: string | null) => (s ? String(s).slice(0, 10) : '');
  switch (r.status) {
    case 'pending':
      return `Requested · waiting for the clinic (expires ${day(r.expires_at)})`;
    case 'approved':
      return 'Shared with you';
    case 'denied':
      return r.retry_after ? `Declined · you can ask again after ${day(r.retry_after)}` : 'Declined';
    default:
      return 'Request expired · you can ask again';
  }
}
