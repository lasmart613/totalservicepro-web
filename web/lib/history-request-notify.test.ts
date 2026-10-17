import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyOwnersOfRequest, notifyShopOfResponse, type RequestNotice } from './history-request-notify.ts';
import { historyRequestHtml, historyRequestText, sendResendEmail } from './history-request-email.ts';
import { notificationClickPath } from './notification-link.ts';

function notice(over: Partial<RequestNotice> = {}): RequestNotice {
  return {
    id: 7,
    status: 'pending',
    owner_org_id: 10,
    owner_name: 'Clinic C',
    shop_org_id: 1,
    shop_name: 'Shop L',
    equipment_id: 1,
    laser: 'Candela GentleMax',
    serial_number: 'SN-1',
    teaser_count: 4,
    requested_by: 'u-b2',
    notified_at: null,
    owner_recipients: [
      { user_id: 'u-c1', email: 'c1@clinic.test', first_name: 'Cara', email_ok: true },
      { user_id: 'u-c3', email: 'c3@clinic.test', first_name: 'Cam', email_ok: false },
    ],
    shop_recipients: [
      { user_id: 'u-b1', email: 'b1@shop.test', email_ok: true, is_requester: false },
      { user_id: 'u-b2', email: 'b2@shop.test', email_ok: true, is_requester: true },
    ],
    ...over,
  };
}

