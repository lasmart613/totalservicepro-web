/**
 * God Dashboard site-performance KPIs.
 * Counts come from Supabase auth + product tables — not Google Analytics.
 * Import assemble/parse helpers from tests or the API route. The route is
 * still gated by requireGodCaller; this module does not enforce God itself.
 */

export const KPI_DAY_OPTIONS = [7, 14, 30, 90] as const;
export type KpiDays = (typeof KPI_DAY_OPTIONS)[number];
export const DEFAULT_KPI_DAYS: KpiDays = 30;

export const LOGIN_AUDIT_ACTIONS = ['login'] as const;
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;

export const ANALYTICS_CONNECT_NOTE = 'Time on site — connect Google Analytics';
export const ANALYTICS_DETAIL_NOTE =
  'Page views, bounce rate, and visitor geography are not stored in Supabase. Connect Google Analytics (GA4) to measure time on site.';

export type AuthUserLite = {
  created_at?: string | null;
  last_sign_in_at?: string | null;
};

export type KpiMetric = {
  key: string;
  label: string;
  value: number | null;
  available: boolean;
  kind: 'range' | 'snapshot' | 'stub';
  source?: string;
  note?: string;
};

export type GodKpiPayload = {
  ok: true;
  days: KpiDays;
  range: { start: string; end: string };
  rangeMetrics: KpiMetric[];
  snapshotMetrics: KpiMetric[];
  stubs: KpiMetric[];
};

export type GodKpiCounts = {
  newSignups: number | null;
  usersSignedIn: number | null;
  loginEvents: number | null;
  newOrganizations: number | null;
  newTickets: number | null;
  newReports: number | null;
  newEstimates: number | null;
  newInvoices: number | null;
  newListings: number | null;
  authUsersTotal: number | null;
  profilesTotal: number | null;
  activePaidSubscriptions: number | null;
};

export function parseKpiDays(raw: unknown): KpiDays {
  const n = Number(raw);
  return (KPI_DAY_OPTIONS as readonly number[]).includes(n) ? (n as KpiDays) : DEFAULT_KPI_DAYS;
}

export function kpiWindow(days: KpiDays, now: Date = new Date()): { start: string; end: string; days: KpiDays } {
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { days, start: start.toISOString(), end: end.toISOString() };
}

export function isLoginAuditAction(action?: string | null): boolean {
  const raw = String(action || '')
    .trim()
    .toLowerCase();
  return (LOGIN_AUDIT_ACTIONS as readonly string[]).includes(raw);
}

export function loginActionFromAuditPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  const action = row.action ?? (row.payload && typeof row.payload === 'object'
    ? (row.payload as Record<string, unknown>).action
    : null);
  return action == null ? null : String(action);
}

export function countAuthInRange(
  users: AuthUserLite[],
  startIso: string
): { newSignups: number; usersSignedIn: number; total: number } {
  const start = Date.parse(startIso);
  let newSignups = 0;
  let usersSignedIn = 0;
  for (const user of users) {
    if (user.created_at && Date.parse(user.created_at) >= start) newSignups += 1;
    if (user.last_sign_in_at && Date.parse(user.last_sign_in_at) >= start) usersSignedIn += 1;
  }
  return { newSignups, usersSignedIn, total: users.length };
}

function metric(
  partial: Omit<KpiMetric, 'available'> & { available?: boolean }
): KpiMetric {
  const available = partial.available ?? partial.value != null;
  return { ...partial, available };
}

