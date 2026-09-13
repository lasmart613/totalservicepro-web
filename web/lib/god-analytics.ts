/**
 * God Dashboard GA4 analytics — types, parsers, and payload assembly.
 * Safe to import from client UI for constants/types only. The Data API client
 * and JWT live in ga4-data.ts (server-only). Never expose service-account
 * secrets to the browser.
 *
 * Property: Living Free - GA4 (365480892)
 * Stream: RepairPlanet → https://repairplanet.net (G-GNBJQ2DMQB)
 * Soft beta: no Google Ads linking. Site gtag (G-GNBJQ2DMQB) is separate
 * from this Data API reader; numbers appear once a service account is linked.
 */

export const GOD_ANALYTICS_PATH = '/admin/god/analytics';

export const GA4_DEFAULT_PROPERTY_ID = '365480892';
export const GA4_DEFAULT_MEASUREMENT_ID = 'G-GNBJQ2DMQB';
export const GA4_PROPERTY_NAME = 'Living Free - GA4';
export const GA4_STREAM_NAME = 'RepairPlanet';
export const GA4_SITE_HOST = 'repairplanet.net';

export const GA4_READONLY_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
export const GA4_TOKEN_AUD = 'https://oauth2.googleapis.com/token';
export const GA4_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

export const ANALYTICS_PERIODS = ['today', '7d', '30d'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const ANALYTICS_PERIOD_LABEL: Record<AnalyticsPeriod, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
};

export type AnalyticsStatus =
  | 'ok'
  | 'missing_credentials'
  | 'invalid_credentials'
  | 'ga4_error'
  | 'empty';

export type Ga4ServiceAccount = {
  clientEmail: string;
  privateKey: string;
};

export type Ga4Config = {
  configured: boolean;
  reason?: 'missing_credentials' | 'invalid_credentials';
  propertyId: string;
  measurementId: string;
  clientEmail?: string;
  account: Ga4ServiceAccount | null;
};

export type AnalyticsTotals = {
  users: number | null;
  newUsers: number | null;
  sessions: number | null;
  pageViews: number | null;
  bounceRate: number | null;
  avgSessionSeconds: number | null;
  engagedSessions: number | null;
};

export type AnalyticsRow = {
  label: string;
  value: number;
  extra?: Record<string, number | null>;
};

export type AnalyticsEventRow = {
  name: string;
  count: number;
  tsp: boolean;
};

export type TspEventRow = {
  key: string;
  label: string;
  count: number | null;
  tagged: boolean;
};

export type GodAnalyticsSetup = {
  propertyId: string;
  propertyName: string;
  measurementId: string;
  streamName: string;
  site: string;
  envVars: string[];
  steps: string[];
};

export type GodAnalyticsPayload = {
  ok: true;
  status: AnalyticsStatus;
  configured: boolean;
  propertyId: string;
  measurementId: string;
  propertyName: string;
  streamName: string;
  site: string;
  fetchedAt: string;
  realtimeUsers: number | null;
  periods: Record<AnalyticsPeriod, AnalyticsTotals>;
  topPages: AnalyticsRow[];
  landingPages: AnalyticsRow[];
  channels: AnalyticsRow[];
  devices: AnalyticsRow[];
  countries: AnalyticsRow[];
  events: AnalyticsEventRow[];
  tspEvents: TspEventRow[];
  message?: string;
  setup: GodAnalyticsSetup;
};

export type Ga4ReportRow = {
  dimensionValues?: Array<{ value?: string | null }>;
  metricValues?: Array<{ value?: string | null }>;
};

export type Ga4ReportResponse = {
  dimensionHeaders?: Array<{ name?: string }>;
  metricHeaders?: Array<{ name?: string }>;
  rows?: Ga4ReportRow[];
  rowCount?: number;
  error?: { code?: number; message?: string; status?: string };
};

export type Ga4DataClient = {
  runReport: (body: Record<string, unknown>) => Promise<Ga4ReportResponse>;
  runRealtimeReport: (body: Record<string, unknown>) => Promise<Ga4ReportResponse>;
};

