import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HISTORY_REQUEST_EMAIL_PREF,
  classifyHistoryRequestError,
  effectiveRequestStatus,
  historyEmailOn,
  historyRequestErrorText,
  inboxAccess,
  isMissingRpcError,
  latestRequestByEquipment,
  listIncomingHistoryRequests,
  loadLockedTeaser,
  requestHistoryAccess,
  requestIsCooling,
  requestStatusText,
  respondToHistoryRequest,
  withHistoryEmailPref,
} from './service-history-requests.ts';

class FakeClient {
  calls: Array<[string, Record<string, unknown> | undefined]> = [];
  constructor(private reply: (fn: string) => { data: unknown; error: unknown }) {}
  rpc(name: string, args?: Record<string, unknown>) {
    this.calls.push([name, args]);
    return Promise.resolve(this.reply(name));
  }
}

test('classify: messages set by 000922 map to stable kinds', () => {
  assert.equal(classifyHistoryRequestError({ code: 'P0001', message: 'rate_limited' }).kind, 'rate_limited');
  const cd = classifyHistoryRequestError({ code: 'P0001', message: 'request_cooldown', details: 'retry_after=2026-11-16T10:00:00Z' });
  assert.deepEqual(cd, { kind: 'cooldown', retryAfter: '2026-11-16T10:00:00Z' });
  assert.equal(classifyHistoryRequestError({ code: '42501', message: 'clinic_unclaimed' }).kind, 'unclaimed');
  assert.equal(classifyHistoryRequestError({ code: '42501', message: 'not available for this laser' }).kind, 'forbidden');
  assert.equal(classifyHistoryRequestError({ code: '22023', message: 'request is no longer open' }).kind, 'not_open');
  assert.equal(classifyHistoryRequestError({ code: '22023', message: 'no locked history on this laser' }).kind, 'nothing_to_request');
  assert.equal(classifyHistoryRequestError({ code: '42883', message: 'function does not exist' }).kind, 'unavailable');
  assert.equal(classifyHistoryRequestError({ code: 'XX000', message: 'boom' }).kind, 'error');
});

test('teaser: maps rows, never passes anything but owner + laser', async () => {
  const c = new FakeClient(() => ({ data: [{ ref: 'a'.repeat(32), title: 'Repair', service_date: '2026-03-04', extra: 'x' }], error: null }));
  const r = await loadLockedTeaser(c, '10', 1);
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.rows, [{ ref: 'a'.repeat(32), title: 'Repair', service_date: '2026-03-04' }]);
  assert.deepEqual(c.calls, [['get_locked_service_history_teaser', { p_owner_org: 10, p_equipment_id: 1 }]]);
});

test('teaser: unclaimed, rate limit, forbidden and missing RPC', async () => {
  assert.equal((await loadLockedTeaser(new FakeClient(() => ({ data: null, error: { code: '42501', message: 'clinic_unclaimed' } })), 1, 1)).state, 'unclaimed');
  assert.equal((await loadLockedTeaser(new FakeClient(() => ({ data: null, error: { code: 'P0001', message: 'rate_limited' } })), 1, 1)).state, 'rate_limited');
  assert.equal((await loadLockedTeaser(new FakeClient(() => ({ data: null, error: { code: '42501', message: 'not available for this laser' } })), 1, 1)).state, 'unavailable');
  assert.equal((await loadLockedTeaser(new FakeClient(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })), 1, 1)).state, 'unavailable');
  const c = new FakeClient(() => ({ data: [], error: null }));
  assert.equal((await loadLockedTeaser(c, 'x', 1)).state, 'unavailable');
  assert.equal(c.calls.length, 0);
});

test('incoming: clamps paging and reads total_count', async () => {
  const c = new FakeClient(() => ({ data: [{ id: 1, total_count: 7 }], error: null }));
  const r = await listIncomingHistoryRequests(c, 10, { status: 'closed', limit: 9999, offset: -3 });
  assert.equal(r.total, 7);
  assert.deepEqual(c.calls[0], ['list_incoming_service_history_requests', { p_owner_org: 10, p_status: 'closed', p_equipment_id: null, p_limit: 200, p_offset: 0 }]);
});

