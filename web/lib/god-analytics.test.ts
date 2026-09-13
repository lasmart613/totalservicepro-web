import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYTICS_SETUP_ENV_VARS,
  GA4_DEFAULT_MEASUREMENT_ID,
  GA4_DEFAULT_PROPERTY_ID,
  GOD_ANALYTICS_PATH,
  assembleGodAnalytics,
  assembleTspEvents,
  emptyAnalyticsPayload,
  hasAnyAnalyticsData,
  isTspEventName,
  loadGodAnalyticsFromReports,
  normalizeGa4MeasurementId,
  normalizeGa4PropertyId,
  normalizePem,
  parseEventRows,
  parseGa4Config,
  parseOverviewPeriods,
  parseRankedRows,
  parseRealtimeUsers,
  sanitizeGa4Error,
  type Ga4Config,
  type Ga4ReportResponse,
} from './god-analytics.ts';
import { clearGa4TokenCache, loadGodAnalytics, signGa4Jwt } from './ga4-data.ts';

const here = dirname(fileURLToPath(import.meta.url));

function report(opts: {
  dimensions?: string[];
  metrics: string[];
  rows: Array<{ dims?: string[]; metrics: Array<string | number> }>;
}): Ga4ReportResponse {
  return {
    dimensionHeaders: (opts.dimensions || []).map((name) => ({ name })),
    metricHeaders: opts.metrics.map((name) => ({ name })),
    rows: opts.rows.map((row) => ({
      dimensionValues: (row.dims || []).map((value) => ({ value })),
      metricValues: row.metrics.map((value) => ({ value: String(value) })),
    })),
  };
}

function configured(env: Record<string, string> = {}): Ga4Config {
  return parseGa4Config({
    GA4_CLIENT_EMAIL: 'reader@project.iam.gserviceaccount.com',
    GA4_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    ...env,
  });
}

test('GA4 property and measurement ids default to RepairPlanet Living Free', () => {
  assert.equal(GA4_DEFAULT_PROPERTY_ID, '365480892');
  assert.equal(GA4_DEFAULT_MEASUREMENT_ID, 'G-GNBJQ2DMQB');
  assert.equal(GOD_ANALYTICS_PATH, '/admin/god/analytics');
  assert.equal(normalizeGa4PropertyId('properties/365480892'), '365480892');
  assert.equal(normalizeGa4PropertyId('nope'), '365480892');
  assert.equal(normalizeGa4MeasurementId('g-gnbjq2dmqb'), 'G-GNBJQ2DMQB');
  assert.equal(normalizeGa4MeasurementId('junk'), 'G-GNBJQ2DMQB');
});

test('parseGa4Config stays unset until a service account is present', () => {
  const missing = parseGa4Config({});
  assert.equal(missing.configured, false);
  assert.equal(missing.reason, 'missing_credentials');
  assert.equal(missing.propertyId, '365480892');
  assert.equal(missing.account, null);

  const invalid = parseGa4Config({
    GA4_CLIENT_EMAIL: 'not-an-email',
    GA4_PRIVATE_KEY: 'nope',
  });
  assert.equal(invalid.configured, false);
  assert.equal(invalid.reason, 'invalid_credentials');

  const json = parseGa4Config({
    GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'ga4@project.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
    }),
  });
  assert.equal(json.configured, true);
  assert.equal(json.account?.clientEmail, 'ga4@project.iam.gserviceaccount.com');
  assert.match(json.account?.privateKey || '', /BEGIN PRIVATE KEY/);
});

test('parseGa4Config accepts base64 JSON and literal \\n private keys', () => {
  const raw = JSON.stringify({
    client_email: 'b64@project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nXYZ\n-----END PRIVATE KEY-----\n',
  });
  const fromB64 = parseGa4Config({
    GA4_SERVICE_ACCOUNT_JSON: Buffer.from(raw, 'utf8').toString('base64'),
  });
  assert.equal(fromB64.account?.clientEmail, 'b64@project.iam.gserviceaccount.com');
  assert.equal(
    normalizePem('-----BEGIN PRIVATE KEY-----\\nXYZ\\n-----END PRIVATE KEY-----\\n').includes('\nXYZ\n'),
    true
  );
});