export const TSP_EVENT_DEFS = [
  { key: 'sign_up', label: 'Sign up', names: ['sign_up', 'signup', 'sign-up'] },
  { key: 'login', label: 'Login', names: ['login', 'log_in'] },
  { key: 'logout', label: 'Logout', names: ['logout', 'log_out'] },
  { key: 'generate_lead', label: 'Generate lead', names: ['generate_lead'] },
  { key: 'purchase', label: 'Purchase', names: ['purchase'] },
  { key: 'begin_checkout', label: 'Begin checkout', names: ['begin_checkout'] },
] as const;

export const ANALYTICS_SETUP_ENV_VARS = [
  'GA4_PROPERTY_ID',
  'GA4_MEASUREMENT_ID',
  'GA4_SERVICE_ACCOUNT_JSON',
  'GA4_CLIENT_EMAIL',
  'GA4_PRIVATE_KEY',
] as const;

export const ANALYTICS_SETUP_STEPS = [
  'In Google Cloud, enable the Google Analytics Data API on a project you control.',
  'Create a service account (Viewer is enough) and download a JSON key. Do not commit the key.',
  'In GA4 Admin → Property access management for Living Free - GA4 (365480892), add the service account email as Viewer. Soft beta: do not link Google Ads.',
  'In Netlify (and web/.env.local) set GA4_PROPERTY_ID=365480892 and either GA4_SERVICE_ACCOUNT_JSON (raw or base64 JSON) or GA4_CLIENT_EMAIL + GA4_PRIVATE_KEY.',
  'Redeploy. Site gtag (G-GNBJQ2DMQB) is already on the web app; this dashboard reads the Data API once the service account is linked and the stream has hits.',
] as const;

const DEFAULT_TOTALS: AnalyticsTotals = {
  users: null,
  newUsers: null,
  sessions: null,
  pageViews: null,
  bounceRate: null,
  avgSessionSeconds: null,
  engagedSessions: null,
};

export function emptyTotals(): AnalyticsTotals {
  return { ...DEFAULT_TOTALS };
}

export function analyticsSetup(config?: Pick<Ga4Config, 'propertyId' | 'measurementId'>): GodAnalyticsSetup {
  return {
    propertyId: config?.propertyId || GA4_DEFAULT_PROPERTY_ID,
    propertyName: GA4_PROPERTY_NAME,
    measurementId: config?.measurementId || GA4_DEFAULT_MEASUREMENT_ID,
    streamName: GA4_STREAM_NAME,
    site: `https://${GA4_SITE_HOST}`,
    envVars: [...ANALYTICS_SETUP_ENV_VARS],
    steps: [...ANALYTICS_SETUP_STEPS],
  };
}

export function normalizeGa4PropertyId(raw?: string | null): string {
  const digits = String(raw || '')
    .trim()
    .replace(/^properties\//i, '')
    .replace(/\D/g, '');
  return /^\d{6,12}$/.test(digits) ? digits : GA4_DEFAULT_PROPERTY_ID;
}

export function normalizeGa4MeasurementId(raw?: string | null): string {
  const id = String(raw || '')
    .trim()
    .toUpperCase();
  return /^G-[A-Z0-9]+$/.test(id) ? id : GA4_DEFAULT_MEASUREMENT_ID;
}

export function normalizePem(raw?: string | null): string {
  let key = String(raw || '').trim();
  if (!key) return '';
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  return key;
}

function parseJsonBlob(raw?: string | null): Record<string, unknown> | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const attempts = [trimmed];
  try {
    attempts.push(Buffer.from(trimmed, 'base64').toString('utf8'));
  } catch {
    /* ignore */
  }
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

export function parseGa4ServiceAccount(env: NodeJS.ProcessEnv = process.env): {
  account: Ga4ServiceAccount | null;
  reason?: 'missing_credentials' | 'invalid_credentials';
} {
  const json = parseJsonBlob(env.GA4_SERVICE_ACCOUNT_JSON);
  const email = String(json?.client_email || env.GA4_CLIENT_EMAIL || '')
    .trim()
    .toLowerCase();
  const privateKey = normalizePem(String(json?.private_key || env.GA4_PRIVATE_KEY || ''));
  if (!email && !privateKey) return { account: null, reason: 'missing_credentials' };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { account: null, reason: 'invalid_credentials' };
  }
  if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    return { account: null, reason: 'invalid_credentials' };
  }
  return { account: { clientEmail: email, privateKey } };
}

