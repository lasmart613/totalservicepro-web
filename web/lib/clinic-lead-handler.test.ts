/**
 * Route-level tests for POST /api/clinic-service-leads (handleClinicLeadPost)
 * with a fake service-role client that enforces the unique confirmation_key,
 * and the real sendResendEmail over a mocked fetch (throw / timeout / ok).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleClinicLeadPost } from './clinic-lead-handler.ts';
import { sendResendEmail, type ResendMail } from './clinic-lead-mail.ts';

/** Never resolves; rejects on abort. AbortSignal.timeout timers are unref'd,
 *  so a ref'd keep-alive stops node:test from ending the loop early. */
function hangUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const keepAlive = setTimeout(() => {}, 5_000);
    signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); });
  });
}

type Row = Record<string, unknown>;
type DbErr = { code: string; message: string } | null;

function fakeAdmin(opts: { failRelease?: boolean; failFlag?: boolean; failMarker?: boolean; leadInsertError?: DbErr } = {}) {
  const tables: Record<string, Row[]> = { organizations: [], service_requests: [], clinic_service_leads: [] };
  const log = { leadInserts: [] as Row[], flagAttempts: 0 };
  let seq = 0;
  class Q {
    op: 'insert' | 'update' | 'select' = 'select';
    row: Row = {};
    filters: Array<(r: Row) => boolean> = [];
    filterCols: string[] = [];
    returning = false;
    one = false;
    constructor(public t: string) {}
    insert(row: Row) { this.op = 'insert'; this.row = { ...row }; return this; }
    update(row: Row) { this.op = 'update'; this.row = { ...row }; return this; }
    select() { this.returning = true; return this; }
    eq(c: string, v: unknown) { this.filterCols.push(c); this.filters.push((r) => r[c] === v); return this; }
    is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    lt(c: string, v: string) { this.filters.push((r) => r[c] != null && String(r[c]) < v); return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    run(): { data: unknown; error: DbErr } {
      const rows = tables[this.t];
      if (this.op === 'insert') {
        if (this.t === 'clinic_service_leads') {
          log.leadInserts.push(this.row);
          if (opts.leadInsertError) return { data: null, error: opts.leadInsertError };
          const k = this.row.confirmation_key;
          if (k != null && rows.some((r) => r.confirmation_key === k)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "clinic_service_leads_confirmation_key_key"' } };
          }
        }
        const r = { confirmation_sent: false, ...this.row, id: this.t === 'organizations' ? ++seq : `${this.t}-${++seq}` };
        rows.push(r);
        return { data: this.one ? { id: r.id } : [{ id: r.id }], error: null };
      }
      if (this.op === 'update') {
        if ('confirmation_sent' in this.row) log.flagAttempts++;
        if (opts.failFlag && this.row.confirmation_sent === true) {
          return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
        }
        if (opts.failMarker && 'send_attempted_at' in this.row) {
          return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
        }
        if (opts.failRelease && this.row.confirmation_key === null && this.filterCols.includes('id')) {
          return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
        }
        const hit = rows.filter((r) => this.filters.every((f) => f(r)));
        for (const r of hit) Object.assign(r, this.row);
        return { data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      return { data: rows.filter((r) => this.filters.every((f) => f(r))), error: null };
    }
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => this.run()).then(res, rej);
    }
  }
  const admin = { from: (t: string) => new Q(t) } as unknown as SupabaseClient;
  return { admin, tables, log };
}

/** A healthy fake admin that shares an existing leads array. */
function fakeAdminWithRows(rows: Row[]): SupabaseClient {
  const fresh = fakeAdmin();
  fresh.tables.clinic_service_leads = rows;
  return fresh.admin;
}

const LEAD = {
  equipmentType: 'laser', clinicName: 'Secret Clinic Name', location: 'Hiddenville, AZ 85004',
  contactName: 'QA Person', email: 'qa.lead@example.test', phone: '(555) 555-0100',
  manufacturer: 'Candela', model: 'GentleMax', serviceType: 'pm', urgency: 'low',
  description: 'QA test - laser will not fire after warm-up.',
};

type Mode = 'ok' | 'throw' | 'timeout' | 'fail';
function mailer(mode: { team: Mode; confirm: Mode }) {
  const sent: Array<{ kind: string; ok: boolean }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    const kind = b.to.length === 1 && b.to[0] === LEAD.email ? 'confirm' : 'team';
    const m = mode[kind as 'team' | 'confirm'];
    if (m === 'throw') { sent.push({ kind, ok: false }); throw new TypeError('fetch failed'); }
    if (m === 'timeout') {
      await hangUntilAbort(init.signal!);
    }
    if (m === 'fail') { sent.push({ kind, ok: false }); return new Response('{"message":"provider down"}', { status: 500 }); }
    sent.push({ kind, ok: true });
    return new Response('{"id":"x"}', { status: 200 });
  }) as unknown as typeof fetch;
  const send = (mail: ResendMail) => sendResendEmail(mail, { apiKey: 'test-not-a-secret', fetchImpl, timeoutMs: 40 });
  return { send, sent, confirms: () => sent.filter((s) => s.kind === 'confirm' && s.ok).length };
}