test('overview / ranked / realtime parsers map GA4 rows without inventing traffic', () => {
  const periods = parseOverviewPeriods(
    report({
      dimensions: ['dateRange'],
      metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'bounceRate', 'averageSessionDuration'],
      rows: [
        { dims: ['today'], metrics: [3, 1, 4, 9, 0.25, 42] },
        { dims: ['7d'], metrics: [11, 6, 20, 40, 0.4, 90] },
        { dims: ['30d'], metrics: [40, 18, 70, 200, 0.5, 110] },
      ],
    })
  );
  assert.equal(periods.today.users, 3);
  assert.equal(periods.today.newUsers, 1);
  assert.equal(periods['7d'].sessions, 20);
  assert.equal(periods['30d'].pageViews, 200);
  assert.equal(periods.today.bounceRate, 0.25);
  assert.deepEqual(parseOverviewPeriods({ rows: [] }).today.users, null);

  const pages = parseRankedRows(
    report({
      dimensions: ['pagePath'],
      metrics: ['screenPageViews', 'sessions'],
      rows: [
        { dims: ['/'], metrics: [12, 8] },
        { dims: ['/login'], metrics: [5, 3] },
      ],
    }),
    { dimension: 'pagePath', valueMetric: 'screenPageViews', extraMetrics: ['sessions'], limit: 10 }
  );
  assert.equal(pages[0]?.label, '/');
  assert.equal(pages[0]?.value, 12);
  assert.equal(pages[0]?.extra?.sessions, 8);
  assert.equal(parseRealtimeUsers(report({ metrics: ['activeUsers'], rows: [{ metrics: [2] }] })), 2);
  assert.equal(parseRealtimeUsers({ rows: [] }), 0);
});

test('TSP event helpers only mark known product events', () => {
  assert.equal(isTspEventName('sign_up'), true);
  assert.equal(isTspEventName('login'), true);
  assert.equal(isTspEventName('page_view'), false);
  const events = parseEventRows(
    report({
      dimensions: ['eventName'],
      metrics: ['eventCount'],
      rows: [
        { dims: ['page_view'], metrics: [40] },
        { dims: ['sign_up'], metrics: [2] },
        { dims: ['session_start'], metrics: [12] },
      ],
    })
  );
  assert.equal(events.find((e) => e.name === 'sign_up')?.tsp, true);
  assert.equal(events.find((e) => e.name === 'page_view')?.tsp, false);
  const tsp = assembleTspEvents(events);
  assert.equal(tsp.find((e) => e.key === 'sign_up')?.tagged, true);
  assert.equal(tsp.find((e) => e.key === 'sign_up')?.count, 2);
  assert.equal(tsp.find((e) => e.key === 'login')?.tagged, false);
  assert.equal(tsp.find((e) => e.key === 'login')?.count, null);
});

test('assembleGodAnalytics keeps empty/error states honest and redacts secrets', () => {
  const empty = emptyAnalyticsPayload(parseGa4Config({}), 'missing_credentials', 'need key');
  assert.equal(empty.configured, false);
  assert.equal(empty.realtimeUsers, null);
  assert.equal(empty.topPages.length, 0);
  assert.equal(hasAnyAnalyticsData(empty), false);
  assert.ok(ANALYTICS_SETUP_ENV_VARS.includes('GA4_SERVICE_ACCOUNT_JSON'));
  assert.doesNotMatch(JSON.stringify(empty), /BEGIN PRIVATE KEY/);

  const ok = assembleGodAnalytics({
    config: configured(),
    now: new Date('2026-09-13T12:00:00.000Z'),
    realtime: report({ metrics: ['activeUsers'], rows: [{ metrics: [1] }] }),
    overview: report({
      dimensions: ['dateRange'],
      metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews'],
      rows: [{ dims: ['today'], metrics: [5, 2, 6, 10] }],
    }),
    pages: report({
      dimensions: ['pagePath'],
      metrics: ['screenPageViews'],
      rows: [{ dims: ['/plans'], metrics: [4] }],
    }),
    events: report({
      dimensions: ['eventName'],
      metrics: ['eventCount'],
      rows: [{ dims: ['login'], metrics: [3] }],
    }),
  });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.periods.today.users, 5);
  assert.equal(ok.topPages[0]?.label, '/plans');
  assert.equal(ok.tspEvents.find((e) => e.key === 'login')?.tagged, true);
  assert.equal(ok.fetchedAt, '2026-09-13T12:00:00.000Z');

  const noHits = assembleGodAnalytics({
    config: configured(),
    realtime: report({ metrics: ['activeUsers'], rows: [{ metrics: [0] }] }),
    overview: report({
      dimensions: ['dateRange'],
      metrics: ['activeUsers', 'sessions'],
      rows: [{ dims: ['today'], metrics: [0, 0] }],
    }),
  });
  assert.equal(noHits.status, 'empty');
  assert.match(noHits.message || '', /G-GNBJQ2DMQB/);

  const failed = assembleGodAnalytics({
    config: configured(),
    errors: ['PERMISSION_DENIED: add the service account as Viewer'],
  });
  assert.equal(failed.status, 'ga4_error');
  assert.match(failed.message || '', /Viewer/);

  const leaked = sanitizeGa4Error({
    message: 'bad -----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY----- ya29.abc',
  });
  assert.doesNotMatch(leaked, /SECRET/);
  assert.doesNotMatch(leaked, /ya29/);
});

test('loadGodAnalytics short-circuits without calling GA4 when credentials are missing', async () => {
  let called = 0;
  const payload = await loadGodAnalytics({
    env: {},
    now: new Date('2026-09-13T00:00:00.000Z'),
    client: {
      async runReport() {
        called += 1;
        return { rows: [] };
      },
      async runRealtimeReport() {
        called += 1;
        return { rows: [] };
      },
    },
  });
  assert.equal(called, 0);
  assert.equal(payload.status, 'missing_credentials');
  assert.equal(payload.configured, false);
  assert.match(payload.message || '', /service account/i);
});