export function parseGa4Config(env: NodeJS.ProcessEnv = process.env): Ga4Config {
  const propertyId = normalizeGa4PropertyId(env.GA4_PROPERTY_ID);
  const measurementId = normalizeGa4MeasurementId(env.GA4_MEASUREMENT_ID);
  const parsed = parseGa4ServiceAccount(env);
  return {
    configured: Boolean(parsed.account),
    reason: parsed.account ? undefined : parsed.reason,
    propertyId,
    measurementId,
    clientEmail: parsed.account?.clientEmail,
    account: parsed.account,
  };
}

export function emptyAnalyticsPayload(
  config: Ga4Config,
  status: AnalyticsStatus,
  message?: string,
  now: Date = new Date()
): GodAnalyticsPayload {
  return {
    ok: true,
    status,
    configured: config.configured,
    propertyId: config.propertyId,
    measurementId: config.measurementId,
    propertyName: GA4_PROPERTY_NAME,
    streamName: GA4_STREAM_NAME,
    site: `https://${GA4_SITE_HOST}`,
    fetchedAt: now.toISOString(),
    realtimeUsers: null,
    periods: {
      today: emptyTotals(),
      '7d': emptyTotals(),
      '30d': emptyTotals(),
    },
    topPages: [],
    landingPages: [],
    channels: [],
    devices: [],
    countries: [],
    events: [],
    tspEvents: TSP_EVENT_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      count: null,
      tagged: false,
    })),
    message,
    setup: analyticsSetup(config),
  };
}

export function parseMetricNumber(raw?: string | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function headerIndex(headers: Array<{ name?: string }> | undefined, name: string): number {
  return (headers || []).findIndex((h) => String(h.name || '').toLowerCase() === name.toLowerCase());
}

export function rowDimension(row: Ga4ReportRow, index: number): string {
  return String(row.dimensionValues?.[index]?.value || '').trim();
}

export function rowMetric(row: Ga4ReportRow, index: number): number | null {
  return parseMetricNumber(row.metricValues?.[index]?.value);
}

export function dateRangeName(row: Ga4ReportRow, headers?: Array<{ name?: string }>): string {
  const idx = headerIndex(headers, 'dateRange');
  if (idx >= 0) return rowDimension(row, idx);
  return rowDimension(row, (row.dimensionValues || []).length - 1);
}

const OVERVIEW_METRICS = [
  'activeUsers',
  'newUsers',
  'sessions',
  'screenPageViews',
  'bounceRate',
  'averageSessionDuration',
  'engagedSessions',
] as const;

export function overviewReportBody(): Record<string, unknown> {
  return {
    dateRanges: [
      { startDate: 'today', endDate: 'today', name: 'today' },
      { startDate: '7daysAgo', endDate: 'today', name: '7d' },
      { startDate: '30daysAgo', endDate: 'today', name: '30d' },
    ],
    metrics: OVERVIEW_METRICS.map((name) => ({ name })),
  };
}

export function rankedReportBody(
  dimension: string,
  metrics: string[],
  limit: number,
  orderMetric = metrics[0]
): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today', name: '30d' }],
    dimensions: [{ name: dimension }],
    metrics: metrics.map((name) => ({ name })),
    limit,
    orderBys: [{ metric: { metricName: orderMetric }, desc: true }],
  };
}

export function realtimeReportBody(): Record<string, unknown> {
  return { metrics: [{ name: 'activeUsers' }] };
}