test('request/respond go to the server routes with the bearer token', async () => {
  const seen: any[] = [];
  const f = async (url: string, init: any) => {
    seen.push([url, init.headers.Authorization, JSON.parse(init.body)]);
    return { ok: true, status: 200, json: async () => ({ status: 'pending', created: true }) };
  };
  assert.deepEqual(await requestHistoryAccess(f, 'tok', { ownerOrgId: 10, equipmentId: '1', ref: 'r' }), { ok: true, status: 'pending', created: true });
  await respondToHistoryRequest(f, 'tok', 5, 'approve', 'all');
  assert.deepEqual(seen, [
    ['/api/service-history/requests', 'Bearer tok', { ownerOrgId: 10, equipmentId: 1, ref: 'r' }],
    ['/api/service-history/requests/5/respond', 'Bearer tok', { decision: 'approve', scope: 'all' }],
  ]);
  const bad = async () => ({ ok: false, status: 429, json: async () => ({ kind: 'cooldown', retryAfter: '2026-11-16T00:00:00Z' }) });
  assert.deepEqual(await requestHistoryAccess(bad, 'tok', { ownerOrgId: 10, equipmentId: 1 }), { ok: false, error: 'cooldown', retryAfter: '2026-11-16T00:00:00Z' });
  assert.deepEqual(await requestHistoryAccess(bad, 'tok', { ownerOrgId: 0, equipmentId: 1 }), { ok: false, error: 'invalid' });
});

test('email opt-out pref keeps other keys', () => {
  const next = withHistoryEmailPref({ notif_email: true, notif_reaction: false }, false);
  assert.deepEqual(next, { notif_email: true, notif_reaction: false, [HISTORY_REQUEST_EMAIL_PREF]: false });
  assert.equal(historyEmailOn(next), false);
  assert.equal(historyEmailOn(null), true);
  assert.equal(historyEmailOn({}), true);
});

test('latest request per laser and status text', () => {
  const rows: any[] = [
    { id: 3, equipment_id: 1, status: 'denied', retry_after: '2026-11-16T00:00:00Z', expires_at: '2026-10-31' },
    { id: 2, equipment_id: 1, status: 'approved' },
    { id: 1, equipment_id: 2, status: 'pending', expires_at: '2026-10-31T00:00:00Z' },
  ];
  const m = latestRequestByEquipment(rows);
  assert.equal(m.get(1)?.id, 3);
  assert.match(requestStatusText(m.get(1)!), /ask again after 2026-11-16/);
  assert.match(requestStatusText(m.get(2)!), /expires 2026-10-31/);
});

test('missing RPC (000922 not applied) classifies as unavailable', () => {
  assert.equal(classifyHistoryRequestError({ code: 'PGRST202', message: 'Could not find the function public.x' }).kind, 'unavailable');
  assert.equal(classifyHistoryRequestError({ code: '42883', message: 'function does not exist' }).kind, 'unavailable');
  assert.equal(isMissingRpcError({ code: '42501' }), false);
  assert.equal(classifyHistoryRequestError({ code: '42501', message: 'only an owner or admin who is not part of the requesting company can approve' }).kind, 'forbidden');
});

test('inbox access (L-4): shop users, staff and org-less users never get the inbox', () => {
  assert.equal(inboxAccess(null, null, null), 'no_org');
  assert.equal(inboxAccess(1, 'service_company', 'company_admin'), 'not_clinic');
  assert.equal(inboxAccess(10, 'customer', 'staff'), 'not_admin');
  assert.equal(inboxAccess(10, 'laser_clinic', ' Manager '), 'owner');
  assert.equal(inboxAccess(10, 'customer', 'owner'), 'owner');
});