test('loadGodAnalytics uses an injected client and never puts the key on the payload', async () => {
  const payload = await loadGodAnalytics({
    env: {
      GA4_CLIENT_EMAIL: 'reader@project.iam.gserviceaccount.com',
      GA4_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nDO_NOT_LEAK\n-----END PRIVATE KEY-----\n',
    },
    client: {
      async runReport(body) {
        const dim = JSON.stringify(body);
        if (dim.includes('pagePath')) {
          return report({
            dimensions: ['pagePath'],
            metrics: ['screenPageViews', 'activeUsers', 'sessions'],
            rows: [{ dims: ['/'], metrics: [9, 4, 5] }],
          });
        }
        if (dim.includes('eventName')) {
          return report({
            dimensions: ['eventName'],
            metrics: ['eventCount'],
            rows: [{ dims: ['page_view'], metrics: [9] }],
          });
        }
        if (dim.includes('dateRanges') && !dim.includes('dimensions')) {
          return report({
            dimensions: ['dateRange'],
            metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews'],
            rows: [
              { dims: ['today'], metrics: [2, 1, 3, 4] },
              { dims: ['7d'], metrics: [8, 3, 10, 20] },
              { dims: ['30d'], metrics: [21, 9, 30, 80] },
            ],
          });
        }
        return { rows: [] };
      },
      async runRealtimeReport() {
        return report({ metrics: ['activeUsers'], rows: [{ metrics: [1] }] });
      },
    },
  });
  assert.equal(payload.status, 'ok');
  assert.equal(payload.realtimeUsers, 1);
  assert.equal(payload.periods['30d'].users, 21);
  assert.equal(payload.topPages[0]?.label, '/');
  assert.doesNotMatch(JSON.stringify(payload), /DO_NOT_LEAK/);
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE KEY/);
});

test('signGa4Jwt is a verifiable RS256 token for the Analytics readonly scope', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = signGa4Jwt(
    { clientEmail: 'reader@project.iam.gserviceaccount.com', privateKey: pem },
    1_700_000_000
  );
  const [header, payload] = jwt.split('.').slice(0, 2).map((part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));
  assert.equal(header.alg, 'RS256');
  assert.equal(payload.iss, 'reader@project.iam.gserviceaccount.com');
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/analytics.readonly');
  assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
  clearGa4TokenCache();
});

test('loadGodAnalyticsFromReports documents invalid credentials without calling GA4', () => {
  const payload = loadGodAnalyticsFromReports({
    config: parseGa4Config({ GA4_CLIENT_EMAIL: 'x', GA4_PRIVATE_KEY: 'y' }),
  });
  assert.equal(payload.status, 'invalid_credentials');
  assert.match(payload.message || '', /not valid/);
});

test('God Analytics API, page, and nav stay behind the God gate and do not embed secrets', () => {
  const api = readFileSync(join(here, '../app/api/god/analytics/route.ts'), 'utf8');
  const page = readFileSync(join(here, '../app/admin/god/analytics/page.tsx'), 'utf8');
  const board = readFileSync(join(here, '../components/god/GodAnalyticsBoard.tsx'), 'utf8');
  const nav = readFileSync(join(here, '../components/god/GodSubnav.tsx'), 'utf8');
  const home = readFileSync(join(here, '../app/admin/god/page.tsx'), 'utf8');
  const layout = readFileSync(join(here, '../app/admin/layout.tsx'), 'utf8');
  const envExample = readFileSync(join(here, '../../.env.example'), 'utf8');
  const deploy = readFileSync(join(here, '../DEPLOY.md'), 'utf8');
  const client = readFileSync(join(here, './ga4-data.ts'), 'utf8');

  assert.match(api, /requireGodCaller/);
  assert.match(api, /loadGodAnalytics/);
  assert.doesNotMatch(api, /process\.env/);
  assert.match(page, /GodAnalyticsBoard/);
  assert.match(board, /fetchGodMe/);
  assert.match(board, /\/api\/god\/analytics/);
  assert.match(board, /This page could not be found/);
  assert.match(board, /variant === 'teaser'/);
  assert.match(nav, /GOD_ANALYTICS_PATH/);
  assert.match(nav, /Analytics/);
  assert.match(home, /GodAnalyticsBoard/);
  assert.match(home, /GOD_ANALYTICS_PATH/);
  assert.match(layout, /GOD_ANALYTICS_PATH/);
  assert.match(envExample, /GA4_SERVICE_ACCOUNT_JSON=/);
  assert.doesNotMatch(envExample, /BEGIN PRIVATE KEY/);
  assert.match(deploy, /Google Analytics Data API/);
  assert.match(deploy, /365480892/);
  assert.match(deploy, /G-GNBJQ2DMQB/);
  assert.match(client, /node:crypto/);
  assert.doesNotMatch(client, /sk_live_|AIza[0-9A-Za-z_-]{20,}/);
});