export function parseOverviewPeriods(report: Ga4ReportResponse | null | undefined): Record<AnalyticsPeriod, AnalyticsTotals> {
  const periods: Record<AnalyticsPeriod, AnalyticsTotals> = {
    today: emptyTotals(),
    '7d': emptyTotals(),
    '30d': emptyTotals(),
  };
  if (!report?.rows?.length) return periods;
  const metrics = report.metricHeaders || [];
  const idx = {
    users: headerIndex(metrics, 'activeUsers'),
    newUsers: headerIndex(metrics, 'newUsers'),
    sessions: headerIndex(metrics, 'sessions'),
    pageViews: headerIndex(metrics, 'screenPageViews'),
    bounceRate: headerIndex(metrics, 'bounceRate'),
    avgSessionSeconds: headerIndex(metrics, 'averageSessionDuration'),
    engagedSessions: headerIndex(metrics, 'engagedSessions'),
  };
  for (const row of report.rows) {
    const name = dateRangeName(row, report.dimensionHeaders) as AnalyticsPeriod;
    if (!(ANALYTICS_PERIODS as readonly string[]).includes(name)) continue;
    periods[name] = {
      users: rowMetric(row, idx.users),
      newUsers: rowMetric(row, idx.newUsers),
      sessions: rowMetric(row, idx.sessions),
      pageViews: rowMetric(row, idx.pageViews),
      bounceRate: rowMetric(row, idx.bounceRate),
      avgSessionSeconds: rowMetric(row, idx.avgSessionSeconds),
      engagedSessions: rowMetric(row, idx.engagedSessions),
    };
  }
  return periods;
}

export function parseRankedRows(
  report: Ga4ReportResponse | null | undefined,
  opts: { dimension: string; valueMetric: string; extraMetrics?: string[]; limit?: number }
): AnalyticsRow[] {
  if (!report?.rows?.length) return [];
  const dimIdx = headerIndex(report.dimensionHeaders, opts.dimension);
  const valueIdx = headerIndex(report.metricHeaders, opts.valueMetric);
  if (dimIdx < 0 || valueIdx < 0) return [];
  const extraIdx = (opts.extraMetrics || []).map((name) => ({
    name,
    index: headerIndex(report.metricHeaders, name),
  }));
  const rows: AnalyticsRow[] = [];
  for (const row of report.rows) {
    const label = rowDimension(row, dimIdx);
    const value = rowMetric(row, valueIdx);
    if (!label || value == null) continue;
    const extra: Record<string, number | null> = {};
    for (const item of extraIdx) {
      if (item.index >= 0) extra[item.name] = rowMetric(row, item.index);
    }
    rows.push({ label, value, extra: Object.keys(extra).length ? extra : undefined });
    if (opts.limit && rows.length >= opts.limit) break;
  }
  return rows;
}

export function parseRealtimeUsers(report: Ga4ReportResponse | null | undefined): number | null {
  if (!report?.rows?.length) {
    if (report && !report.error) return 0;
    return null;
  }
  const idx = headerIndex(report.metricHeaders, 'activeUsers');
  return rowMetric(report.rows[0], idx >= 0 ? idx : 0);
}

export function parseEventRows(report: Ga4ReportResponse | null | undefined): AnalyticsEventRow[] {
  const rows = parseRankedRows(report, { dimension: 'eventName', valueMetric: 'eventCount', limit: 25 });
  return rows.map((row) => ({
    name: row.label,
    count: row.value,
    tsp: isTspEventName(row.label),
  }));
}

export function isTspEventName(name?: string | null): boolean {
  const raw = String(name || '')
    .trim()
    .toLowerCase();
  return TSP_EVENT_DEFS.some((def) => (def.names as readonly string[]).includes(raw));
}

export function assembleTspEvents(events: AnalyticsEventRow[]): TspEventRow[] {
  return TSP_EVENT_DEFS.map((def) => {
    const match = events.find((event) => (def.names as readonly string[]).includes(event.name.toLowerCase()));
    return {
      key: def.key,
      label: def.label,
      count: match ? match.count : null,
      tagged: Boolean(match),
    };
  });
}

export function sanitizeGa4Error(error: unknown): string {
  const raw =
    (error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '') || (error instanceof Error ? error.message : String(error || ''));
  const cleaned = raw
    .replace(/-----BEGIN[\s\S]+?-----END [A-Z ]+-----/g, '[redacted]')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/"private_key"\s*:\s*"[^"]+"/g, '"private_key":"[redacted]"')
    .slice(0, 280);
  return cleaned || 'Google Analytics Data API request failed.';
}

export function hasAnyAnalyticsData(payload: Pick<GodAnalyticsPayload, 'periods' | 'topPages' | 'events' | 'realtimeUsers'>): boolean {
  if ((payload.realtimeUsers ?? 0) > 0) return true;
  if (payload.topPages.length || payload.events.length) return true;
  return ANALYTICS_PERIODS.some((period) => {
    const totals = payload.periods[period];
    return (totals.users ?? 0) > 0 || (totals.sessions ?? 0) > 0 || (totals.pageViews ?? 0) > 0;
  });
}