function captureConsole() {
  const lines: string[] = [];
  const orig = { error: console.error, warn: console.warn, info: console.info };
  for (const k of ['error', 'warn', 'info'] as const) {
    console[k] = (...a: unknown[]) => { lines.push(a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  }
  return { lines, restore: () => Object.assign(console, orig) };
}

const leadRows = (db: ReturnType<typeof fakeAdmin>) => db.tables.clinic_service_leads;

for (const [label, mode] of [
  ['confirmation fetch throws', { team: 'ok', confirm: 'throw' }],
  ['confirmation fetch times out', { team: 'ok', confirm: 'timeout' }],
  ['team fetch throws', { team: 'throw', confirm: 'ok' }],
] as const) {
  test(`${label}: claim released, retry gets exactly one confirmation`, async () => {
    const c = captureConsole();
    try {
      const db = fakeAdmin();
      const m1 = mailer(mode);
      const r1 = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m1.send });
      assert.equal(r1.status, 200, JSON.stringify(r1.body));
      if (mode.confirm !== 'ok') assert.equal(r1.body.confirmed, false);
      const first = leadRows(db)[0];
      if (r1.body.confirmed !== true) {
        assert.equal(first.confirmation_key, null, 'claim released');
        assert.equal(first.claimed_at, null);
      }
      const m2 = mailer({ team: 'ok', confirm: 'ok' });
      const r2 = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m2.send });
      const totalConfirms = m1.confirms() + m2.confirms();
      assert.equal(totalConfirms, 1, 'exactly one confirmation across submit + retry');
      assert.equal(r2.status, 200);
      const m3 = mailer({ team: 'ok', confirm: 'ok' });
      await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m3.send });
      assert.equal(m3.confirms(), 0, 'third submit after a sent confirmation sends none');
    } finally {
      c.restore();
    }
  });
}

test('sendResendEmail never throws: network error and timeout come back ok:false', async () => {
  const mail = { from: 'a@b.test', to: ['c@d.test'], subject: 's', html: 'h', text: 't' };
  const thrown = await sendResendEmail(mail, { apiKey: 'k', fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
  assert.deepEqual(thrown, { ok: false, error: 'fetch failed' });
  const slow = await sendResendEmail(mail, {
    apiKey: 'k', timeoutMs: 20,
    fetchImpl: ((_u: string, init: RequestInit) => hangUntilAbort(init.signal!)) as unknown as typeof fetch,
  });
  assert.deepEqual(slow, { ok: false, error: 'Email provider timed out' });
});

test('503 path (no service request) releases the claim; retry confirms once', async () => {
  const c = captureConsole();
  try {
    const db = fakeAdmin();
    const realFrom = db.admin.from.bind(db.admin);
    let failSr = true;
    (db.admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = realFrom(t) as unknown as { run: () => unknown };
      if (t === 'service_requests' && failSr) q.run = () => ({ data: null, error: { code: '23514', message: 'forced' } });
      return q;
    };
    const m1 = mailer({ team: 'ok', confirm: 'ok' });
    const r1 = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m1.send });
    assert.equal(r1.status, 503);
    assert.equal(m1.confirms(), 0);
    assert.equal(leadRows(db)[0].confirmation_key, null);
    failSr = false;
    const m2 = mailer({ team: 'ok', confirm: 'ok' });
    const r2 = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m2.send });
    assert.equal(r2.status, 200);
    assert.equal(m2.confirms(), 1);
  } finally {
    c.restore();
  }
});