export function assembleGodKpis(input: {
  days: KpiDays;
  start: string;
  end: string;
  counts: GodKpiCounts;
}): GodKpiPayload {
  const { days, start, end, counts } = input;
  return {
    ok: true,
    days,
    range: { start, end },
    rangeMetrics: [
      metric({
        key: 'newSignups',
        label: 'New signups',
        value: counts.newSignups,
        kind: 'range',
        source: 'auth.users.created_at',
        note: 'Auth users created in this range.',
      }),
      metric({
        key: 'usersSignedIn',
        label: 'Users signed in (at least once)',
        value: counts.usersSignedIn,
        kind: 'range',
        source: 'auth.users.last_sign_in_at',
        note: 'Unique users whose last sign-in falls in this range — not a session or login-event count.',
      }),
      metric({
        key: 'loginEvents',
        label: 'Login events',
        value: counts.loginEvents,
        available: counts.loginEvents != null,
        kind: 'range',
        source: counts.loginEvents != null
          ? 'auth.audit_log_entries (payload.action = login)'
          : undefined,
        note:
          counts.loginEvents != null
            ? 'Login audit events in range. This is closer to a true login count than last_sign_in_at.'
            : 'auth.audit_log_entries is not queryable here. Use “Users signed in” as the available proxy.',
      }),
      metric({
        key: 'newOrganizations',
        label: 'New organizations',
        value: counts.newOrganizations,
        kind: 'range',
        source: 'organizations.created_at',
      }),
      metric({
        key: 'newTickets',
        label: 'New service tickets',
        value: counts.newTickets,
        kind: 'range',
        source: 'service_tickets.created_at',
      }),
      metric({
        key: 'newReports',
        label: 'New service reports',
        value: counts.newReports,
        kind: 'range',
        source: 'service_reports.created_at',
      }),
      metric({
        key: 'newEstimates',
        label: 'New estimates',
        value: counts.newEstimates,
        kind: 'range',
        source: 'service_estimates.created_at',
      }),
      metric({
        key: 'newInvoices',
        label: 'New invoices',
        value: counts.newInvoices,
        kind: 'range',
        source: 'service_invoices.created_at',
      }),
      metric({
        key: 'newListings',
        label: 'New marketplace listings',
        value: counts.newListings,
        kind: 'range',
        source: 'marketplace_listings.created_at',
      }),
    ],
    snapshotMetrics: [
      metric({
        key: 'authUsersTotal',
        label: 'Auth users',
        value: counts.authUsersTotal,
        kind: 'snapshot',
        source: 'auth.users',
        note: 'Point-in-time total, not limited to the selected range.',
      }),
      metric({
        key: 'profilesTotal',
        label: 'Profiles',
        value: counts.profilesTotal,
        kind: 'snapshot',
        source: 'user_profiles',
        note: 'Point-in-time total, not limited to the selected range.',
      }),
      metric({
        key: 'activePaidSubscriptions',
        label: 'Active paid subscriptions',
        value: counts.activePaidSubscriptions,
        kind: 'snapshot',
        source: `subscriptions.status in (${ACTIVE_SUBSCRIPTION_STATUSES.join(', ')})`,
        note: 'Point-in-time rows marked active or trialing. Not a Stripe live pull.',
      }),
    ],
    stubs: [
      metric({
        key: 'timeOnSite',
        label: 'Time on site',
        value: null,
        available: false,
        kind: 'stub',
        note: ANALYTICS_CONNECT_NOTE,
      }),
      metric({
        key: 'pageViews',
        label: 'Page views',
        value: null,
        available: false,
        kind: 'stub',
        note: ANALYTICS_DETAIL_NOTE,
      }),
    ],
  };
}

export type GodKpiQuery = {
  select: (
    columns: string,
    options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }
  ) => GodKpiQuery;
  gte: (column: string, value: string) => GodKpiQuery;
  eq: (column: string, value: unknown) => GodKpiQuery;
  in: (column: string, values: readonly string[]) => GodKpiQuery;
  filter: (column: string, operator: string, value: string) => GodKpiQuery;
  then: (
    onFulfilled?: (value: { count: number | null; error: { message?: string } | null }) => unknown
  ) => Promise<unknown>;
};

export type GodKpiAdmin = {
  from: (table: string) => GodKpiQuery;
  schema?: (name: string) => { from: (table: string) => GodKpiQuery };
  auth?: {
    admin?: {
      listUsers: (opts: {
        page: number;
        perPage: number;
      }) => Promise<{
        data?: { users?: AuthUserLite[] } | null;
        error?: { message?: string } | null;
      }>;
    };
  };
};

function isUnavailableError(message?: string | null): boolean {
  return /relation .* does not exist|could not find the table|Could not find the table|schema cache|column|permission denied|not expose/i.test(
    String(message || '')
  );
}

