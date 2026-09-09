import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYTICS_CONNECT_NOTE,
  DEFAULT_KPI_DAYS,
  KPI_DAY_OPTIONS,
  assembleGodKpis,
  countAuthInRange,
  fetchGodKpiCounts,
  isLoginAuditAction,
  kpiWindow,
  loadGodKpis,
  loginActionFromAuditPayload,
  parseKpiDays,
  type GodKpiAdmin,
  type GodKpiQuery,
} from './god-kpis.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('parseKpiDays only accepts 7 / 14 / 30 / 90 and defaults to 30', () => {
  assert.deepEqual(KPI_DAY_OPTIONS, [7, 14, 30, 90]);
  assert.equal(DEFAULT_KPI_DAYS, 30);
  assert.equal(parseKpiDays('7'), 7);
  assert.equal(parseKpiDays(14), 14);
  assert.equal(parseKpiDays('30'), 30);
  assert.equal(parseKpiDays('90'), 90);
  assert.equal(parseKpiDays('0'), 30);
  assert.equal(parseKpiDays('365'), 30);
  assert.equal(parseKpiDays(undefined), 30);
  assert.equal(parseKpiDays('nope'), 30);
});

test('kpiWindow is exclusive of days before the frozen now', () => {
  const now = new Date('2026-09-09T18:00:00.000Z');
  const win = kpiWindow(30, now);
  assert.equal(win.days, 30);
  assert.equal(win.end, '2026-09-09T18:00:00.000Z');
  assert.equal(win.start, '2026-08-10T18:00:00.000Z');
  assert.equal(kpiWindow(7, now).start, '2026-09-02T18:00:00.000Z');
});

test('countAuthInRange uses created_at and last_sign_in_at against the window start', () => {
  const start = '2026-08-10T18:00:00.000Z';
  const counts = countAuthInRange(
    [
      { created_at: '2026-08-11T00:00:00.000Z', last_sign_in_at: '2026-09-01T00:00:00.000Z' },
      { created_at: '2026-01-01T00:00:00.000Z', last_sign_in_at: '2026-08-10T18:00:00.000Z' },
      { created_at: '2026-08-10T17:59:59.000Z', last_sign_in_at: '2026-07-01T00:00:00.000Z' },
      { created_at: '2026-09-01T00:00:00.000Z', last_sign_in_at: null },
    ],
    start
  );
  assert.equal(counts.total, 4);
  assert.equal(counts.newSignups, 2);
  assert.equal(counts.usersSignedIn, 2);
});

test('login audit helper only treats login as a login event', () => {
  assert.equal(isLoginAuditAction('login'), true);
  assert.equal(isLoginAuditAction('LOGIN'), true);
  assert.equal(isLoginAuditAction('token_refreshed'), false);
  assert.equal(isLoginAuditAction('user_signedup'), false);
  assert.equal(isLoginAuditAction(null), false);
  assert.equal(loginActionFromAuditPayload({ action: 'login' }), 'login');
  assert.equal(loginActionFromAuditPayload({ payload: { action: 'logout' } }), 'logout');
  assert.equal(loginActionFromAuditPayload(null), null);
});