export function assembleGodAnalytics(input: {
  config: Ga4Config;
  now?: Date;
  realtime?: Ga4ReportResponse | null;
  overview?: Ga4ReportResponse | null;
  pages?: Ga4ReportResponse | null;
  landings?: Ga4ReportResponse | null;
  channels?: Ga4ReportResponse | null;
  devices?: Ga4ReportResponse | null;
  countries?: Ga4ReportResponse | null;
  events?: Ga4ReportResponse | null;
  errors?: string[];
}): GodAnalyticsPayload {
  const events = parseEventRows(input.events);
  const payload: GodAnalyticsPayload = {
    ok: true,
    status: 'ok',
    configured: true,
    propertyId: input.config.propertyId,
    measurementId: input.config.measurementId,
    propertyName: GA4_PROPERTY_NAME,
    streamName: GA4_STREAM_NAME,
    site: `https://${GA4_SITE_HOST}`,
    fetchedAt: (input.now || new Date()).toISOString(),
    realtimeUsers: parseRealtimeUsers(input.realtime),
    periods: parseOverviewPeriods(input.overview),
    topPages: parseRankedRows(input.pages, {
      dimension: 'pagePath',
      valueMetric: 'screenPageViews',
      extraMetrics: ['activeUsers', 'sessions'],
      limit: 10,
    }),
    landingPages: parseRankedRows(input.landings, {
      dimension: 'landingPage',
      valueMetric: 'sessions',
      extraMetrics: ['activeUsers'],
      limit: 10,
    }),
    channels: parseRankedRows(input.channels, {
      dimension: 'sessionDefaultChannelGroup',
      valueMetric: 'sessions',
      extraMetrics: ['activeUsers', 'newUsers'],
      limit: 10,
    }),
    devices: parseRankedRows(input.devices, {
      dimension: 'deviceCategory',
      valueMetric: 'sessions',
      extraMetrics: ['activeUsers'],
      limit: 8,
    }),
    countries: parseRankedRows(input.countries, {
      dimension: 'country',
      valueMetric: 'activeUsers',
      extraMetrics: ['sessions'],
      limit: 8,
    }),
    events,
    tspEvents: assembleTspEvents(events),
    setup: analyticsSetup(input.config),
  };

  const errors = (input.errors || []).filter(Boolean);
  if (errors.length && !hasAnyAnalyticsData(payload)) {
    payload.status = 'ga4_error';
    payload.message = errors[0];
    return payload;
  }
  if (!hasAnyAnalyticsData(payload)) {
    payload.status = 'empty';
    payload.message =
      'No GA4 hits yet. Property is linked. Site gtag (G-GNBJQ2DMQB) is live — numbers appear once the RepairPlanet stream receives data.';
    return payload;
  }
  if (errors.length) {
    payload.message = `Loaded partial GA4 data. ${errors[0]}`;
  }
  return payload;
}

export function loadGodAnalyticsFromReports(input: {
  config: Ga4Config;
  now?: Date;
  realtime?: Ga4ReportResponse | null;
  overview?: Ga4ReportResponse | null;
  pages?: Ga4ReportResponse | null;
  landings?: Ga4ReportResponse | null;
  channels?: Ga4ReportResponse | null;
  devices?: Ga4ReportResponse | null;
  countries?: Ga4ReportResponse | null;
  events?: Ga4ReportResponse | null;
  errors?: string[];
}): GodAnalyticsPayload {
  if (!input.config.account) {
    const status = input.config.reason === 'invalid_credentials' ? 'invalid_credentials' : 'missing_credentials';
    const message =
      status === 'invalid_credentials'
        ? 'GA4 service account env is present but not valid. Check GA4_SERVICE_ACCOUNT_JSON or GA4_CLIENT_EMAIL + GA4_PRIVATE_KEY. Never paste the key into the browser.'
        : 'GA4 is not linked yet. Add a service account in Netlify env (names only in git) and grant it Viewer on Living Free - GA4.';
    return emptyAnalyticsPayload(input.config, status, message, input.now);
  }
  return assembleGodAnalytics(input);
}