async function settleCount(query: PromiseLike<{ count: number | null; error: { message?: string } | null }>): Promise<number | null> {
  try {
    const { count, error } = await query;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function countPublic(
  admin: GodKpiAdmin,
  table: string,
  apply?: (query: GodKpiQuery) => GodKpiQuery
): Promise<number | null> {
  try {
    let query = admin.from(table).select('id', { count: 'exact', head: true });
    if (apply) query = apply(query);
    return await settleCount(query);
  } catch {
    return null;
  }
}

async function countAuthTable(
  admin: GodKpiAdmin,
  table: string,
  apply?: (query: GodKpiQuery) => GodKpiQuery
): Promise<number | null> {
  if (!admin.schema) return null;
  try {
    let query = admin.schema('auth').from(table).select('id', { count: 'exact', head: true });
    if (apply) query = apply(query);
    const result = await query;
    if (result.error) {
      if (isUnavailableError(result.error.message)) return null;
      return null;
    }
    return result.count ?? 0;
  } catch {
    return null;
  }
}

async function listAllAuthUsers(admin: GodKpiAdmin): Promise<AuthUserLite[] | null> {
  const listUsers = admin.auth?.admin?.listUsers;
  if (!listUsers) return null;
  const users: AuthUserLite[] = [];
  try {
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await listUsers({ page, perPage: 200 });
      if (error) return users.length ? users : null;
      const batch = data?.users || [];
      users.push(...batch);
      if (batch.length < 200) break;
    }
    return users;
  } catch {
    return users.length ? users : null;
  }
}

async function countLoginEvents(admin: GodKpiAdmin, startIso: string): Promise<number | null> {
  const attempts: Array<(query: GodKpiQuery) => GodKpiQuery> = [
    (q) => q.gte('created_at', startIso).filter('payload->>action', 'eq', 'login'),
    (q) => q.gte('created_at', startIso).eq('payload->>action', 'login'),
  ];
  for (const apply of attempts) {
    const count = await countAuthTable(admin, 'audit_log_entries', apply);
    if (count != null) return count;
  }
  return null;
}

export async function fetchGodKpiCounts(admin: GodKpiAdmin | (object & { from: GodKpiAdmin['from'] }), startIso: string): Promise<GodKpiCounts> {
  const client = admin as GodKpiAdmin;
  const listed = await listAllAuthUsers(client);
  const listedCounts = listed ? countAuthInRange(listed, startIso) : null;

  const [
    authCreated,
    authSignedIn,
    authTotal,
    loginEvents,
    newOrganizations,
    newTickets,
    newReports,
    newEstimates,
    newInvoices,
    newListings,
    profilesTotal,
    activePaidSubscriptions,
  ] = await Promise.all([
    listedCounts
      ? Promise.resolve(listedCounts.newSignups)
      : countAuthTable(client, 'users', (q) => q.gte('created_at', startIso)),
    listedCounts
      ? Promise.resolve(listedCounts.usersSignedIn)
      : countAuthTable(client, 'users', (q) => q.gte('last_sign_in_at', startIso)),
    listedCounts
      ? Promise.resolve(listedCounts.total)
      : countAuthTable(client, 'users'),
    countLoginEvents(client, startIso),
    countPublic(client, 'organizations', (q) => q.gte('created_at', startIso)),
    countPublic(client, 'service_tickets', (q) => q.gte('created_at', startIso)),
    countPublic(client, 'service_reports', (q) => q.gte('created_at', startIso)),
    countPublic(client, 'service_estimates', (q) => q.gte('created_at', startIso)),
    countPublic(client, 'service_invoices', (q) => q.gte('created_at', startIso)),
    countPublic(client, 'marketplace_listings', (q) => q.gte('created_at', startIso)),
    countPublic(client, 'user_profiles'),
    countPublic(client, 'subscriptions', (q) => q.in('status', ACTIVE_SUBSCRIPTION_STATUSES)),
  ]);

  return {
    newSignups: authCreated,
    usersSignedIn: authSignedIn,
    loginEvents,
    newOrganizations,
    newTickets,
    newReports,
    newEstimates,
    newInvoices,
    newListings,
    authUsersTotal: authTotal,
    profilesTotal,
    activePaidSubscriptions,
  };
}

export async function loadGodKpis(
  admin: GodKpiAdmin | (object & { from: GodKpiAdmin['from'] }),
  days: KpiDays,
  now: Date = new Date()
): Promise<GodKpiPayload> {
  const window = kpiWindow(days, now);
  const counts = await fetchGodKpiCounts(admin, window.start);
  return assembleGodKpis({ days, start: window.start, end: window.end, counts });
}