test('assembleGodKpis labels proxies honestly and never invents GA numbers', () => {
  const payload = assembleGodKpis({
    days: 30,
    start: '2026-08-10T18:00:00.000Z',
    end: '2026-09-09T18:00:00.000Z',
    counts: {
      newSignups: 4,
      usersSignedIn: 11,
      loginEvents: null,
      newOrganizations: 2,
      newTickets: 8,
      newReports: 3,
      newEstimates: 1,
      newInvoices: 0,
      newListings: 5,
      authUsersTotal: 40,
      profilesTotal: 38,
      activePaidSubscriptions: 6,
    },
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.days, 30);
  const byKey = Object.fromEntries(
    [...payload.rangeMetrics, ...payload.snapshotMetrics, ...payload.stubs].map((m) => [m.key, m])
  );
  assert.equal(byKey.newSignups.label, 'New signups');
  assert.equal(byKey.newSignups.value, 4);
  assert.equal(byKey.usersSignedIn.label, 'Users signed in (at least once)');
  assert.match(byKey.usersSignedIn.note || '', /not a session/i);
  assert.equal(byKey.loginEvents.available, false);
  assert.equal(byKey.loginEvents.value, null);
  assert.match(byKey.loginEvents.note || '', /audit_log_entries/i);
  assert.equal(byKey.newInvoices.value, 0);
  assert.equal(byKey.newInvoices.available, true);
  assert.equal(byKey.activePaidSubscriptions.value, 6);
  assert.equal(byKey.timeOnSite.available, false);
  assert.equal(byKey.timeOnSite.value, null);
  assert.equal(byKey.timeOnSite.note, ANALYTICS_CONNECT_NOTE);
  assert.equal(byKey.pageViews.value, null);
});

test('assembleGodKpis documents audit-log login events when the count is present', () => {
  const payload = assembleGodKpis({
    days: 7,
    start: '2026-09-02T18:00:00.000Z',
    end: '2026-09-09T18:00:00.000Z',
    counts: {
      newSignups: 1,
      usersSignedIn: 2,
      loginEvents: 9,
      newOrganizations: 0,
      newTickets: 0,
      newReports: 0,
      newEstimates: 0,
      newInvoices: 0,
      newListings: 0,
      authUsersTotal: 10,
      profilesTotal: 9,
      activePaidSubscriptions: 1,
    },
  });
  const login = payload.rangeMetrics.find((m) => m.key === 'loginEvents');
  assert.equal(login?.available, true);
  assert.equal(login?.value, 9);
  assert.match(login?.source || '', /audit_log_entries/);
});

function thenableCount(count: number | null, error: { message?: string } | null = null): GodKpiQuery {
  const self = {
    select() {
      return self;
    },
    gte() {
      return self;
    },
    eq() {
      return self;
    },
    in() {
      return self;
    },
    filter() {
      return self;
    },
    then(onFulfilled?: (value: { count: number | null; error: { message?: string } | null }) => unknown) {
      return Promise.resolve({ count, error }).then(onFulfilled);
    },
  };
  return self as GodKpiQuery;
}

test('fetchGodKpiCounts prefers listUsers for auth totals and leaves login events null when audit is closed', async () => {
  const users = [
    { created_at: '2026-09-01T00:00:00.000Z', last_sign_in_at: '2026-09-08T00:00:00.000Z' },
    { created_at: '2026-01-01T00:00:00.000Z', last_sign_in_at: '2026-01-02T00:00:00.000Z' },
  ];
  const admin: GodKpiAdmin = {
    from(table: string) {
      const counts: Record<string, number> = {
        organizations: 3,
        service_tickets: 7,
        service_reports: 2,
        service_estimates: 1,
        service_invoices: 4,
        marketplace_listings: 6,
        user_profiles: 21,
        subscriptions: 5,
      };
      return thenableCount(counts[table] ?? 0);
    },
    schema() {
      return {
        from() {
          return thenableCount(null, { message: 'permission denied for schema auth' });
        },
      };
    },
    auth: {
      admin: {
        async listUsers({ page }) {
          if (page > 1) return { data: { users: [] }, error: null };
          return { data: { users }, error: null };
        },
      },
    },
  };

  const counts = await fetchGodKpiCounts(admin, '2026-08-10T18:00:00.000Z');
  assert.equal(counts.newSignups, 1);
  assert.equal(counts.usersSignedIn, 1);
  assert.equal(counts.authUsersTotal, 2);
  assert.equal(counts.loginEvents, null);
  assert.equal(counts.newOrganizations, 3);
  assert.equal(counts.newTickets, 7);
  assert.equal(counts.newListings, 6);
  assert.equal(counts.profilesTotal, 21);
  assert.equal(counts.activePaidSubscriptions, 5);
});

test('loadGodKpis uses mocked now and wires range + snapshot cards', async () => {
  const admin: GodKpiAdmin = {
    from() {
      return thenableCount(0);
    },
    schema() {
      return {
        from(table: string) {
          if (table === 'audit_log_entries') return thenableCount(12);
          if (table === 'users') return thenableCount(8);
          return thenableCount(null, { message: 'Could not find the table' });
        },
      };
    },
  };
  const payload = await loadGodKpis(admin, 14, new Date('2026-09-09T18:00:00.000Z'));
  assert.equal(payload.days, 14);
  assert.equal(payload.range.start, '2026-08-26T18:00:00.000Z');
  assert.equal(payload.rangeMetrics.find((m) => m.key === 'loginEvents')?.value, 12);
  assert.equal(payload.rangeMetrics.find((m) => m.key === 'newSignups')?.value, 8);
  assert.equal(payload.stubs[0]?.value, null);
});

test('God KPI API stays behind requireGodCaller and the home page mounts the board', () => {
  const api = readFileSync(join(here, '../app/api/god/kpis/route.ts'), 'utf8');
  const page = readFileSync(join(here, '../app/admin/god/page.tsx'), 'utf8');
  const board = readFileSync(join(here, '../components/god/GodKpiBoard.tsx'), 'utf8');
  assert.match(api, /requireGodCaller/);
  assert.match(api, /parseKpiDays/);
  assert.match(api, /loadGodKpis/);
  assert.doesNotMatch(api, /process\.env/);
  assert.match(page, /GodKpiBoard/);
  assert.match(board, /KPI_DAY_OPTIONS/);
  assert.match(board, /\{option\} days/);
  assert.match(board, /\/api\/god\/kpis\?days=/);
  assert.match(board, /Site performance/);
  assert.match(board, /Google Analytics/);
});