test('L-A: flag write fails after a real send -> retried 3x, and the row is never retaken (no 2nd email)', async () => {
  const c = captureConsole();
  try {
    const db = fakeAdmin({ failFlag: true });
    let t = new Date('2026-10-19T03:00:00Z');
    const now = () => t;
    const m1 = mailer({ team: 'ok', confirm: 'ok' });
    const r1 = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m1.send, now });
    assert.equal(r1.body.confirmed, true);
    assert.equal(m1.confirms(), 1);
    assert.equal(db.log.flagAttempts, 3, 'flag write retried');
    assert.equal(c.lines.filter((l) => /confirmation_sent flag attempt/.test(l)).length, 3);
    const row = leadRows(db)[0];
    assert.equal(row.confirmation_sent, false);
    assert.notEqual(row.send_attempted_at ?? null, null, 'marker written before the send');
    assert.notEqual(row.confirmation_key, null, 'claim kept (not released after a real send)');
    for (const later of ['2026-10-19T03:11:00Z', '2026-10-19T05:00:00Z']) {
      t = new Date(later);
      const m = mailer({ team: 'ok', confirm: 'ok' });
      const r = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m.send, now });
      assert.equal(m.confirms(), 0, `no second confirmation at ${later}`);
      assert.equal(r.body.confirmed, false);
    }
  } finally {
    c.restore();
  }
});

test('flag write that fails once then succeeds is retried and lands', async () => {
  const c = captureConsole();
  try {
    const db = fakeAdmin();
    const realFrom = db.admin.from.bind(db.admin);
    let failures = 1;
    (db.admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = realFrom(t) as unknown as { run: () => unknown; op: string; row: Row };
      const orig = q.run.bind(q);
      q.run = () => (q.op === 'update' && q.row.confirmation_sent === true && failures-- > 0
        ? { data: null, error: { code: '57014', message: 'timeout' } } : orig());
      return q;
    };
    const m = mailer({ team: 'ok', confirm: 'ok' });
    await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m.send });
    assert.equal(leadRows(db)[0].confirmation_sent, true);
  } finally {
    c.restore();
  }
});

test('marker write fails -> no send, claim released, retry confirms once', async () => {
  const c = captureConsole();
  try {
    const db = fakeAdmin({ failMarker: true });
    const m1 = mailer({ team: 'ok', confirm: 'ok' });
    const r1 = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m1.send });
    assert.equal(m1.confirms(), 0);
    assert.equal(r1.body.confirmed, false);
    assert.equal(leadRows(db)[0].confirmation_key, null);
    assert.ok(c.lines.some((l) => /send marker failed/.test(l)));
    const db2 = db; // marker writes work again
    (db2 as unknown as { admin: SupabaseClient }).admin = fakeAdminWithRows(leadRows(db));
    const m2 = mailer({ team: 'ok', confirm: 'ok' });
    const r2 = await handleClinicLeadPost({ ...LEAD }, { admin: db2.admin, send: m2.send });
    assert.equal(m2.confirms(), 1);
    assert.equal(r2.body.confirmed, true);
  } finally {
    c.restore();
  }
});

test('stuck claim with NO send attempt (release failed after a skipped send) is retaken after 10 minutes', async () => {
  const c = captureConsole();
  try {
    const db = fakeAdmin({ failRelease: true, failMarker: true });
    let t = new Date('2026-10-19T03:00:00Z');
    const now = () => t;
    await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: mailer({ team: 'ok', confirm: 'ok' }).send, now });
    assert.ok(c.lines.some((l) => /release claim failed/.test(l)), c.lines.join('\n'));
    assert.notEqual(leadRows(db)[0].confirmation_key, null, 'claim stuck');
    assert.equal(leadRows(db)[0].send_attempted_at ?? null, null, 'send never ran');
    const healthy = fakeAdminWithRows(leadRows(db));
    t = new Date('2026-10-19T03:05:00Z');
    const m2 = mailer({ team: 'ok', confirm: 'ok' });
    await handleClinicLeadPost({ ...LEAD }, { admin: healthy, send: m2.send, now });
    assert.equal(m2.confirms(), 0, 'still fresh at 5 min');
    t = new Date('2026-10-19T03:11:00Z');
    const m3 = mailer({ team: 'ok', confirm: 'ok' });
    await handleClinicLeadPost({ ...LEAD }, { admin: healthy, send: m3.send, now });
    assert.equal(m3.confirms(), 1, 'retaken at 11 min');
  } finally {
    c.restore();
  }
});