/** Minimal service-role fake: rpc + notifications + requests tables. */
function fakeAdmin(n: RequestNotice, opts: { slots?: number } = {}) {
  const state = { notifications: [] as any[], updates: [] as any[], slotsLeft: opts.slots ?? 10, rpc: [] as string[] };
  const admin = {
    rpc(fn: string, args: any) {
      state.rpc.push(fn);
      if (fn === 'service_history_request_notice') return Promise.resolve({ data: args.p_request_id === n.id ? n : null, error: null });
      if (fn === 'take_service_history_slot') {
        assert.equal(args.p_bucket, 'request_email_owner');
        assert.equal(args.p_key, '10');
        const ok = state.slotsLeft > 0;
        if (ok) state.slotsLeft -= 1;
        return Promise.resolve({ data: ok, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unexpected ' + fn } });
    },
    from(table: string) {
      if (table === 'notifications') {
        const q: any = {
          filters: {} as any,
          select() { return q; },
          eq(k: string, v: any) { q.filters[k] = v; return q; },
          contains(_k: string, v: any) { q.filters.data = v; return q; },
          in(_k: string, ids: string[]) {
            const rows = state.notifications.filter((r) => ids.includes(r.user_id) && r.data.kind === q.filters.data.kind && r.data.request_id === q.filters.data.request_id);
            return Promise.resolve({ data: rows.map((r) => ({ user_id: r.user_id })), error: null });
          },
          insert(rows: any[]) { state.notifications.push(...rows); return Promise.resolve({ error: null }); },
        };
        return q;
      }
      if (table === 'service_history_requests') {
        return { update(v: any) { return { eq(_k: string, id: any) { state.updates.push([id, v]); return Promise.resolve({ error: null }); } }; } };
      }
      throw new Error('unexpected table ' + table);
    },
  };
  return { admin, state };
}

test('new request: owners/admins notified in-app; email only to members who allow it', async () => {
  const n = notice();
  const { admin, state } = fakeAdmin(n);
  const sent: any[] = [];
  const out = await notifyOwnersOfRequest({ admin, origin: 'https://repairplanet.net/', send: async (m) => (sent.push(m), { ok: true }) }, 7, 'u-b2');
  assert.deepEqual(out, { notified: 2, emailed: 1, skippedEmail: 1 });
  assert.deepEqual(state.notifications.map((r) => [r.user_id, r.type, r.link, r.data.kind, r.triggered_by]), [
    ['u-c1', 'general', '/my-lasers/history-requests?r=7', 'history_access_request', 'u-b2'],
    ['u-c3', 'general', '/my-lasers/history-requests?r=7', 'history_access_request', 'u-b2'],
  ]);
  assert.equal(state.notifications[0].message, 'Shop L asked to see the earlier service history of Candela GentleMax (SN SN-1) (4 reports).');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'c1@clinic.test');
  assert.match(sent[0].subject, /^Shop L is asking to see your laser's service history$/);
  assert.ok(sent[0].text.includes('https://repairplanet.net/my-lasers/history-requests?r=7'));
  assert.equal(state.updates.length, 1);
  assert.equal(notificationClickPath(state.notifications[0].link, 'general', 'https://repairplanet.net'), '/my-lasers/history-requests?r=7');
});

test('retry after a partial failure does not notify anyone twice; notified_at stops it entirely', async () => {
  const n = notice();
  const { admin, state } = fakeAdmin(n);
  const send = async () => ({ ok: true });
  await notifyOwnersOfRequest({ admin, origin: 'https://x.test', send }, 7, 'u-b2');
  const again = await notifyOwnersOfRequest({ admin, origin: 'https://x.test', send }, 7, 'u-b2');
  assert.deepEqual(again, { notified: 0, emailed: 0, skippedEmail: 0 });
  assert.equal(state.notifications.length, 2);
  const n2 = notice({ notified_at: '2026-10-17T18:00:00Z' });
  const f2 = fakeAdmin(n2);
  assert.deepEqual(await notifyOwnersOfRequest({ admin: f2.admin, origin: 'https://x.test', send }, 7, 'u-b2'), { notified: 0, emailed: 0, skippedEmail: 0 });
  assert.equal(f2.state.notifications.length, 0);
});

test('clinic email cap: no slot -> in-app only', async () => {
  const n = notice();
  const { admin, state } = fakeAdmin(n, { slots: 0 });
  const sent: any[] = [];
  const out = await notifyOwnersOfRequest({ admin, origin: 'https://x.test', send: async (m) => (sent.push(m), { ok: true }) }, 7, 'u-b2');
  assert.equal(out.notified, 2);
  assert.equal(sent.length, 0);
  assert.equal(state.notifications.length, 2);
});

test('approval: shop in-app + email to the requester only', async () => {
  const n = notice({ status: 'approved' });
  const { admin, state } = fakeAdmin(n);
  const sent: any[] = [];
  const out = await notifyShopOfResponse({ admin, origin: 'https://x.test', send: async (m) => (sent.push(m), { ok: true }) }, 7, 'u-c1');
  assert.equal(out.notified, 2);
  assert.deepEqual(sent.map((m) => m.to), ['b2@shop.test']);
  assert.deepEqual(state.notifications.map((r) => [r.user_id, r.data.kind, r.link]), [
    ['u-b1', 'history_access_approved', '/customers/10?tab=equipment&eq=1'],
    ['u-b2', 'history_access_approved', '/customers/10?tab=equipment&eq=1'],
  ]);
  assert.ok(!state.rpc.includes('take_service_history_slot'));
});

test('denial: shop notified in-app only, no email (decision)', async () => {
  const n = notice({ status: 'denied' });
  const { admin, state } = fakeAdmin(n);
  const sent: any[] = [];
  await notifyShopOfResponse({ admin, origin: 'https://x.test', send: async (m) => (sent.push(m), { ok: true }) }, 7, 'u-c1');
  assert.equal(sent.length, 0);
  assert.equal(state.notifications.length, 2);
  assert.match(state.notifications[0].message, /declined/);
});

test('pending / unknown request: nothing sent to the shop', async () => {
  const { admin, state } = fakeAdmin(notice());
  assert.deepEqual(await notifyShopOfResponse({ admin, origin: 'https://x.test', send: async () => ({ ok: true }) }, 7, 'u'), { notified: 0, emailed: 0, skippedEmail: 0 });
  assert.equal((await notifyShopOfResponse({ admin, origin: 'https://x.test', send: async () => ({ ok: true }) }, 99, 'u')).error, 'request not found');
  assert.equal(state.notifications.length, 0);
});

test('email copy: escaped, shop and laser only, no report contents', () => {
  const copy = { firstName: '<b>Cara</b>', shopName: 'Shop "L" <script>', laser: 'GentleMax', serialNumber: 'SN-1', reportCount: 1, url: 'https://x.test/my-lasers/history-requests?r=7' };
  const html = historyRequestHtml(copy);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;b&gt;Cara&lt;/b&gt;'));
  assert.ok(historyRequestText(copy).includes('1 earlier report is locked'));
});

test('Resend sender: needs a key and a valid address', async () => {
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(await sendResendEmail({ to: 'a@b.co', subject: 's', html: 'h', text: 't' }), { ok: false, error: 'RESEND_API_KEY not configured' });
  process.env.RESEND_API_KEY = 'test';
  let body: any = null;
  const f: any = async (_u: string, init: any) => ((body = JSON.parse(init.body)), { ok: true, json: async () => ({}) });
  assert.deepEqual(await sendResendEmail({ to: 'nope', subject: 's', html: 'h', text: 't' }, f), { ok: false, error: 'No valid email' });
  assert.deepEqual(await sendResendEmail({ to: ' a@b.co ', subject: 's', html: 'h', text: 't' }, f), { ok: true });
  assert.deepEqual(body.to, ['a@b.co']);
  if (prev === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = prev;
});