test('incoming list reports an unavailable RPC distinctly', async () => {
  const c = new FakeClient(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
  const r = await listIncomingHistoryRequests(c as any, 10);
  assert.equal(r.errorKind, 'unavailable');
  const f = new FakeClient(() => ({ data: null, error: { code: '42501', message: 'only an owner or admin of this facility can see its history requests' } }));
  assert.equal((await listIncomingHistoryRequests(f as any, 10)).errorKind, 'forbidden');
});

// 000925 follow-ups (QA live check of #314): panel status from an ACTIVE grant,
// and a revoke cools down like a deny.
test('panel: approved shows "Shared with you" only while a grant is active', () => {
  const approved: any = { id: 1, equipment_id: 1, status: 'approved', expires_at: '2026-10-31', retry_after: null };
  assert.equal(requestStatusText(effectiveRequestStatus(approved, true)), 'Shared with you');
  const afterRevoke = effectiveRequestStatus(approved, false);
  assert.equal(afterRevoke.status, 'revoked');
  assert.doesNotMatch(requestStatusText(afterRevoke), /Shared with you/);
  assert.equal(requestStatusText(afterRevoke), 'Access was revoked · you can ask again');
  for (const st of ['pending', 'denied', 'expired', 'revoked'] as const) {
    assert.equal(effectiveRequestStatus({ ...approved, status: st }, false).status, st);
    assert.equal(effectiveRequestStatus({ ...approved, status: st }, true).status, st);
  }
  assert.equal(approved.status, 'approved', 'input is not mutated');
});

test('panel: revoked (from the 000925 RPC) is locked and cools down like a deny', () => {
  const now = new Date('2026-10-18T16:00:00Z');
  const revoked: any = { status: 'revoked', expires_at: '2026-10-31', retry_after: '2026-11-17T16:00:00Z' };
  assert.equal(requestStatusText(revoked, now), 'Access was revoked · you can ask again after 2026-11-17');
  assert.equal(requestIsCooling(revoked, now), true);
  assert.equal(requestIsCooling({ ...revoked, retry_after: '2026-10-01T00:00:00Z' }, now), false);
  assert.equal(requestStatusText({ ...revoked, retry_after: '2026-10-01T00:00:00Z' }, now), 'Access was revoked · you can ask again');
  assert.equal(requestIsCooling({ status: 'denied', retry_after: '2026-11-17T16:00:00Z' }, now), true);
  assert.equal(requestIsCooling({ status: 'approved', retry_after: '2026-11-17T16:00:00Z' }, now), false);
  assert.equal(requestIsCooling({ status: 'expired', retry_after: '2026-11-17T16:00:00Z' }, now), false);
  assert.equal(requestIsCooling({ status: 'pending', retry_after: null }, now), false);
  assert.equal(requestIsCooling(null, now), false);
  assert.equal(requestIsCooling({ status: 'revoked', retry_after: 'garbage' }, now), false);
});

test('re-request after a revoke gets the same request_cooldown error and text as a deny', () => {
  const err = { code: 'P0001', message: 'request_cooldown', details: 'retry_after=2026-11-17T16:11:55Z' };
  const c = classifyHistoryRequestError(err);
  assert.deepEqual(c, { kind: 'cooldown', retryAfter: '2026-11-17T16:11:55Z' });
  assert.equal(historyRequestErrorText(c.kind, c.retryAfter), 'The clinic declined recently. You can ask again after 2026-11-17.');
});

test('N-2 refusal maps to forbidden', () => {
  const e = { code: '42501', message: 'only an owner or admin who has not been part of that service company in the last 30 days can share with it' };
  assert.equal(classifyHistoryRequestError(e).kind, 'forbidden');
});

test('panel: a system revoke (revoke-on-join, linked-shop removal) has no retry_after, so the shop can ask again', () => {
  const now = new Date('2026-10-18T16:00:00Z');
  // 000925 sets retry_after only for an owner deny or owner revoke.
  const system: any = { status: 'revoked', expires_at: '2026-10-31', retry_after: null };
  assert.equal(requestIsCooling(system, now), false);
  assert.equal(requestStatusText(system, now), 'Access was revoked · you can ask again');
  // Pre-000925 fallback: approved + no active share -> revoked, never cooling.
  const fallback = effectiveRequestStatus({ status: 'approved', expires_at: '2026-10-31', retry_after: null } as any, false);
  assert.equal(fallback.status, 'revoked');
  assert.equal(requestIsCooling(fallback, now), false);
  // An owner revoke (retry_after set) still cools down.
  assert.equal(requestIsCooling({ status: 'revoked', retry_after: '2026-11-17T16:00:00Z' }, now), true);
});