test('a provider-rejected send whose release also fails stays claimed (fail closed: no retake)', async () => {
  const c = captureConsole();
  try {
    const db = fakeAdmin({ failRelease: true });
    let t = new Date('2026-10-19T03:00:00Z');
    const now = () => t;
    await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: mailer({ team: 'ok', confirm: 'fail' }).send, now });
    t = new Date('2026-10-19T03:30:00Z');
    const m = mailer({ team: 'ok', confirm: 'ok' });
    await handleClinicLeadPost({ ...LEAD }, { admin: fakeAdminWithRows(leadRows(db)), send: m.send, now });
    assert.equal(m.confirms(), 0);
  } finally {
    c.restore();
  }
});

test('an FK error mentioning organization_id does not take the old-schema fallback', async () => {
  const c = captureConsole();
  try {
    const db = fakeAdmin({
      leadInsertError: { code: '23503', message: 'insert or update on table "clinic_service_leads" violates foreign key constraint "clinic_service_leads_organization_id_fkey"' },
    });
    const m = mailer({ team: 'ok', confirm: 'ok' });
    const r = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m.send });
    assert.equal(db.log.leadInserts.length, 1, 'no retry without columns');
    assert.ok('organization_id' in db.log.leadInserts[0]);
    assert.equal(r.body.stored, false);
    assert.ok(c.lines.some((l) => /persist 23503/.test(l)));
  } finally {
    c.restore();
  }
});

test('an unknown column (42703) does take the fallback', async () => {
  const c = captureConsole();
  try {
    let calls = 0;
    const db = fakeAdmin();
    const realFrom = db.admin.from.bind(db.admin);
    (db.admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = realFrom(t) as unknown as { run: () => unknown; op: string; row: Row };
      if (t === 'clinic_service_leads') {
        const orig = q.run.bind(q);
        q.run = () => (q.op === 'insert' && 'claimed_at' in q.row && ++calls ? { data: null, error: { code: '42703', message: 'column "claimed_at" does not exist' } } : orig());
      }
      return q;
    };
    const m = mailer({ team: 'ok', confirm: 'ok' });
    const r = await handleClinicLeadPost({ ...LEAD }, { admin: db.admin, send: m.send });
    assert.equal(r.body.stored, true);
    assert.equal(leadRows(db).length, 1);
    assert.ok(!('organization_id' in leadRows(db)[0]));
  } finally {
    c.restore();
  }
});

test('unexpected throw returns a generic 500; detail only in logs; logs carry no clinic name/location', async () => {
  const c = captureConsole();
  try {
    const db = fakeAdmin();
    const r = await handleClinicLeadPost({ ...LEAD }, {
      admin: db.admin,
      send: () => { throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY detail'); },
    });
    assert.equal(r.status, 500);
    assert.doesNotMatch(String(r.body.error), /SUPABASE|detail/);
    assert.ok(c.lines.some((l) => /SUPABASE_SERVICE_ROLE_KEY detail/.test(l)));
    // a normal run plus a 503 run must not log PII
    const m = mailer({ team: 'ok', confirm: 'fail' });
    await handleClinicLeadPost({ ...LEAD, email: 'other@example.test' }, { admin: db.admin, send: m.send });
    await handleClinicLeadPost({ ...LEAD, email: 'third@example.test' }, { admin: null, send: m.send });
    const all = c.lines.join('\n');
    assert.doesNotMatch(all, /Secret Clinic Name|Hiddenville|qa\.lead@|555-0100/);
  } finally {
    c.restore();
  }
});
